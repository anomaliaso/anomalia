import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATEGORIES,
  categoriesForTick,
  dedupeDiscovered,
  discoverThreads,
  parseCategories,
  isFresh,
  isoFromEpoch,
  parseLinkedInSearch,
  parseRedditSearch,
  parseThreadsSearch,
  type DiscoveredPost
} from './market-discovery';

const NOW = Date.parse('2026-08-18T12:00:00Z');
const hoursAgo = (h: number) => (NOW - h * 3_600_000) / 1000;

describe('isoFromEpoch', () => {
  it('accepts seconds and milliseconds', () => {
    expect(isoFromEpoch(1_766_000_000)).toBe(new Date(1_766_000_000_000).toISOString());
    expect(isoFromEpoch(1_766_000_000_000)).toBe(new Date(1_766_000_000_000).toISOString());
  });

  it('returns null for junk', () => {
    expect(isoFromEpoch(null)).toBeNull();
    expect(isoFromEpoch(0)).toBeNull();
    expect(isoFromEpoch(-5)).toBeNull();
    expect(isoFromEpoch('banana')).toBeNull();
  });
});

describe('isFresh', () => {
  it('keeps posts inside the window', () => {
    expect(isFresh(new Date(NOW - 3_600_000).toISOString(), NOW, 2)).toBe(true);
  });

  it('drops posts older than the window', () => {
    expect(isFresh(new Date(NOW - 5 * 86_400_000).toISOString(), NOW, 2)).toBe(false);
  });

  it('drops posts with no timestamp — an undated hit cannot be placed in a daily window', () => {
    expect(isFresh(null, NOW, 2)).toBe(false);
  });

  it('rejects timestamps implausibly in the future', () => {
    expect(isFresh(new Date(NOW + 5 * 86_400_000).toISOString(), NOW, 2)).toBe(false);
  });
});

describe('parseThreadsSearch', () => {
  const payload = {
    posts: [
      {
        code: 'abc123',
        user: { username: 'someone' },
        caption: { text: 'Hai perso 3 clienti questo mese?' },
        taken_at: hoursAgo(2),
        like_count: 420,
        text_post_app_info: { direct_reply_count: 17, repost_count: 9 }
      }
    ]
  };

  it('keeps the engagement counts — the whole reason this module exists', () => {
    const [post] = parseThreadsSearch(payload, 'q');
    expect(post.metrics).toEqual({ likes: 420, comments: 17, shares: 9 });
  });

  it('keeps the handle, which stage 2 needs to fetch the account baseline', () => {
    expect(parseThreadsSearch(payload, 'q')[0].accountHandle).toBe('someone');
  });

  it('builds a usable url and a stable id', () => {
    const [post] = parseThreadsSearch(payload, 'q');
    expect(post.url).toBe('https://www.threads.net/@someone/post/abc123');
    expect(post.externalId).toBe('threads:abc123');
  });

  it('drops posts with no handle — they cannot be labelled later', () => {
    expect(parseThreadsSearch({ posts: [{ code: 'x', caption: { text: 'ciao' } }] }, 'q')).toEqual([]);
  });

  it('drops posts with no text', () => {
    expect(parseThreadsSearch({ posts: [{ code: 'x', user: { username: 'a' } }] }, 'q')).toEqual([]);
  });

  it('never throws on a malformed payload', () => {
    expect(parseThreadsSearch(null, 'q')).toEqual([]);
    expect(parseThreadsSearch({ posts: 'nope' }, 'q')).toEqual([]);
    expect(parseThreadsSearch({ posts: [null, 42] }, 'q')).toEqual([]);
  });

  it('treats a missing engagement count as 0, not NaN', () => {
    const [post] = parseThreadsSearch(
      { posts: [{ code: 'x', user: { username: 'a' }, caption: { text: 'ciao' } }] },
      'q'
    );
    expect(post.metrics).toEqual({ likes: 0, comments: 0, shares: 0 });
  });
});

describe('parseLinkedInSearch', () => {
  const payload = {
    posts: [
      {
        url: 'https://linkedin.com/posts/xyz',
        description: 'Analisi di 240 preventivi.',
        author: { name: 'Mario Rossi' },
        datePublished: '2026-08-18T09:00:00Z',
        numLikes: 88,
        numComments: 12
      }
    ]
  };

  it('extracts text, author and engagement', () => {
    const [post] = parseLinkedInSearch(payload, 'q');
    expect(post.content).toBe('Analisi di 240 preventivi.');
    expect(post.accountHandle).toBe('Mario Rossi');
    expect(post.metrics.likes).toBe(88);
    expect(post.metrics.comments).toBe(12);
  });

  it('drops entries with no url or no text', () => {
    expect(parseLinkedInSearch({ posts: [{ description: 'solo testo' }] }, 'q')).toEqual([]);
    expect(parseLinkedInSearch({ posts: [{ url: 'https://x.com' }] }, 'q')).toEqual([]);
  });
});

describe('parseRedditSearch', () => {
  const payload = {
    posts: [
      {
        permalink: '/r/smallbusiness/comments/abc/title/',
        title: 'How I fixed my follow-up',
        selftext: 'Long story short...',
        subreddit: 'smallbusiness',
        created_utc: hoursAgo(5),
        score: 340,
        num_comments: 52
      }
    ]
  };

  it('groups by subreddit rather than by author', () => {
    // A redditor's karma across unrelated subs is not a comparable denominator.
    expect(parseRedditSearch(payload, 'q')[0].accountHandle).toBe('smallbusiness');
  });

  it('joins title and body into the scored text', () => {
    expect(parseRedditSearch(payload, 'q')[0].content).toContain('How I fixed my follow-up');
    expect(parseRedditSearch(payload, 'q')[0].content).toContain('Long story short');
  });

  it('builds an absolute url from the permalink', () => {
    expect(parseRedditSearch(payload, 'q')[0].url).toBe(
      'https://www.reddit.com/r/smallbusiness/comments/abc/title/'
    );
  });

  it('drops links that are not comment threads', () => {
    expect(parseRedditSearch({ posts: [{ permalink: '/r/x/', title: 'hi' }] }, 'q')).toEqual([]);
  });
});

