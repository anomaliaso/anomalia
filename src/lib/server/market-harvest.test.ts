import { describe, expect, it } from 'vitest';
import { CONTENT_SCORER_VERSION } from './content-quality';
import {
  BASELINE_TIME_BUDGET_MS,
  FETCH_MAX_ATTEMPTS,
  FETCH_RETRY_AFTER_MS,
  BASELINE_CAPABLE,
  HISTORY_CAPABLE,
  MATURE_AGE_HOURS,
  MAX_BASELINE_FETCHES,
  accountsOf,
  ageHoursOf,
  fetchTargets,
  historyPostRows,
  marketPostRow
} from './market-harvest';
import { mediaPathFor } from './market-media';
import type { DiscoveredPost } from './market-discovery';

const found = (over: Partial<DiscoveredPost> = {}): DiscoveredPost => ({
  platform: 'threads',
  externalId: 'threads:abc',
  url: 'https://www.threads.net/@someone/post/abc',
  accountHandle: 'someone',
  content: 'Hai perso 3 clienti questo mese? Scrivici in DM per il template.',
  mediaType: 'text',
  mediaUrl: null,
  publishedAt: '2026-08-18T09:00:00Z',
  metrics: { likes: 100, comments: 20, shares: 5 },
  query: 'preventivi',
  ...over
});

describe('marketPostRow', () => {
  it('sums interactions into a single engagement figure', () => {
    expect(marketPostRow(found()).engagement).toBe(125);
  });

  it('scores the post with the SAME rubric we score our own output with', () => {
    // This is what makes an "us vs the field" comparison a comparison on one ruler.
    const row = marketPostRow(found());
    expect(row.scorer_version).toBe(CONTENT_SCORER_VERSION);
    expect(Object.keys(row.checks)).toContain('hook_strength');
    expect(row.quality_index).toBeGreaterThan(0);
  });

  it('leaves outperformance unset — labelling happens once the account has a baseline', () => {
    expect(marketPostRow(found()).outperformance).toBeUndefined();
  });

  it('carries the dedupe key the unique index relies on', () => {
    const row = marketPostRow(found());
    expect(row.platform).toBe('threads');
    expect(row.external_id).toBe('threads:abc');
  });

  it('records the query, so a skewed query mix stays visible in the report', () => {
    expect(marketPostRow(found()).query).toBe('preventivi');
  });

  it('buckets the format for the per-format fit', () => {
    expect(marketPostRow(found({ mediaType: 'reel' })).format_bucket).toBe('video');
    expect(marketPostRow(found({ mediaType: 'text' })).format_bucket).toBe('text');
  });
});

describe('accountsOf', () => {
  it('groups by platform + handle and counts sightings', () => {
    const accounts = accountsOf([
      found({ externalId: '1', accountHandle: 'a' }),
      found({ externalId: '2', accountHandle: 'a' }),
      found({ externalId: '3', accountHandle: 'b' })
    ]);
    expect(accounts.get('threads:a')?.count).toBe(2);
    expect(accounts.get('threads:b')?.count).toBe(1);
  });

  it('keeps the same handle on two platforms apart', () => {
    const accounts = accountsOf([
      found({ externalId: '1', platform: 'threads', accountHandle: 'same' }),
      found({ externalId: '2', platform: 'linkedin', accountHandle: 'same' })
    ]);
    expect(accounts.size).toBe(2);
  });

  it('drops posts with no handle — they can never be labelled', () => {
    expect(accountsOf([found({ accountHandle: null })]).size).toBe(0);
  });
});

describe('HISTORY_CAPABLE', () => {
  it('covers the platforms scrapecreators can fetch a full profile for', () => {
    expect(HISTORY_CAPABLE.has('threads')).toBe(true);
    expect(HISTORY_CAPABLE.has('instagram')).toBe(true);
  });

  it('excludes reddit and linkedin — neither has a profile fetcher', () => {
    expect(HISTORY_CAPABLE.has('reddit')).toBe(false);
    expect(HISTORY_CAPABLE.has('linkedin')).toBe(false);
  });
});

describe('BASELINE_CAPABLE', () => {
  it('covers reddit, because a subreddit sort=new IS an unbiased sample', () => {
    // No profile fetcher, but the same shape: chronological posts, hits and flops alike.
    expect(BASELINE_CAPABLE.has('reddit')).toBe(true);
  });

  it('still excludes linkedin — search gives a display name, not a fetchable profile', () => {
    // The honest consequence: LinkedIn accounts must recur in discovery to be labelled.
    expect(BASELINE_CAPABLE.has('linkedin')).toBe(false);
  });

  it('is a superset of the profile-fetchable platforms', () => {
    for (const p of HISTORY_CAPABLE) expect(BASELINE_CAPABLE.has(p)).toBe(true);
  });

  it('covers 2 of the 3 discovery sources', () => {
    const discovery = ['threads', 'linkedin', 'reddit'];
    expect(discovery.filter((p) => BASELINE_CAPABLE.has(p))).toEqual(['threads', 'reddit']);
  });
});

describe('ageHoursOf', () => {
  const observed = Date.parse('2026-08-18T12:00:00Z');

  it('measures hours since publication', () => {
    expect(ageHoursOf('2026-08-18T09:00:00Z', observed)).toBe(3);
  });

  it('returns null with no timestamp — an undated post cannot enter the age-normalised fit', () => {
    expect(ageHoursOf(null, observed)).toBeNull();
    expect(ageHoursOf('banana', observed)).toBeNull();
  });

  it('rejects an observation before publication rather than reporting a negative age', () => {
    expect(ageHoursOf('2026-08-18T15:00:00Z', observed)).toBeNull();
  });
});

