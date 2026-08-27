import { describe, expect, it } from 'vitest';
import {
  visualInsightsBlock,
  VISUAL_WINNERS_NO_DATA,
  type VisualInsightRow
} from './platform-hygiene';

describe('visual-insights block', () => {
  const base = (over: Partial<VisualInsightRow> = {}): VisualInsightRow => ({
    dimension: 'genre',
    value: 'raw_ugc',
    n: 6,
    er_avg: 3.2,
    delta: 1.4,
    ...over
  });

  it('formats present data into the WINNING VISUALS block', () => {
    const block = visualInsightsBlock([base()]);
    expect(block).toContain('VISUAL WINNERS — what performs for THIS brand');
    expect(block).toContain('- genre: raw_ugc (+1.4% ER vs avg, n=6)');
  });

  it('returns the default message when there is no data', () => {
    expect(visualInsightsBlock([])).toBe(VISUAL_WINNERS_NO_DATA);
    expect(visualInsightsBlock([base({ n: 0 }), base({ delta: null })])).toBe(VISUAL_WINNERS_NO_DATA);
  });

  it('excludes rows with n < 3', () => {
    const block = visualInsightsBlock([base({ n: 2, value: 'tiny_sample' }), base()]);
    expect(block).not.toContain('tiny_sample');
    expect(block).toContain('raw_ugc');
  });

  it('excludes rows with null delta', () => {
    const block = visualInsightsBlock([base({ delta: null, value: 'no_delta' }), base()]);
    expect(block).not.toContain('no_delta');
    expect(block).toContain('raw_ugc');
  });

  it('excludes losing buckets (delta <= 0) and formats large deltas', () => {
    const block = visualInsightsBlock([
      base({ delta: -30, value: 'losing_genre' }),
      base({ delta: 0, value: 'flat_genre' }),
      base({ delta: 12, value: 'winning_genre' })
    ]);
    expect(block).not.toContain('losing_genre');
    expect(block).not.toContain('flat_genre');
    expect(block).toContain('winning_genre (+12% ER vs avg, n=6)');
  });

  it('orders by delta descending before slicing to the limit', () => {
    const block = visualInsightsBlock(
      [base({ delta: 5, value: 'meh' }), base({ delta: 40, value: 'best' }), base({ delta: 20, value: 'good' })],
      { limit: 2 }
    );
    expect(block).not.toContain('meh');
    expect(block.indexOf('best')).toBeLessThan(block.indexOf('good'));
  });

  it('returns the default message when every bucket is below the brand mean', () => {
    expect(visualInsightsBlock([base({ delta: -10 }), base({ delta: -1, value: 'other' })])).toBe(
      VISUAL_WINNERS_NO_DATA
    );
  });

  it('renders other dimensions with the same shape', () => {
    const block = visualInsightsBlock([base({ dimension: 'hook_type', value: 'confession', delta: 3 })]);
    expect(block).toContain('- hook_type: confession (+3% ER vs avg, n=6)');
  });

  it('honours the limit', () => {
    const rows = [
      base({ value: 'a' }),
      base({ value: 'b' }),
      base({ value: 'c' })
    ];
    const block = visualInsightsBlock(rows, { limit: 2 });
    expect(block).not.toContain('genre: c');
    expect(block).toContain('genre: a');
  });
});
