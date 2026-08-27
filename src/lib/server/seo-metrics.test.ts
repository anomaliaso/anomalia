import { describe, expect, it } from 'vitest';
import { normalizeDomainRank } from './dataforseo';
import { buildSeoMetrics } from './seo-metrics';

describe('normalizeDomainRank', () => {
  it('passes through 0–100 values', () => {
    expect(normalizeDomainRank(42)).toBe(42);
    expect(normalizeDomainRank(0)).toBe(0);
    expect(normalizeDomainRank(100)).toBe(100);
  });

  it('converts legacy 0–1000 ranks', () => {
    // Published example: 694 → ~89
    expect(normalizeDomainRank(694)).toBe(89);
  });
});

describe('buildSeoMetrics', () => {
  it('prefers nested monthly history and surfaces new keywords', () => {
    const metrics = buildSeoMetrics([
      {
        created_at: '2026-08-01T00:00:00Z',
        search: {
          domain: 'example.com',
          organicKeywords: 120,
          estMonthlyTraffic: 900,
          keywordsTop10: 18,
          topKeywords: [
            { keyword: 'new thing', position: 4, volume: 200, difficulty: 20, intent: 'informational' },
            { keyword: 'old thing', position: 2, volume: 500, difficulty: 30, intent: 'commercial' }
          ],
          history: [
            {
              year: 2026,
              month: 6,
              organicKeywords: 100,
              estMonthlyTraffic: 700,
              keywordsTop10: 12,
              keywordsNew: 5,
              keywordsLost: 2,
              keywordsUp: 10,
              keywordsDown: 3
            },
            {
              year: 2026,
              month: 7,
              organicKeywords: 120,
              estMonthlyTraffic: 900,
              keywordsTop10: 18,
              keywordsNew: 14,
              keywordsLost: 4,
              keywordsUp: 8,
              keywordsDown: 6
            }
          ]
        },
        backlinks: {
          domain: 'example.com',
          rank: 55,
          backlinks: 400,
          referringDomains: 80,
          referringPages: 200,
          brokenBacklinks: 1,
          spamScore: 5,
          dofollow: 300,
          nofollow: 100,
          topTlds: [{ tld: 'com', count: 50 }],
          history: [
            {
              date: '2026-06-01',
              rank: 50,
              backlinks: 350,
              referringDomains: 70,
              newBacklinks: 10,
              lostBacklinks: 2,
              newReferringDomains: 3,
              lostReferringDomains: 1
            },
            {
              date: '2026-07-01',
              rank: 55,
              backlinks: 400,
              referringDomains: 80,
              newBacklinks: 20,
              lostBacklinks: 5,
              newReferringDomains: 8,
              lostReferringDomains: 2
            }
          ]
        }
      },
      {
        created_at: '2026-07-01T00:00:00Z',
        search: {
          domain: 'example.com',
          organicKeywords: 100,
          estMonthlyTraffic: 700,
          keywordsTop10: 12,
          topKeywords: [
            { keyword: 'old thing', position: 3, volume: 500, difficulty: 30, intent: 'commercial' }
          ]
        }
      }
    ]);

    expect(metrics.domainRating).toBe(55);
    expect(metrics.traffic).toBe(900);
    expect(metrics.keywordsNew).toBe(14);
    expect(metrics.trend.length).toBeGreaterThanOrEqual(2);
    expect(metrics.trend[0].label).toBe('2026-06');
    expect(metrics.newTopKeywords.map((k) => k.keyword)).toEqual(['new thing']);
    expect(metrics.dofollow).toBe(300);
  });

  it('normalises legacy domain ranks on read', () => {
    const metrics = buildSeoMetrics([
      {
        created_at: '2026-08-01T00:00:00Z',
        backlinks: {
          domain: 'example.com',
          rank: 694,
          backlinks: 10,
          referringDomains: 3,
          referringPages: 5,
          brokenBacklinks: 0,
          spamScore: 0,
          dofollow: 10,
          nofollow: 0,
          topTlds: []
        }
      }
    ]);
    expect(metrics.domainRating).toBe(89);
  });
});