describe('media archive path', () => {
  it('is stable and collision-free per post', () => {
    expect(mediaPathFor('threads', 'threads:abc/123', 'mp4')).toBe('market/threads/threads_abc_123.mp4');
    // The platform appears once, in the directory — not repeated inside the filename.
  });

  it('strips characters that would break a storage key', () => {
    expect(mediaPathFor('reddit', '/r/x/comments/a b?c', 'jpg')).not.toMatch(/[^a-zA-Z0-9._/-]/);
  });

  it('is deterministic, so re-archiving overwrites instead of duplicating', () => {
    expect(mediaPathFor('threads', 'abc', 'jpg')).toBe(mediaPathFor('threads', 'abc', 'jpg'));
  });
});

describe('MATURE_AGE_HOURS', () => {
  it('excludes posts still on the steep part of their curve', () => {
    // The backfill has no trajectory, so it can only compare posts whose engagement has settled.
    // Including fresh ones would reintroduce the age confound the hourly loop exists to remove.
    expect(MATURE_AGE_HOURS).toBeGreaterThanOrEqual(24);
  });
});

describe('historyPostRows', () => {
  const NOW = Date.parse('2026-08-19T12:00:00Z');
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

  const post = (over: Record<string, unknown> = {}) => ({
    externalId: 'p1',
    url: 'https://example/p1',
    content: 'Hai perso 3 clienti questo mese? Scrivici in DM.',
    mediaType: 'image' as const,
    thumbnailUrl: null,
    publishedAt: hoursAgo(300),
    metrics: { likes: 200, comments: 40 },
    ...over
  });

  it('labels every post on arrival, because the median came back in the same call', () => {
    // This is the whole point: a discovered post waits for its account to recur; these do not.
    const rows = historyPostRows('threads', 'someone', [post()], 100, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].outperformance).toBe(2.4);
    expect(rows[0].quality_index).toBeGreaterThan(0);
  });

  it('drops posts still on the steep part of their curve', () => {
    // A history carries one reading per post, so there is no curve to age-normalise with.
    const rows = historyPostRows('threads', 'a', [post({ publishedAt: hoursAgo(3) })], 100, NOW);
    expect(rows).toEqual([]);
  });

  it('keeps mature posts', () => {
    expect(historyPostRows('threads', 'a', [post({ publishedAt: hoursAgo(72) })], 100, NOW)).toHaveLength(1);
  });

  it('prefixes the id so it cannot collide with the discovered row for the same post', () => {
    // The trending post that led us to the account is usually in its history too.
    expect(historyPostRows('threads', 'a', [post()], 100, NOW)[0].external_id).toBe('hist:threads:p1');
  });

  it('skips posts with no text or no date — nothing to score, nothing to place in time', () => {
    expect(historyPostRows('threads', 'a', [post({ content: '   ' })], 100, NOW)).toEqual([]);
    expect(historyPostRows('threads', 'a', [post({ publishedAt: null })], 100, NOW)).toEqual([]);
  });

  it('turns one fetch into many labelled rows', () => {
    const many = Array.from({ length: 24 }, (_, i) => post({ externalId: `p${i}` }));
    expect(historyPostRows('threads', 'a', many, 100, NOW)).toHaveLength(24);
  });
});

describe('fetch budget', () => {
  it('bounds profile fetches by the clock, not by an invented count', () => {
    // A fixed cap strands the trending posts of every account past the cap — which is the same as
    // having wasted the search call that found them. The ceiling is the function's 800s wall, and
    // the slice must leave room for the sweep, the catalogue and the writes that follow it.
    expect(BASELINE_TIME_BUDGET_MS).toBeLessThan(800_000);
    expect(MAX_BASELINE_FETCHES).toBeGreaterThan(100);
  });

  it('gives fetching enough of the wall to drain the queue in one run, not to nibble at it', () => {
    // At ~1-2s per fetch this is the difference between clearing MAX_BASELINE_FETCHES in a run and
    // carrying a queue that grows faster than it empties — the state that left 381 trending videos
    // with zero labels.
    expect(BASELINE_TIME_BUDGET_MS / 2_000).toBeGreaterThanOrEqual(MAX_BASELINE_FETCHES);
  });

  it('backs off a failing handle instead of retrying it every tick', () => {
    // A 404 does not become a 200 by being asked again an hour later.
    expect(FETCH_RETRY_AFTER_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(FETCH_MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});

describe('fetchTargets', () => {
  const a = (platform: string, handle: string) => ({ platform, handle });

  it('puts this run\'s accounts before the queue — their trending post is why we are here', () => {
    const { fetchable } = fetchTargets([a('threads', 'fresh')], [a('threads', 'waiting')]);
    expect(fetchable.map((f) => f.handle)).toEqual(['fresh', 'waiting']);
  });

  it('never fetches the same account twice in one run', () => {
    const { fetchable } = fetchTargets([a('threads', 'x'), a('threads', 'x')], [a('threads', 'x')]);
    expect(fetchable).toHaveLength(1);
  });

  it('leaves out platforms with no profile endpoint, and says so through `seen`', () => {
    // LinkedIn accounts can only get a baseline by recurring in discovery; the caller uses `seen`
    // to route exactly those down the accumulated-baseline path instead.
    const { fetchable, seen } = fetchTargets([a('linkedin', 'someone'), a('instagram', 'other')]);
    expect(fetchable.map((f) => f.handle)).toEqual(['other']);
    expect(seen.has('linkedin:someone')).toBe(false);
  });

  it('does not apply that filter to the queue, which was already filtered when it was written', () => {
    const { fetchable } = fetchTargets([], [a('reddit', 'r/pizza')]);
    expect(fetchable).toHaveLength(1);
  });
});
