import { describe, expect, it } from 'vitest';
import { checkGtmFeasibility } from './check-gtm-feasibility';
import type { GtmPhase, GtmPlan } from './gtm';

const phase = (over: Partial<GtmPhase> = {}): GtmPhase => ({
  index: 0,
  name: 'Fondamenta',
  objective: 'Build base',
  rationale: 'Start',
  duration_weeks: 6,
  start_date: null,
  end_date: null,
  platform_weights: [
    { platform: 'instagram', percent: 70 },
    { platform: 'reddit', percent: 30 }
  ],
  pillars: ['CTA'],
  goals: [{ kpi: 'reach', target: '+500', why: 'baseline', actual: null }],
  ...over
});

function dualPlan(overrides: Partial<GtmPlan> = {}): GtmPlan {
  const p90 = [phase({ duration_weeks: 6 }), phase({ index: 1, name: 'Trazione', duration_weeks: 7 })];
  const p6m = [
    phase({ duration_weeks: 8 }),
    phase({ index: 1, name: 'Trazione', duration_weeks: 9 }),
    phase({ index: 2, name: 'Scale', duration_weeks: 9 })
  ];
  return {
    horizon: '6m',
    objective: 'Grow organically',
    phases: p6m,
    phases_90d: p90,
    phases_6m: p6m,
    ...overrides
  };
}

const ctx = { selectedPlatforms: ['instagram', 'reddit'] };

describe('checkGtmFeasibility', () => {
  it('passes a valid dual-horizon plan', () => {
    expect(checkGtmFeasibility(dualPlan(), ctx)).toEqual([]);
  });

  it('flags empty objective', () => {
    expect(checkGtmFeasibility(dualPlan({ objective: '' }), ctx).some((v) => v.includes('objective'))).toBe(true);
  });

  it('flags platform not in selected list', () => {
    const bad = dualPlan();
    bad.phases_90d![0].platform_weights = [{ platform: 'tiktok', percent: 100 }];
    expect(checkGtmFeasibility(bad, ctx).some((v) => v.includes('tiktok'))).toBe(true);
  });
});
