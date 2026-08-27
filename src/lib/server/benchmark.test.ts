import { describe, expect, it } from 'vitest';
import {
  MIN_COHORT,
  byRelease,
  compareCohorts,
  correlateWithHumanSignal,
  pairedByBrand,
  quantile,
  summarize,
  type Sample
} from './benchmark';

/**
 * n samples centred on `mean`, spread deterministically so tests never flake. The offsets are
 * de-meaned so the cohort mean is EXACTLY `mean` for any n — a raw `(i % 5) - 2` pattern only
 * cancels when n is a multiple of 5, which silently shifted the expected delta.
 */
function cohort(n: number, mean: number, spread = 4, opts: Partial<Sample> = {}): Sample[] {
  const offsets = Array.from({ length: n }, (_, i) => ((i % 5) - 2) * spread);
  const avg = offsets.reduce((a, b) => a + b, 0) / (n || 1);
  return offsets.map((o) => ({ index: mean + o - avg, scorerVersion: 1, ...opts }));
}

describe('summarize', () => {
  it('returns an empty summary for no values', () => {
    expect(summarize([])).toEqual({ n: 0, mean: 0, median: 0, p25: 0, p75: 0, sd: 0, min: 0, max: 0 });
  });

  it('computes the usual descriptive stats', () => {
    const s = summarize([10, 20, 30, 40]);
    expect(s.n).toBe(4);
    expect(s.mean).toBe(25);
    expect(s.median).toBe(25);
    expect(s.p25).toBe(17.5);
    expect(s.p75).toBe(32.5);
    expect(s.min).toBe(10);
    expect(s.max).toBe(40);
  });

  it('reports sd 0 for a single sample rather than NaN', () => {
    expect(summarize([42]).sd).toBe(0);
  });

  it('ignores non-finite values', () => {
    expect(summarize([10, Number.NaN, 20, Number.POSITIVE_INFINITY]).n).toBe(2);
  });

  it('interpolates quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([7], 0.9)).toBe(7);
  });
});

describe('compareCohorts', () => {
  it('refuses to call a small move a win', () => {
    // Same mean, plenty of spread: the point estimate wobbles, the interval must still cover 0.
    const c = compareCohorts(cohort(40, 60), cohort(40, 60.5));
    expect(c.verdict).toBe('flat');
    expect(c.ci[0]).toBeLessThan(0);
    expect(c.ci[1]).toBeGreaterThan(0);
  });

  it('detects a real improvement', () => {
    const c = compareCohorts(cohort(60, 55, 3), cohort(60, 68, 3));
    expect(c.verdict).toBe('improved');
    expect(c.delta).toBeCloseTo(13, 5);
    expect(c.ci[0]).toBeGreaterThan(0);
    expect(c.effectSize).toBeGreaterThan(0.8);
  });

  it('detects a real regression', () => {
    const c = compareCohorts(cohort(60, 68, 3), cohort(60, 55, 3));
    expect(c.verdict).toBe('regressed');
    expect(c.ci[1]).toBeLessThan(0);
    expect(c.effectSize).toBeLessThan(0);
  });

  it('reports insufficient_data below the minimum cohort size', () => {
    const c = compareCohorts(cohort(MIN_COHORT - 1, 50), cohort(60, 70));
    expect(c.verdict).toBe('insufficient_data');
    expect(c.reason).toContain(String(MIN_COHORT));
    // The point estimate is still reported — it just does not get a verdict.
    expect(c.delta).toBeCloseTo(20, 5);
  });

  it('refuses to compare across scorer versions', () => {
    const c = compareCohorts(cohort(40, 50, 4, { scorerVersion: 1 }), cohort(40, 70, 4, { scorerVersion: 2 }));
    expect(c.verdict).toBe('incomparable');
    expect(c.reason).toContain('scorer_version');
    expect(c.delta).toBe(0);
  });

  it('surfaces which check moved, biggest mover first', () => {
    const before = cohort(30, 60, 3, { checks: { hook_strength: 0.8, cta: 0.5 } });
    const after = cohort(30, 60, 3, { checks: { hook_strength: 0.3, cta: 0.55 } });
    const c = compareCohorts(before, after);
    expect(c.checks[0].id).toBe('hook_strength');
    expect(c.checks[0].delta).toBeCloseTo(-0.5, 5);
    expect(Math.abs(c.checks[1].delta)).toBeLessThan(Math.abs(c.checks[0].delta));
  });

  it('handles empty cohorts without throwing', () => {
    const c = compareCohorts([], []);
    expect(c.verdict).toBe('insufficient_data');
    expect(c.before.n).toBe(0);
  });
});

