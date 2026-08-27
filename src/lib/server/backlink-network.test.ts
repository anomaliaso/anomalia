import { describe, it, expect } from 'vitest';
import {
  isBacklinkNetworkEnabled,
  canUseBacklinkNetwork,
  tokenize,
  tokenOverlap,
  scoreNetworkRelevance,
  suggestAnchor,
  networkLinksBlock,
  type NetworkCandidate
} from './backlink-network';

describe('isBacklinkNetworkEnabled', () => {
  it('defaults to enabled', () => {
    expect(isBacklinkNetworkEnabled(null)).toBe(true);
    expect(isBacklinkNetworkEnabled({})).toBe(true);
    expect(isBacklinkNetworkEnabled({ enabled: true })).toBe(true);
  });

  it('honours explicit opt-out', () => {
    expect(isBacklinkNetworkEnabled({ backlinkNetwork: false })).toBe(false);
  });
});

describe('canUseBacklinkNetwork', () => {
  it('requires Starter+ and opt-in', () => {
    expect(canUseBacklinkNetwork(null)).toBe(false);
    expect(canUseBacklinkNetwork('go')).toBe(false);
    expect(canUseBacklinkNetwork('starter')).toBe(true);
    expect(canUseBacklinkNetwork('pro')).toBe(true);
    expect(canUseBacklinkNetwork('starter', { backlinkNetwork: false })).toBe(false);
  });
});

describe('tokenize / tokenOverlap', () => {
  it('drops stopwords and short tokens', () => {
    const t = tokenize('The complete guide to camping tents for your next trip');
    expect(t.has('the')).toBe(false);
    expect(t.has('complete')).toBe(true);
    expect(t.has('camping')).toBe(true);
  });

  it('scores overlap between related sets', () => {
    const a = tokenize('organic camping tents outdoor gear');
    const b = tokenize('best camping tent for outdoor weekends');
    expect(tokenOverlap(a, b)).toBeGreaterThan(0.15);
    expect(tokenOverlap(a, tokenize('unrelated crypto trading bots'))).toBe(0);
  });
});

describe('scoreNetworkRelevance', () => {
  it('rewards matching categories', () => {
    const same = scoreNetworkRelevance({
      sourceCategory: 'Outdoor gear',
      sourceAbout: 'We sell camping equipment',
      targetCategory: 'Outdoor gear',
      targetAbout: 'Hiking and camping tips',
      articleTitle: 'How to choose a camping tent',
      articleMeta: 'A complete tent buying guide'
    });
    const diff = scoreNetworkRelevance({
      sourceCategory: 'Outdoor gear',
      sourceAbout: 'We sell camping equipment',
      targetCategory: 'B2B SaaS',
      targetAbout: 'CRM for sales teams',
      articleTitle: 'How to close enterprise deals',
      articleMeta: 'Sales pipeline tips'
    });
    expect(same).toBeGreaterThan(40);
    expect(same).toBeGreaterThan(diff);
    expect(diff).toBeLessThan(25);
  });
});

describe('suggestAnchor', () => {
  it('keeps a short readable slice of the title', () => {
    expect(suggestAnchor('How to choose a camping tent for alpine trips')).toMatch(/camping/i);
    expect(suggestAnchor('')).toBe('this guide');
  });
});

describe('networkLinksBlock', () => {
  it('returns empty when there are no candidates', () => {
    expect(networkLinksBlock([])).toBe('');
  });

  it('lists exact URLs and suggested anchors', () => {
    const c: NetworkCandidate[] = [
      {
        brandId: 'b1',
        brandName: 'TrailCo',
        articleId: 'a1',
        title: 'Packing list for weekend hikes',
        url: 'https://example.com/packing-list',
        category: 'Outdoor',
        relevance: 72,
        suggestedAnchor: 'Packing list for weekend',
        rationale: 'Same category'
      }
    ];
    const block = networkLinksBlock(c);
    expect(block).toContain('https://example.com/packing-list');
    expect(block).toContain('TrailCo');
    expect(block).toContain('0–2');
  });
});
