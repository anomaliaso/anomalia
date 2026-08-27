import { describe, expect, it } from 'vitest';
import {
  MIN_ACCOUNT_POSTS,
  MIN_CORRELATION_PAIRS,
  REFERENCE_AGE_HOURS,
  accountBaselines,
  correlateByFormat,
  correlateChecks,
  engagementAtAge,
  engagementOf,
  interactionRate,
  formatBucket,
  hasSettled,
  median,
  noiseFloor,
  normalizeObservations,
  outperformance,
  ranks,
  spearman,
  topOutperformers,
  velocity,
  type MarketPost,
  localHour
} from './market-metrics';

const post = (accountKey: string, metrics: Record<string, unknown>, over: Partial<MarketPost> = {}): MarketPost => ({
  accountKey,
  platform: 'instagram',
  mediaType: 'image',
  metrics,
  ...over
});

/** n posts for one account, all with the same engagement — a flat, well-defined baseline. */
const flatAccount = (key: string, likes: number, n = MIN_ACCOUNT_POSTS): MarketPost[] =>
  Array.from({ length: n }, () => post(key, { likes }));

describe('engagementOf', () => {
  it('sums likes, comments and shares', () => {
    expect(engagementOf(post('a', { likes: 10, comments: 5, shares: 2 }))).toBe(17);
  });

  it('ignores views — they are not comparable across platforms and would make every video win', () => {
    expect(engagementOf(post('a', { likes: 10, views: 1_000_000 }))).toBe(10);
  });

  it('coerces numeric strings and tolerates missing metrics', () => {
    expect(engagementOf(post('a', { likes: '10', comments: null }))).toBe(10);
    expect(engagementOf({ accountKey: 'a' })).toBe(0);
  });
});

describe('interactionRate', () => {
  it('separates resonance from distribution', () => {
    // Same interactions, ten times the views: pushed by the algorithm, not better content.
    expect(interactionRate({ likes: 100, comments: 20, views: 1000 })).toBe(0.12);
    expect(interactionRate({ likes: 100, comments: 20, views: 10_000 })).toBe(0.012);
  });

  it('returns null where views are not reported, instead of a misleading zero', () => {
    // The text surfaces report no views; absent must not read as "nobody engaged".
    expect(interactionRate({ likes: 100, comments: 20 })).toBeNull();
    expect(interactionRate({ likes: 100, views: 0 })).toBeNull();
  });
});

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns 0 for no values', () => {
    expect(median([])).toBe(0);
  });
});

describe('accountBaselines', () => {
  it('skips accounts with too few posts to have a real baseline', () => {
    const baselines = accountBaselines(flatAccount('small', 100, MIN_ACCOUNT_POSTS - 1));
    expect(baselines.has('small')).toBe(false);
  });

  it('builds a baseline once there are enough posts', () => {
    const baselines = accountBaselines(flatAccount('ok', 100));
    expect(baselines.get('ok')).toEqual({ accountKey: 'ok', posts: MIN_ACCOUNT_POSTS, medianEngagement: 100 });
  });

  it('skips an account whose median engagement is 0 — it cannot be a denominator', () => {
    expect(accountBaselines(flatAccount('dead', 0)).has('dead')).toBe(false);
  });

  it('keeps accounts separate', () => {
    const baselines = accountBaselines([...flatAccount('a', 100), ...flatAccount('b', 10)]);
    expect(baselines.get('a')?.medianEngagement).toBe(100);
    expect(baselines.get('b')?.medianEngagement).toBe(10);
  });
});

describe('outperformance', () => {
  it('measures a post against its OWN account, cancelling account size', () => {
    const posts = [...flatAccount('whale', 100_000), ...flatAccount('minnow', 100)];
    const baselines = accountBaselines(posts);

    // Both posts did exactly 2× their own baseline — despite 1000× different absolute numbers.
    const whaleHit = post('whale', { likes: 200_000 });
    const minnowHit = post('minnow', { likes: 200 });
    expect(outperformance(whaleHit, baselines)).toBe(2);
    expect(outperformance(minnowHit, baselines)).toBe(2);
  });

  it('returns null — not 0 — when the account has no baseline', () => {
    // An unlabelled post must be dropped from the fit, not counted as a flop.
    expect(outperformance(post('unknown', { likes: 5 }), accountBaselines([]))).toBeNull();
  });
});

describe('ranks', () => {
  it('ranks ascending, 1-based', () => {
    expect(ranks([30, 10, 20])).toEqual([3, 1, 2]);
  });

  it('gives tied values their shared average rank', () => {
    expect(ranks([10, 10, 20])).toEqual([1.5, 1.5, 3]);
    expect(ranks([5, 5, 5, 5])).toEqual([2.5, 2.5, 2.5, 2.5]);
  });
});