describe('pairedByBrand', () => {
  const s = (brandId: string, index: number): Sample => ({ index, brandId, scorerVersion: 1 });

  it('keeps only brands present on both sides', () => {
    const before = [s('a', 50), s('b', 60), s('c', 70)];
    const after = [s('a', 55), s('c', 65), s('d', 90)];
    const paired = pairedByBrand(before, after);
    expect(paired.before.map((x) => x.brandId)).toEqual(['a', 'c']);
    expect(paired.after.map((x) => x.brandId)).toEqual(['a', 'c']);
  });

  it('drops samples with no brand id', () => {
    const paired = pairedByBrand([{ index: 10 }, s('a', 1)], [s('a', 2)]);
    expect(paired.before).toHaveLength(1);
  });

  it('returns empty cohorts when no brand overlaps', () => {
    const paired = pairedByBrand([s('a', 1)], [s('b', 2)]);
    expect(paired.before).toHaveLength(0);
    expect(paired.after).toHaveLength(0);
  });

  it('stops a single high-volume brand from swinging the verdict', () => {
    // 'whale' publishes 40 posts and got much worse; 'small' is stable and present on both sides.
    const before = [...cohort(40, 80, 2, { brandId: 'whale' }), ...cohort(25, 60, 2, { brandId: 'small' })];
    const after = [...cohort(40, 40, 2, { brandId: 'whale' }), ...cohort(25, 60, 2, { brandId: 'small' })];

    // Unpaired, the fleet mean collapses. Paired on the stable brand only, it is flat.
    expect(compareCohorts(before, after).verdict).toBe('regressed');
    const onlySmall = pairedByBrand(
      before.filter((x) => x.brandId === 'small'),
      after.filter((x) => x.brandId === 'small')
    );
    expect(compareCohorts(onlySmall.before, onlySmall.after).verdict).toBe('flat');
  });
});

describe('byRelease', () => {
  it('groups samples and buckets untagged ones under unknown', () => {
    const grouped = byRelease([
      { index: 1, release: 'abc' },
      { index: 2, release: 'abc' },
      { index: 3, release: null }
    ]);
    expect(grouped.get('abc')).toHaveLength(2);
    expect(grouped.get('unknown')).toHaveLength(1);
  });
});

describe('correlateWithHumanSignal', () => {
  it('finds the expected negative correlation — a better index means fewer user edits', () => {
    const pairs = [
      { index: 90, signal: 0 },
      { index: 80, signal: 0 },
      { index: 70, signal: 1 },
      { index: 60, signal: 1 },
      { index: 50, signal: 2 },
      { index: 40, signal: 3 }
    ];
    const { r, n } = correlateWithHumanSignal(pairs);
    expect(n).toBe(6);
    expect(r).toBeLessThan(-0.9);
  });

  it('returns 0 for too few pairs rather than a meaningless coefficient', () => {
    expect(correlateWithHumanSignal([{ index: 1, signal: 1 }])).toEqual({ r: 0, n: 1 });
  });

  it('returns 0 when one side has no variance', () => {
    const pairs = Array.from({ length: 5 }, (_, i) => ({ index: 50 + i, signal: 2 }));
    expect(correlateWithHumanSignal(pairs).r).toBe(0);
  });

  it('ignores pairs with non-finite values', () => {
    const { n } = correlateWithHumanSignal([
      { index: 90, signal: 0 },
      { index: Number.NaN, signal: 1 },
      { index: 70, signal: 1 },
      { index: 50, signal: 2 }
    ]);
    expect(n).toBe(3);
  });
});
