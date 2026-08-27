import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { ZERNIO_API_KEY: 'test-key' } }));

import { mapZernioAnalyticsPosts, normalizeLinkedInOrg, normalizeFacebookPage, publishPost } from './zernio';

describe('normalizeLinkedInOrg', () => {
  it('derives the URN from the id when only an id is present', () => {
    expect(normalizeLinkedInOrg({ id: '12345', name: 'Acme' })).toEqual({
      id: '12345',
      urn: 'urn:li:organization:12345',
      name: 'Acme',
      logoUrl: undefined
    });
  });

  it('derives the id from the URN and keeps a provided logo', () => {
    expect(
      normalizeLinkedInOrg({ organizationUrn: 'urn:li:organization:999', localizedName: 'Globex', logo: 'x.png' })
    ).toEqual({ id: '999', urn: 'urn:li:organization:999', name: 'Globex', logoUrl: 'x.png' });
  });

  it('falls back to a default name and skips entries with no resolvable URN', () => {
    expect(normalizeLinkedInOrg({ id: '7' })?.name).toBe('Company Page');
    expect(normalizeLinkedInOrg({ name: 'No ids here' })).toBeNull();
  });
});

describe('normalizeFacebookPage', () => {
  it('keeps id, name, username and category', () => {
    expect(
      normalizeFacebookPage({ id: '123', name: 'Acme', username: 'acme', category: 'Brand' })
    ).toEqual({ id: '123', name: 'Acme', username: 'acme', category: 'Brand' });
  });

  it('accepts pageId and falls back to a default name', () => {
    expect(normalizeFacebookPage({ pageId: '55' })).toEqual({
      id: '55',
      name: 'Facebook Page',
      username: undefined,
      category: undefined
    });
  });

  it('skips entries with no usable id', () => {
    expect(normalizeFacebookPage({ name: 'No id' })).toBeNull();
  });
});

describe('mapZernioAnalyticsPosts', () => {
  it('normalises analytics posts: external id, platform mapped, metrics extracted', () => {
    const data = {
      posts: [
        {
          _id: 'abc',
          content: 'hi',
          publishedAt: '2026-06-08T05:59:54.000Z',
          analytics: { likes: 11, comments: 32, shares: 4, impressions: 1790, views: 1790, engagementRate: 2.63 },
          platforms: [{ platform: 'twitter', platformPostId: 'p1', platformPostUrl: 'https://x.com/p1' }]
        }
      ],
      pagination: { pages: 1 }
    };
    const out = mapZernioAnalyticsPosts(data);
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe('abc');
    expect(out[0].platform).toBe('x'); // twitter → x
    expect(out[0].content).toBe('hi');
    expect(out[0].metrics.likes).toBe(11);
    expect(out[0].metrics.comments).toBe(32);
    expect(out[0].metrics.engagementRate).toBeCloseTo(2.63);
    expect(out[0].url).toBe('https://x.com/p1');
  });

  it('falls back to platformPostId when _id is missing, and skips id-less posts', () => {
    const out = mapZernioAnalyticsPosts({ posts: [{ content: 'x', platforms: [{ platformPostId: 'pp' }] }, { content: 'noid', platforms: [{}] }] });
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe('pp');
  });

  it('returns [] when there are no posts', () => {
    expect(mapZernioAnalyticsPosts({})).toEqual([]);
    expect(mapZernioAnalyticsPosts({ posts: [] })).toEqual([]);
  });
});

describe('publishPost AI-media disclosure', () => {
  let sent: Record<string, unknown>;
  beforeEach(() => {
    sent = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return { ok: true, json: async () => ({ post: { _id: 'p1' } }) } as unknown as Response;
      })
    );
  });

  const psd = () => (sent.platforms as Array<Record<string, unknown>>)[0].platformSpecificData;
  const base = { accountId: 'a1', content: 'hi', mediaUrls: ['https://x/i.jpg'] };

  it('sets each platform its own disclosure key', async () => {
    await publishPost({ ...base, platform: 'instagram', aiGeneratedMedia: true });
    expect(psd()).toEqual({ isAiGenerated: true });
    await publishPost({ ...base, platform: 'x', aiGeneratedMedia: true });
    expect(psd()).toEqual({ madeWithAi: true });
    await publishPost({ ...base, platform: 'tiktok', aiGeneratedMedia: true });
    expect(psd()).toEqual({ video_made_with_ai: true });
  });

  it('omits it for user media, for media-less posts, and for platforms with no such field', async () => {
    await publishPost({ ...base, platform: 'instagram', aiGeneratedMedia: false });
    expect(psd()).toBeUndefined();
    await publishPost({ accountId: 'a1', content: 'hi', platform: 'instagram', aiGeneratedMedia: true });
    expect(psd()).toBeUndefined();
    await publishPost({ ...base, platform: 'linkedin', aiGeneratedMedia: true });
    expect(psd()).toBeUndefined();
  });

  it('keeps the Reddit fields alongside (Reddit has no AI flag)', async () => {
    await publishPost({ ...base, platform: 'reddit', redditSubreddit: 'test', aiGeneratedMedia: true });
    expect(psd()).toEqual({ subreddit: 'test' });
  });

  it('sets YouTube title + synthetic-media flag (Shorts are not a separate post type)', async () => {
    await publishPost({
      accountId: 'a1',
      platform: 'youtube',
      content: 'First line is the title\n\nThe rest is the description.',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      aiGeneratedMedia: true
    });
    expect(psd()).toEqual({
      title: 'First line is the title',
      containsSyntheticMedia: true
    });
    await publishPost({
      accountId: 'a1',
      platform: 'youtube',
      content: 'Description only',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      youtubeTitle: 'Explicit title',
      aiGeneratedMedia: false
    });
    expect(psd()).toEqual({ title: 'Explicit title' });
  });

  it('attaches a custom thumbnail on the YouTube video item only', async () => {
    await publishPost({
      accountId: 'a1',
      platform: 'youtube',
      content: 'Title\n\nDescription',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      youtubeThumbnail: 'https://cdn.example.com/thumb.jpg'
    });
    expect(sent.mediaItems).toEqual([
      {
        type: 'video',
        url: 'https://cdn.example.com/clip.mp4',
        thumbnail: 'https://cdn.example.com/thumb.jpg'
      }
    ]);
    await publishPost({
      accountId: 'a1',
      platform: 'instagram',
      content: 'hi',
      mediaUrls: ['https://cdn.example.com/clip.mp4'],
      youtubeThumbnail: 'https://cdn.example.com/thumb.jpg'
    });
    expect(sent.mediaItems).toEqual([{ type: 'video', url: 'https://cdn.example.com/clip.mp4' }]);
  });
});
