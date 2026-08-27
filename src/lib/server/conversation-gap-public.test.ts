import { describe, it, expect } from 'vitest';
import {
  estimateDemandRange,
  computeGapScore,
  confidenceFrom,
  DEMAND_PER_POST,
  _test
} from './conversation-gap-public';

describe('estimateDemandRange', () => {
  it('returns zeros for empty input', () => {
    expect(estimateDemandRange([])).toEqual({ low: 0, high: 0, mid: 0 });
    expect(estimateDemandRange([0, 0])).toEqual({ low: 0, high: 0, mid: 0 });
  });

  it('discounts for overlap and widens into a band', () => {
    const r = estimateDemandRange([1000, 500]);
    // 1500 * 0.75 = 1125 mid; low ≈ 0.7×, high ≈ 1.35×
    expect(r.mid).toBe(1125);
    expect(r.low).toBe(Math.round(1125 * 0.7));
    expect(r.high).toBe(Math.round(1125 * 1.35));
    expect(r.low).toBeLessThan(r.mid);
    expect(r.high).toBeGreaterThan(r.mid);
  });

  it('applies a heavier overlap discount when many related terms', () => {
    const many = estimateDemandRange([100, 100, 100, 100, 100, 100, 100, 100]);
    const few = estimateDemandRange([400, 400]);
    // Same raw sum (800) but many-terms mid should be lower due to overlap factor.
    expect(many.mid).toBeLessThan(few.mid);
  });
});

describe('computeGapScore', () => {
  it('is 0 when there is no demand', () => {
    expect(computeGapScore(0, 4)).toBe(0);
  });

  it('is near 100 when cadence capacity is tiny vs demand', () => {
    expect(computeGapScore(10_000, 0.25)).toBeGreaterThan(90);
  });

  it('drops when cadence covers demand', () => {
    const demand = DEMAND_PER_POST * 8;
    expect(computeGapScore(demand, 8)).toBe(0);
    expect(computeGapScore(demand, 4)).toBe(50);
  });

  it('clamps to 0–100', () => {
    expect(computeGapScore(1_000_000, 0.1)).toBeLessThanOrEqual(100);
    expect(computeGapScore(10, 1000)).toBeGreaterThanOrEqual(0);
  });
});

describe('confidenceFrom', () => {
  it('is high with several DataForSEO volume hits', () => {
    expect(
      confidenceFrom({ volumeHits: 5, phrasingCount: 8, source: 'dataforseo', hasLiveThreads: false })
    ).toBe('high');
  });

  it('is low when only AI phrasings with no volumes', () => {
    expect(confidenceFrom({ volumeHits: 0, phrasingCount: 2, source: 'ai', hasLiveThreads: false })).toBe(
      'low'
    );
  });

  it('is medium with sparse volumes', () => {
    expect(
      confidenceFrom({ volumeHits: 2, phrasingCount: 6, source: 'mixed', hasLiveThreads: false })
    ).toBe('medium');
  });
});

describe('brand filter helpers', () => {
  it('detects branded phrasings', () => {
    expect(_test.containsBrand('best anomalia alternative', ['Anomalia'])).toBe(true);
    expect(_test.containsBrand('social media autopilot', ['Anomalia'])).toBe(false);
  });

  it('extracts title and headings from html', () => {
    const html = `<html><head><title>Acme Widgets</title>
      <meta name="description" content="We sell widgets" /></head>
      <body><h1>Buy widgets</h1><script>evil()</script><p>Hello world content here</p></body></html>`;
    const s = _test.extractPageSignals(html, 'https://acme.example');
    expect(s.title).toBe('Acme Widgets');
    expect(s.description).toBe('We sell widgets');
    expect(s.headings).toContain('Buy widgets');
    expect(s.text).toContain('Hello world');
    expect(s.text).not.toContain('evil');
  });
});