describe('spearman', () => {
  it('is 1 for a perfectly monotonic relationship, even a non-linear one', () => {
    const pairs = [1, 2, 3, 4, 5].map((x) => ({ x, y: x ** 4 }));
    expect(spearman(pairs)).toBeCloseTo(1, 5);
  });

  it('is -1 when the relationship is perfectly inverted', () => {
    const pairs = [1, 2, 3, 4, 5].map((x) => ({ x, y: -x }));
    expect(spearman(pairs)).toBeCloseTo(-1, 5);
  });

  it('is unmoved by a single extreme outlier, unlike Pearson', () => {
    // This is the reason for rank correlation: engagement is a power law.
    const clean = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => ({ x, y: x }));
    const withOutlier = [...clean.slice(0, 7), { x: 8, y: 10_000_000 }];
    expect(spearman(withOutlier)).toBeCloseTo(spearman(clean), 5);
  });

  it('returns 0 when one side is constant', () => {
    expect(spearman([1, 2, 3, 4].map((x) => ({ x, y: 7 })))).toBe(0);
  });

  it('returns 0 for too few pairs rather than a meaningless number', () => {
    expect(spearman([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0);
  });
});

describe('noiseFloor', () => {
  it('shrinks as the sample grows', () => {
    expect(noiseFloor(50)).toBeGreaterThan(noiseFloor(500));
  });

  it('rejects everything at a useless sample size', () => {
    expect(noiseFloor(3)).toBe(1);
  });
});

describe('correlateChecks', () => {
  /** n posts where `hook_strength` tracks outperformance and `cta` is pure noise. */
  const dataset = (n = 60) =>
    Array.from({ length: n }, (_, i) => ({
      checks: { hook_strength: i / n, cta: (i % 3) / 2 },
      outperformance: 0.5 + i / n,
      format: 'image'
    }));

  it('finds the check that tracks outperformance and ranks it first', () => {
    const result = correlateChecks(dataset());
    expect(result[0].id).toBe('hook_strength');
    expect(result[0].rho).toBeGreaterThan(0.9);
    expect(result[0].significant).toBe(true);
  });

  it('reports the noise check as not significant', () => {
    const cta = correlateChecks(dataset()).find((c) => c.id === 'cta')!;
    expect(cta.significant).toBe(false);
  });

  it('refuses to report a correlation below the minimum pair count', () => {
    expect(correlateChecks(dataset(MIN_CORRELATION_PAIRS - 1))).toEqual([]);
  });

  it('drops posts with a non-finite label rather than counting them', () => {
    const withJunk = [...dataset(), { checks: { hook_strength: 1 }, outperformance: Number.NaN }];
    const hook = correlateChecks(withJunk).find((c) => c.id === 'hook_strength')!;
    expect(hook.n).toBe(60);
  });
});

describe('correlateByFormat', () => {
  it('fits within format buckets, so a format confound cannot fake a result', () => {
    const videos = Array.from({ length: 40 }, (_, i) => ({
      checks: { hook_strength: i / 40 },
      outperformance: 0.5 + i / 40,
      format: 'reel'
    }));
    const images = Array.from({ length: 40 }, (_, i) => ({
      checks: { hook_strength: i / 40 },
      outperformance: 2 - i / 40, // inverted inside this bucket
      format: 'image'
    }));

    const byFormat = correlateByFormat([...videos, ...images]);
    expect(byFormat.video[0].rho).toBeGreaterThan(0.9);
    expect(byFormat.image[0].rho).toBeLessThan(-0.9);
  });

  it('omits buckets too small to report', () => {
    const few = Array.from({ length: 5 }, (_, i) => ({
      checks: { hook_strength: i / 5 },
      outperformance: i,
      format: 'text'
    }));
    expect(correlateByFormat(few)).toEqual({});
  });
});

describe('formatBucket', () => {
  it('maps platform media types onto coarse buckets', () => {
    expect(formatBucket('REEL')).toBe('video');
    expect(formatBucket('sidecar')).toBe('carousel');
    expect(formatBucket('tweet')).toBe('text');
    expect(formatBucket('photo')).toBe('image');
    expect(formatBucket(null)).toBe('image');
  });
});

describe('normalizeObservations', () => {
  it('sorts by age and drops junk readings', () => {
    const series = normalizeObservations([
      { ageHours: 10, engagement: 50 },
      { ageHours: 2, engagement: 10 },
      { ageHours: -1, engagement: 5 },
      { ageHours: 4, engagement: Number.NaN }
    ]);
    expect(series.map((o) => o.ageHours)).toEqual([2, 10]);
  });

  it('keeps the larger reading when the same age is seen twice', () => {
    // Engagement only accumulates, so the bigger number is the fresher observation.
    const series = normalizeObservations([
      { ageHours: 5, engagement: 10 },
      { ageHours: 5, engagement: 40 }
    ]);
    expect(series).toEqual([{ ageHours: 5, engagement: 40 }]);
  });
});

describe('engagementAtAge', () => {
  const series = [
    { ageHours: 2, engagement: 100 },
    { ageHours: 12, engagement: 500 },
    { ageHours: 30, engagement: 900 }
  ];

  it('interpolates between the two readings that straddle the target', () => {
    // Midway between 12h/500 and 30h/900 is 21h → 700.
    expect(engagementAtAge(series, 21)).toBeCloseTo(700, 5);
  });

  it('normalises two posts observed at different ages to a comparable number', () => {
    // This is the confound the hourly loop exists to remove.
    const early = [{ ageHours: 1, engagement: 40 }, { ageHours: 26, engagement: 240 }];
    const late = [{ ageHours: 20, engagement: 200 }, { ageHours: 28, engagement: 280 }];
    expect(engagementAtAge(early, 24)).toBeCloseTo(224, 5);
    expect(engagementAtAge(late, 24)).toBeCloseTo(240, 5);
  });

  it('returns an exact reading when one lands on the target', () => {
    expect(engagementAtAge(series, 12)).toBe(500);
  });

  it('refuses to extrapolate past the last reading', () => {
    // A post seen only at 3h has no 24h value yet — it gets one tomorrow.
    expect(engagementAtAge([{ ageHours: 3, engagement: 20 }], 24)).toBeNull();
  });

  it('refuses to invent a value before the first reading', () => {
    expect(engagementAtAge(series, 1)).toBeNull();
  });

  it('returns null for an empty series', () => {
    expect(engagementAtAge([], 24)).toBeNull();
  });

  it('defaults to the reference age', () => {
    expect(engagementAtAge(series)).toBe(engagementAtAge(series, REFERENCE_AGE_HOURS));
  });
});

describe('velocity', () => {
  it('reports interactions gained per hour', () => {
    expect(velocity([{ ageHours: 2, engagement: 100 }, { ageHours: 12, engagement: 600 }])).toBe(50);
  });

  it('needs two distinct readings', () => {
    expect(velocity([{ ageHours: 2, engagement: 100 }])).toBeNull();
    expect(velocity([])).toBeNull();
  });
});

describe('hasSettled', () => {
  it('is true when the last interval added almost nothing', () => {
    expect(hasSettled([{ ageHours: 20, engagement: 1000 }, { ageHours: 21, engagement: 1005 }])).toBe(true);
  });

  it('is false while the post is still climbing', () => {
    expect(hasSettled([{ ageHours: 2, engagement: 100 }, { ageHours: 3, engagement: 400 }])).toBe(false);
  });

  it('is false with a single reading — nothing to compare', () => {
    expect(hasSettled([{ ageHours: 2, engagement: 100 }])).toBe(false);
  });

  it('treats a dead post as settled rather than dividing by zero', () => {
    expect(hasSettled([{ ageHours: 2, engagement: 0 }, { ageHours: 3, engagement: 0 }])).toBe(true);
  });
});

describe('topOutperformers', () => {
  it('ranks by outperformance, not by raw size', () => {
    const posts = [
      { outperformance: 1.2, name: 'big account, typical post' },
      { outperformance: 5.4, name: 'small account, breakout' },
      { outperformance: 0.3, name: 'flop' }
    ];
    expect(topOutperformers(posts, 2).map((p) => p.name)).toEqual([
      'small account, breakout',
      'big account, typical post'
    ]);
  });

  it('drops unlabelled posts', () => {
    expect(topOutperformers([{ outperformance: Number.NaN }])).toEqual([]);
  });
});

describe('localHour', () => {
  it('reads a UTC timestamp in the creator country clock', () => {
    // 19:00Z is 20:00 in Italy — dinner, which is the whole point of asking about the hour.
    expect(localHour('2026-08-19T19:00:00Z', 'IT')).toBe(20);
    expect(localHour('2026-08-19T19:00:00Z', 'GB')).toBe(19);
  });

  it('wraps across midnight instead of returning 24', () => {
    expect(localHour('2026-08-19T23:30:00Z', 'IT')).toBe(0);
  });

  it('handles a half-hour offset', () => {
    expect(localHour('2026-08-19T06:00:00Z', 'IN')).toBe(11);
  });

  it('refuses a country too wide for one clock', () => {
    // Picking a coast would silently group Californian evenings with New York mornings — worse than
    // admitting the hour is unknown, because a wrong number still gets averaged.
    expect(localHour('2026-08-19T19:00:00Z', 'US')).toBeNull();
    expect(localHour('2026-08-19T19:00:00Z', 'BR')).toBeNull();
  });

  it('returns null when either half is missing — an hour needs a place', () => {
    expect(localHour('2026-08-19T19:00:00Z', null)).toBeNull();
    expect(localHour(null, 'IT')).toBeNull();
    expect(localHour('banana', 'IT')).toBeNull();
  });

  it('returns null for a country it has no offset for, rather than assuming UTC', () => {
    expect(localHour('2026-08-19T19:00:00Z', 'ZW')).toBeNull();
  });

  it('is case and whitespace tolerant — the payload is not ours to trust', () => {
    expect(localHour('2026-08-19T19:00:00Z', ' it ')).toBe(20);
  });
});
