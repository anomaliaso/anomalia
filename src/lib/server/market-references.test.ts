import { describe, expect, it } from 'vitest';
import { formatMarketBrief, isMarketRefsFresh, FRESH_DAYS } from './market-references';

describe('isMarketRefsFresh', () => {
  it('is false for null', () => {
    expect(isMarketRefsFresh(null)).toBe(false);
  });

  it('is true within FRESH_DAYS', () => {
    const recent = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    expect(isMarketRefsFresh(recent, FRESH_DAYS)).toBe(true);
  });

  it('is false after FRESH_DAYS', () => {
    const old = new Date(Date.now() - (FRESH_DAYS + 1) * 24 * 3600 * 1000).toISOString();
    expect(isMarketRefsFresh(old, FRESH_DAYS)).toBe(false);
  });
});

describe('formatMarketBrief', () => {
  it('returns empty for null', () => {
    expect(formatMarketBrief(null)).toBe('');
  });

  it('includes formats and hook patterns', () => {
    const brief = formatMarketBrief({
      summary: 'Video UGC dominates.',
      catalog: {
        formats: [
          {
            name: 'Mythbust talking head',
            description: 'Open with a false belief',
            whyItWorks: 'Stops the scroll',
            howToAdapt: 'Use brand’s own myth',
            media: 'video'
          }
        ],
        hooks: [{ pattern: 'Everyone thinks X — wrong', example: 'Everyone thinks AI writes itself' }],
        angles: ['anti-agency', 'one-tap approve']
      },
      references: [
        {
          competitor: 'Rival',
          platform: 'tiktok',
          content: 'Stop paying agencies',
          mediaType: 'video',
          url: null,
          thumbnailUrl: null,
          archivedPath: null,
          engagement: 1200,
          metrics: {},
          format: 'Mythbust talking head',
          hook: 'Stop paying agencies'
        }
      ]
    });
    expect(brief).toContain('MARKET TRENDING REFERENCES');
    expect(brief).toContain('Mythbust talking head');
    expect(brief).toContain('Everyone thinks X');
    expect(brief).toContain('Rival');
  });
});
