import { describe, it, expect } from 'vitest';
import {
  accountsForTick,
  designPostRow,
  designTrendRow,
  hasVisual,
  parseAccounts,
  parseTopics,
  topicsForTick,
  usableTrend,
  DEFAULT_DESIGN_ACCOUNTS,
  DEFAULT_DESIGN_TOPICS,
  ACCOUNTS_PER_TICK,
  TOPICS_PER_TICK
} from './design-discovery';
import { HISTORY_CAPABLE } from './market-harvest';
import type { NormalizedPost } from './scrapecreators';

const post = (over: Partial<NormalizedPost> = {}): NormalizedPost => ({
  externalId: 'abc',
  url: 'https://instagram.com/p/abc',
  content: 'Launch day.',
  mediaType: 'image',
  thumbnailUrl: 'https://cdn.example/abc.jpg',
  publishedAt: '2026-08-01T10:00:00Z',
  metrics: { likes: 100, comments: 10, shares: 5, views: 0 },
  ...over
});

describe('the curated list', () => {
  it('only names platforms whose profiles we can actually fetch', () => {
    // An account on a platform outside FETCHERS would be swept forever and return nothing.
    for (const a of DEFAULT_DESIGN_ACCOUNTS) {
      expect(HISTORY_CAPABLE.has(a.platform), `${a.platform}:${a.handle}`).toBe(true);
    }
  });

  it('holds no duplicates', () => {
    const keys = DEFAULT_DESIGN_ACCOUNTS.map((a) => `${a.platform}:${a.handle}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('parseAccounts', () => {
  it('reads the env override', () => {
    expect(parseAccounts('instagram:figma, x:vercel')).toEqual([
      { platform: 'instagram', handle: 'figma' },
      { platform: 'x', handle: 'vercel' }
    ]);
  });

  it('drops junk instead of guessing', () => {
    expect(parseAccounts('figma,,:,x:')).toEqual([]);
    expect(parseAccounts(null)).toEqual([]);
  });

  it('deduplicates', () => {
    expect(parseAccounts('x:vercel,x:vercel')).toHaveLength(1);
  });
});

describe('accountsForTick', () => {
  it('returns everything when the list is short', () => {
    const few = DEFAULT_DESIGN_ACCOUNTS.slice(0, 3);
    expect(accountsForTick(few, new Date('2026-08-20'))).toHaveLength(3);
  });

  it('covers the whole list over consecutive days, without repeating inside one tick', () => {
    const seen = new Set<string>();
    const days = Math.ceil(DEFAULT_DESIGN_ACCOUNTS.length / ACCOUNTS_PER_TICK);
    for (let d = 0; d < days; d++) {
      const day = new Date(Date.UTC(2026, 7, 20 + d));
      const picked = accountsForTick(DEFAULT_DESIGN_ACCOUNTS, day);
      expect(new Set(picked.map((a) => `${a.platform}:${a.handle}`)).size).toBe(picked.length);
      for (const a of picked) seen.add(`${a.platform}:${a.handle}`);
    }
    expect(seen.size).toBe(DEFAULT_DESIGN_ACCOUNTS.length);
  });

  it('is deterministic — the same day picks the same accounts', () => {
    const a = accountsForTick(DEFAULT_DESIGN_ACCOUNTS, new Date('2026-08-20T02:00:00Z'));
    const b = accountsForTick(DEFAULT_DESIGN_ACCOUNTS, new Date('2026-08-20T21:00:00Z'));
    expect(a).toEqual(b);
  });
});

describe('hasVisual', () => {
  it('keeps anything with a picture or a clip', () => {
    expect(hasVisual(post())).toBe(true);
    expect(hasVisual(post({ thumbnailUrl: null, videoUrl: 'https://cdn/v.mp4' }))).toBe(true);
  });

  it('rejects a text-only post — there is nothing to grade', () => {
    expect(hasVisual(post({ thumbnailUrl: null, videoUrl: null }))).toBe(false);
  });
});

describe('designPostRow', () => {
  const account = { platform: 'instagram', handle: 'figma' };

  it('archives the STILL for a static post, not a clip', () => {
    const row = designPostRow(post(), account);
    expect(row.media_url).toBe('https://cdn.example/abc.jpg');
    expect(row.format_bucket).toBe('image');
  });

  it('archives the clip for a video post', () => {
    const row = designPostRow(post({ mediaType: 'video', videoUrl: 'https://cdn/v.mp4' }), account);
    expect(row.media_url).toBe('https://cdn/v.mp4');
    expect(row.format_bucket).toBe('video');
  });

  it('records where the row came from, so a curated sweep stays separable from the hashtag one', () => {
    expect(designPostRow(post(), account).query).toBe('design:instagram/figma');
  });

  it('sums engagement without views', () => {
    // Same rule as market-metrics: views are not engagement.
    expect(designPostRow(post(), account).engagement).toBe(115);
  });

  it('survives a post with no metrics at all', () => {
    const row = designPostRow(post({ metrics: {} }), account);
    expect(row.engagement).toBe(0);
    expect(row.views).toBeNull();
  });
});

const trend = (over: Record<string, unknown> = {}) =>
  ({
    platform: 'instagram',
    externalId: 'instagram:abc',
    url: 'https://instagram.com/p/abc',
    accountHandle: 'studio',
    caption: 'Poster series.',
    videoUrl: null,
    thumbnailUrl: 'https://cdn.example/abc.jpg',
    publishedAt: '2026-08-01T10:00:00Z',
    metrics: { likes: 100, comments: 10, shares: 0, views: 0 },
    source: '#design',
    region: null,
    soundId: null,
    soundName: null,
    isAd: null,
    isPaidPartnership: null,
    saves: null,
    captionLanguage: null,
    captionsUrl: null,
    captionsLang: null,
    durationMs: null,
    hashtags: [],
    soundFrom: null,
    soundIsOriginal: null,
    createdByAi: null,
    videoRatio: null,
    videoWidth: null,
    videoHeight: null,
    shootMode: null,
    videoUrlClean: null,
    watchThresholdMs: null,
    watchProb: null,
    watchAvgMs: null,
    ...over
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe('parseTopics', () => {
  it('reads the env override and strips the hash', () => {
    expect(parseTopics('#design, uidesign')).toEqual(['design', 'uidesign']);
  });

  it('drops junk and duplicates', () => {
    expect(parseTopics('design,design, , ###')).toEqual(['design']);
    expect(parseTopics(null)).toEqual([]);
  });
});

describe('topicsForTick', () => {
  it('covers the whole list over consecutive days without repeating inside a tick', () => {
    const seen = new Set<string>();
    const days = Math.ceil(DEFAULT_DESIGN_TOPICS.length / TOPICS_PER_TICK);
    for (let d = 0; d < days; d++) {
      const picked = topicsForTick(DEFAULT_DESIGN_TOPICS, new Date(Date.UTC(2026, 7, 20 + d)));
      expect(new Set(picked).size).toBe(picked.length);
      for (const t of picked) seen.add(t);
    }
    expect(seen.size).toBe(DEFAULT_DESIGN_TOPICS.length);
  });
});

describe('usableTrend', () => {
  it('keeps a still with a handle — the design half of a hashtag surface', () => {
    expect(usableTrend(trend())).toBe(true);
  });

  it('drops a post with no handle: it can never be baselined', () => {
    expect(usableTrend(trend({ accountHandle: null }))).toBe(false);
  });

  it('drops a post with nothing to look at', () => {
    expect(usableTrend(trend({ thumbnailUrl: null, videoUrl: null }))).toBe(false);
  });
});

describe('designTrendRow', () => {
  it('archives the STILL when the hashtag returned a carousel, not a clip', () => {
    // trendPostRow was written video-first; on a design hashtag half the results are posters.
    const row = designTrendRow(trend(), 'design');
    expect(row.media_url).toBe('https://cdn.example/abc.jpg');
    expect(row.media_type).toBe('image');
    expect(row.format_bucket).toBe('image');
  });

  it('leaves a real clip alone', () => {
    const row = designTrendRow(trend({ videoUrl: 'https://cdn/v.mp4' }), 'design');
    expect(row.media_url).toBe('https://cdn/v.mp4');
    expect(row.media_type).toBe('video');
  });

  it('records the hashtag it came from, distinct from the curated sweep', () => {
    expect(designTrendRow(trend(), 'uidesign').query).toBe('design:#uidesign');
  });
});