describe('dedupeDiscovered', () => {
  const p = (externalId: string): DiscoveredPost => ({
    platform: 'threads',
    externalId,
    url: 'u',
    accountHandle: 'a',
    content: 'c',
    mediaType: 'text',
    mediaUrl: null,
    publishedAt: null,
    metrics: { likes: 0, comments: 0, shares: 0 },
    query: 'q'
  });

  it('keeps the first sighting when several queries surface the same post', () => {
    expect(dedupeDiscovered([p('a'), p('b'), p('a')]).map((x) => x.externalId)).toEqual(['a', 'b']);
  });
});

describe('categoriesForTick', () => {
  const cats = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, queries: [id] }));

  it('walks a fixed slice per tick, so breadth comes from rotation not from volume', () => {
    expect(categoriesForTick(cats, 0, 2).map((c) => c.id)).toEqual(['a', 'b']);
    expect(categoriesForTick(cats, 1, 2).map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('wraps around the end of the list', () => {
    expect(categoriesForTick(cats, 4, 2).map((c) => c.id)).toEqual(['e', 'a']);
  });

  it('reaches every category over enough ticks — none is starved', () => {
    const seen = new Set<string>();
    for (let tick = 0; tick < cats.length; tick++) {
      for (const c of categoriesForTick(cats, tick, 2)) seen.add(c.id);
    }
    expect(seen.size).toBe(cats.length);
  });

  it('handles a negative or oversized tick index', () => {
    expect(categoriesForTick(cats, -1, 2).map((c) => c.id)).toEqual(['e', 'a']);
    expect(categoriesForTick(cats, 99, 2)).toHaveLength(2);
  });

  it('never returns more categories than exist', () => {
    expect(categoriesForTick(cats, 0, 99)).toHaveLength(cats.length);
  });

  it('returns nothing for an empty list or a non-positive size', () => {
    expect(categoriesForTick([], 0, 2)).toEqual([]);
    expect(categoriesForTick(cats, 0, 0)).toEqual([]);
  });
});

describe('parseCategories', () => {
  it('falls back to the defaults rather than harvesting nothing', () => {
    expect(parseCategories(null)).toBe(DEFAULT_CATEGORIES);
    expect(parseCategories('not json')).toBe(DEFAULT_CATEGORIES);
    expect(parseCategories('{"not":"an array"}')).toBe(DEFAULT_CATEGORIES);
    expect(parseCategories('[]')).toBe(DEFAULT_CATEGORIES);
  });

  it('accepts a valid override', () => {
    const parsed = parseCategories('[{"id":"pets","queries":["dog grooming"],"risingSubreddits":["dogs"]}]');
    expect(parsed).toEqual([{ id: 'pets', queries: ['dog grooming'], risingSubreddits: ['dogs'] }]);
  });

  it('drops entries with no id or no queries', () => {
    expect(parseCategories('[{"id":"x"},{"queries":["a"]}]')).toBe(DEFAULT_CATEGORIES);
  });
});

describe('DEFAULT_CATEGORIES', () => {
  it('has unique ids', () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every category at least one query', () => {
    for (const c of DEFAULT_CATEGORIES) expect(c.queries.length).toBeGreaterThan(0);
  });
});

describe('media extraction', () => {
  it('prefers the video url and marks the post as video', () => {
    const [post] = parseThreadsSearch(
      {
        posts: [
          {
            code: 'v1',
            user: { username: 'a' },
            caption: { text: 'clip' },
            taken_at: hoursAgo(1),
            video_versions: [{ url: 'https://cdn/x.mp4' }],
            image_versions2: { candidates: [{ url: 'https://cdn/x.jpg' }] }
          }
        ]
      },
      'q'
    );
    expect(post.mediaType).toBe('video');
    expect(post.mediaUrl).toBe('https://cdn/x.mp4');
  });

  it('falls back to the image when there is no video', () => {
    const [post] = parseThreadsSearch(
      {
        posts: [
          {
            code: 'i1',
            user: { username: 'a' },
            caption: { text: 'foto' },
            taken_at: hoursAgo(1),
            image_versions2: { candidates: [{ url: 'https://cdn/x.jpg' }] }
          }
        ]
      },
      'q'
    );
    expect(post.mediaType).toBe('image');
    expect(post.mediaUrl).toBe('https://cdn/x.jpg');
  });

  it('reports a text post with no media', () => {
    const [post] = parseThreadsSearch(
      { posts: [{ code: 't1', user: { username: 'a' }, caption: { text: 'solo testo' }, taken_at: hoursAgo(1) }] },
      'q'
    );
    expect(post.mediaType).toBe('text');
    expect(post.mediaUrl).toBeNull();
  });
});

describe('error surfacing', () => {
  // A source that fails must not look like a source that found nothing: the first needs fixing,
  // the second is a normal quiet day. These two outcomes have to be distinguishable downstream.
  it('an unparseable payload is reported, not silently empty', async () => {
    const outcome = await discoverThreads('__no_such_query__');
    expect(outcome).toHaveProperty('posts');
    expect(Array.isArray(outcome.posts)).toBe(true);
  });

  it('a genuinely empty result set carries no error', () => {
    // parse* returning [] from a well-formed payload is a quiet day, not a fault.
    expect(parseThreadsSearch({ posts: [] }, 'q')).toEqual([]);
  });
});
