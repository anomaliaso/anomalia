import { describe, expect, it } from 'vitest';
import {
  diagnoseFatigue,
  fatigueBrief,
  summarizeWindow,
  trendOf,
  type AdMetricPoint
} from './ads-fatigue';

/**
 * Build a window of points with the rates we want, at volumes above the floors.
 * `ctr` and `cvr` are fractions; `cpm` is currency per mille; `frequency` is impressions/reach.
 */
function pts(
  opts: { from: string; n: number; impressions: number; ctr: number; cpm: number; cvr?: number | null; frequency?: number | null }
): AdMetricPoint[] {
  const out: AdMetricPoint[] = [];
  for (let i = 0; i < opts.n; i++) {
    const day = String(Number(opts.from.slice(-2)) + i).padStart(2, '0');
    const clicks = Math.round(opts.impressions * opts.ctr);
    out.push({
      periodEnd: `${opts.from.slice(0, 8)}${day}`,
      impressions: opts.impressions,
      clicks,
      spend: (opts.impressions / 1000) * opts.cpm,
      reach: opts.frequency == null ? null : Math.round(opts.impressions / opts.frequency),
      conversions: opts.cvr == null ? null : Math.round(clicks * opts.cvr)
    });
  }
  return out;
}

const base = { from: '2026-03-01', n: 3, impressions: 20000 };
const later = { from: '2026-03-10', n: 3, impressions: 20000 };

describe('summarizeWindow', () => {
  it('computes rates on the totals, never as an average of averages', () => {
    const w = summarizeWindow([
      { periodEnd: '2026-03-01', impressions: 1000, clicks: 10, spend: 5, reach: 500, conversions: 1 },
      { periodEnd: '2026-03-02', impressions: 9000, clicks: 180, spend: 45, reach: 4500, conversions: 9 }
    ]);
    expect(w.ctr).toBeCloseTo(190 / 10000);
    expect(w.cpm).toBeCloseTo(5);
    expect(w.frequency).toBeCloseTo(2);
    expect(w.cvr).toBeCloseTo(10 / 190);
  });

  it('leaves conversions null when they were never synced, rather than inventing a zero', () => {
    const w = summarizeWindow([{ periodEnd: '2026-03-01', impressions: 100, clicks: 5, spend: 1 }]);
    expect(w.cvr).toBeNull();
    expect(w.frequency).toBeNull();
  });
});

describe('trendOf', () => {
  it('treats a small wobble as flat', () => {
    expect(trendOf(1, 1.05)).toBe('flat');
  });

  it('separates a decline from a collapse', () => {
    expect(trendOf(1, 0.7)).toBe('down');
    expect(trendOf(1, 0.3)).toBe('sharp_down');
  });

  it('inverts for metrics where up is bad', () => {
    expect(trendOf(10, 20, true)).toBe('sharp_down');
  });

  it('says unknown, not flat, when a side is missing', () => {
    expect(trendOf(null, 1)).toBe('unknown');
    expect(trendOf(1, null)).toBe('unknown');
  });
});

