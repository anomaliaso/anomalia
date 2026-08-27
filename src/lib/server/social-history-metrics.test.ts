import { describe, it, expect } from 'vitest';
import {
  aggregateRecentEngagement,
  dedupeSocialHistory,
  historyDedupeKey,
  metricNum
} from './social-history-metrics';

describe('metricNum', () => {
  it('coerces numbers and numeric strings', () => {
    expect(metricNum(12)).toBe(12);
    expect(metricNum('7')).toBe(7);
    expect(metricNum(null)).toBe(0);
    expect(metricNum(undefined)).toBe(0);
    expect(metricNum('x')).toBe(0);
  });
});

describe('historyDedupeKey', () => {
  it('uses Instagram shortcode from /p/ and /reel/ urls', () => {
    expect(
      historyDedupeKey({
        platform: 'instagram',
        platform_post_url: 'https://www.instagram.com/p/DbLCE63CDrH/'
      })
    ).toBe('instagram:dblce63cdrh');
    expect(
      historyDedupeKey({
        platform: 'instagram',
        platform_post_url: 'https://www.instagram.com/reel/DbLCE63CDrH/'
      })
    ).toBe('instagram:dblce63cdrh');
  });
});

describe('dedupeSocialHistory', () => {
  it('prefers zernio over scrapecreators for the same post', () => {
    const rows = dedupeSocialHistory([
      {
        source: 'scrapecreators',
        platform: 'instagram',
        platform_post_url: 'https://www.instagram.com/p/AbC123/',
        metrics: { likes: 3, comments: 0 }
      },
      {
        source: 'zernio',
        platform: 'instagram',
        platform_post_url: 'https://www.instagram.com/reel/AbC123/',
        metrics: { likes: 3, views: 25, comments: 0 }
      }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('zernio');
    expect(metricNum(rows[0].metrics?.views)).toBe(25);
  });

  it('keeps scrapecreators thumbnail when zernio wins on metrics', () => {
    const rows = dedupeSocialHistory([
      {
        source: 'scrapecreators',
        platform: 'instagram',
        platform_post_url: 'https://www.instagram.com/p/AbC123/',
        thumbnail_url: 'https://cdn.example/expired.jpg',
        thumbnail_path: 'owner/brand/history/abc.jpg',
        metrics: { likes: 3 }
      },
      {
        source: 'zernio',
        platform: 'instagram',
        platform_post_url: 'https://www.instagram.com/reel/AbC123/',
        metrics: { likes: 3, views: 25 }
      }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('zernio');
    expect(rows[0].thumbnail_path).toBe('owner/brand/history/abc.jpg');
    expect(rows[0].thumbnail_url).toBe('https://cdn.example/expired.jpg');
  });
});

describe('aggregateRecentEngagement', () => {
  it('sums deduped metrics and buckets the last 7 publish days', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    const agg = aggregateRecentEngagement(
      [
        {
          source: 'scrapecreators',
          platform: 'instagram',
          platform_post_url: 'https://www.instagram.com/p/Aaa/',
          published_at: '2026-08-05T10:00:00Z',
          metrics: { likes: 2 }
        },
        {
          source: 'zernio',
          platform: 'instagram',
          platform_post_url: 'https://www.instagram.com/reel/Aaa/',
          published_at: '2026-08-05T10:00:00Z',
          metrics: { likes: 2, views: 40 }
        },
        {
          source: 'zernio',
          platform: 'instagram',
          platform_post_url: 'https://www.instagram.com/p/Bbb/',
          published_at: '2026-08-01T10:00:00Z',
          metrics: { likes: 5, views: 10 }
        },
        {
          source: 'zernio',
          platform: 'instagram',
          platform_post_url: 'https://www.instagram.com/p/Old/',
          published_at: '2026-07-01T10:00:00Z',
          metrics: { likes: 100, views: 1000 }
        }
      ],
      { now }
    );

    // Old post is outside spark window but still counted in totals (caller chooses the row set).
    expect(agg.posts).toBe(3);
    expect(agg.likes).toBe(107);
    expect(agg.views).toBe(1050);
    // Aug 5 is index 6 (today Aug 6 → oldest = Jul 31)
    expect(agg.likesByDay[agg.likesByDay.length - 2]).toBe(2);
    expect(agg.viewsByDay[agg.viewsByDay.length - 2]).toBe(40);
  });
});
