import { describe, it, expect } from 'vitest';
import {
  keywordStrategyBlock,
  isFresh,
  scoreOpportunity,
  FRESH_DAYS,
  type KeywordStrategy
} from './seo-keyword-strategy';

describe('keywordStrategyBlock', () => {
  it('returns empty string for null', () => {
    expect(keywordStrategyBlock(null)).toBe('');
  });

  it('renders focus, keywords and competitor gaps', () => {
    const s: KeywordStrategy = {
      focusSummary: 'Own the budget-travel niche.',
      keywords: [
        {
          keyword: 'cheap flights europe',
          intent: 'commercial',
          opportunity: 'high',
          rationale: 'high demand, weak competitor content',
          action: 'Write a comparison landing page',
          volume: 2400,
          difficulty: 28
        }
      ],
      competitorGaps: [{ competitor: 'Skyscanner', gap: 'no long-form guides' }]
    };
    const block = keywordStrategyBlock(s);
    expect(block).toContain('cheap flights europe (commercial, high vol=2400 kd=28)');
    expect(block).toContain('Skyscanner: no long-form guides');
    expect(block).toContain('Own the budget-travel niche.');
  });

  it('slices long input', () => {
    const s: KeywordStrategy = {
      focusSummary: 'x'.repeat(2000),
      keywords: [],
      competitorGaps: []
    };
    expect(keywordStrategyBlock(s).length).toBeLessThanOrEqual(1600);
  });
});

describe('isFresh', () => {
  it('is false for null', () => {
    expect(isFresh(null)).toBe(false);
  });

  it('is true within the bi-weekly freshness window', () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    expect(isFresh(recent)).toBe(true);
    expect(FRESH_DAYS).toBe(14);
  });

  it('is false past the freshness window', () => {
    const old = new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString();
    expect(isFresh(old)).toBe(false);
  });

  it('is false for a future timestamp (clock skew) and for garbage', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isFresh(future)).toBe(false);
    expect(isFresh('not-a-date')).toBe(false);
  });
});

describe('scoreOpportunity', () => {
  it('marks high-volume low-difficulty as high', () => {
    expect(scoreOpportunity(500, 30)).toBe('high');
  });

  it('marks zero volume as low', () => {
    expect(scoreOpportunity(0, 10)).toBe('low');
  });

  it('marks high difficulty as lower opportunity', () => {
    expect(scoreOpportunity(200, 85)).toBe('low');
  });
});