describe('diagnoseFatigue', () => {
  it('checks tracking BEFORE creative when clicks and conversions collapse together', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.5 }),
      ...pts({ ...later, ctr: 0.005, cpm: 8, cvr: 0.01, frequency: 1.5 })
    ]);
    expect(d.id).toBe('tracking_failure');
    expect(d.action).toContain('pixel');
  });

  it('names true creative fatigue: CTR down, cost stable, frequency up', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
      ...pts({ ...later, ctr: 0.012, cpm: 8, cvr: 0.05, frequency: 3.2 })
    ]);
    expect(d.id).toBe('creative_fatigue');
    expect(d.action).toContain('CONCETTI nuovi');
  });

  it('separates audience exhaustion from fatigue by the rising cost', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
      ...pts({ ...later, ctr: 0.012, cpm: 14, cvr: 0.05, frequency: 3.2 })
    ]);
    expect(d.id).toBe('audience_exhaustion');
    expect(d.action).toContain('NON risolve');
  });

  it('calls a rising CPM with intact CTR auction pressure, not a creative problem', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
      ...pts({ ...later, ctr: 0.02, cpm: 15, cvr: 0.05, frequency: 1.5 })
    ]);
    expect(d.id).toBe('auction_pressure');
  });

  it('sends a conversion-only drop post-click instead of rewriting the ad', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
      ...pts({ ...later, ctr: 0.02, cpm: 8, cvr: 0.02, frequency: 1.4 })
    ]);
    expect(d.id).toBe('post_click');
    expect(d.action).toContain('Smettere di riscrivere');
  });

  it('flags a message-match break when both rates slide at flat cost and flat frequency', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
      ...pts({ ...later, ctr: 0.014, cpm: 8, cvr: 0.035, frequency: 1.4 })
    ]);
    expect(d.id).toBe('message_match');
  });

  it('calls a concept nobody saw twice a bad concept, not fatigue', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.2 }),
      ...pts({ ...later, ctr: 0.012, cpm: 8, cvr: 0.05, frequency: 1.2 })
    ]);
    expect(d.id).toBe('bad_concept');
    expect(d.label).toContain('mai funzionato');
  });

  it('refuses to diagnose during a learning reset', () => {
    const d = diagnoseFatigue(
      [
        ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
        ...pts({ ...later, ctr: 0.012, cpm: 8, cvr: 0.05, frequency: 3.2 })
      ],
      { lastEditedAt: '2026-03-10' }
    );
    expect(d.id).toBe('learning_reset');
  });

  it('diagnoses normally when the edit predates the window being read', () => {
    const d = diagnoseFatigue(
      [
        ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
        ...pts({ ...later, ctr: 0.012, cpm: 8, cvr: 0.05, frequency: 3.2 })
      ],
      { lastEditedAt: '2026-02-01' }
    );
    expect(d.id).toBe('creative_fatigue');
  });

  it('says there is nothing to diagnose below the volume floor', () => {
    const d = diagnoseFatigue([
      { periodEnd: '2026-03-01', impressions: 200, clicks: 4, spend: 2, reach: 150, conversions: 0 },
      { periodEnd: '2026-03-02', impressions: 180, clicks: 2, spend: 2, reach: 140, conversions: 0 }
    ]);
    expect(d.id).toBe('insufficient_data');
  });

  it('says there is nothing to diagnose without a baseline window', () => {
    const d = diagnoseFatigue(pts({ ...base, n: 1, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }));
    expect(d.id).toBe('insufficient_data');
  });

  it('leaves a stable concept alone', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
      ...pts({ ...later, ctr: 0.021, cpm: 8.2, cvr: 0.05, frequency: 1.5 })
    ]);
    expect(d.id).toBe('healthy');
  });

  it('carries an evidence read so the caller knows what the diagnosis rests on', () => {
    const d = diagnoseFatigue([
      ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
      ...pts({ ...later, ctr: 0.012, cpm: 8, cvr: 0.05, frequency: 3.2 })
    ]);
    expect(d.evidence.level).toBe(4);
    expect(d.evidence.sample).toBeGreaterThan(0);
  });
});

describe('fatigueBrief', () => {
  it('prints the movements and refuses to quote a frequency threshold as a rule', () => {
    const text = fatigueBrief(
      diagnoseFatigue([
        ...pts({ ...base, ctr: 0.02, cpm: 8, cvr: 0.05, frequency: 1.4 }),
        ...pts({ ...later, ctr: 0.012, cpm: 8, cvr: 0.05, frequency: 3.2 })
      ])
    );
    expect(text).toContain('DIAGNOSI');
    expect(text).toContain('CTR');
    expect(text).toContain('Nessuna soglia assoluta');
    expect(text).toContain('Cosa mi farebbe cambiare idea');
  });
});
