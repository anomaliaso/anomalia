import { describe, it, expect } from 'vitest';
import {
  clampFunnelSpec,
  computeFunnelTargets,
  cumulativePhaseFractions,
  stampFunnelGoals,
  funnelBrief,
  ratesLabel,
  RATE_BOUNDS,
  DEFAULT_RATES,
  type FunnelSpec
} from './funnel';

const spec = (over: Partial<FunnelSpec> = {}): FunnelSpec => ({
  final: { metric: 'utenti attivi', value: 20, ...(over.final ?? {}) },
  rates: { ...DEFAULT_RATES, ...(over.rates ?? {}) }
});

describe('clampFunnelSpec', () => {
  it('clamps every rate into its sanity bounds', () => {
    const s = clampFunnelSpec({ final: { metric: 'beta', value: 15 }, rates: { reach_to_click: 0.9, click_to_signup: 0.75, signup_to_active: 0.001 } });
    expect(s?.rates.reach_to_click).toBe(RATE_BOUNDS.reach_to_click.max); // 0.1
    expect(s?.rates.click_to_signup).toBe(RATE_BOUNDS.click_to_signup.max); // 0.25
    expect(s?.rates.signup_to_active).toBe(RATE_BOUNDS.signup_to_active.min); // 0.05
  });

  it('falls back to honest defaults for missing/garbage rates and never throws', () => {
    const s = clampFunnelSpec({ final: { value: 10 }, rates: { click_to_signup: 'lots' } });
    expect(s?.rates).toEqual(DEFAULT_RATES);
    expect(s?.final.metric).toBe('obiettivo finale');
  });

  it('returns null without a usable final value (a funnel needs an objective)', () => {
    expect(clampFunnelSpec({ rates: DEFAULT_RATES })).toBeNull();
    expect(clampFunnelSpec({ final: { value: 0 } })).toBeNull();
    expect(clampFunnelSpec(null)).toBeNull();
  });
});

describe('computeFunnelTargets (backward arithmetic)', () => {
  it('computes each stage backward with ceilings', () => {
    const t = computeFunnelTargets(spec()); // 20 active, 40%, 8%, 2%
    expect(t.active).toBe(20);
    expect(t.signups).toBe(50); // 20 / 0.4
    expect(t.clicks).toBe(625); // 50 / 0.08
    expect(t.reach).toBe(31250); // 625 / 0.02
  });

  // THE case from the audit: the model once generated "15 beta signups" from "20 clicks" —
  // a 75% conversion. With clamped rates that funnel is UNREPRESENTABLE: 15 signups can never
  // require fewer than 60 clicks (click→signup hard-capped at 25%).
  it('makes "15 beta da 20 click" irreproducible by construction', () => {
    const s = clampFunnelSpec({
      final: { metric: 'beta signup', value: 15 },
      // Absurd input on purpose: 100% signup→active, 75% click→signup.
      rates: { reach_to_click: 0.05, click_to_signup: 0.75, signup_to_active: 1 }
    })!;
    const t = computeFunnelTargets(s);
    // 15 active / 0.8 (clamped) = 19 signups; 19 / 0.25 (clamped) = 76 clicks.
    expect(t.signups).toBeGreaterThanOrEqual(15);
    expect(t.clicks).toBeGreaterThanOrEqual(t.signups / RATE_BOUNDS.click_to_signup.max);
    expect(t.clicks).toBeGreaterThanOrEqual(60); // never "20 clicks" for 15 signups
  });

  it('property: no stage ever implies a conversion above its bound, for ANY absurd input', () => {
    const absurd = [
      { reach_to_click: 5, click_to_signup: 9, signup_to_active: 3 },
      { reach_to_click: -1, click_to_signup: 0.999, signup_to_active: 0.0001 },
      { reach_to_click: 0.5, click_to_signup: 0.5, signup_to_active: 0.5 }
    ];
    for (const rates of absurd) {
      for (const value of [1, 15, 200, 9999]) {
        const s = clampFunnelSpec({ final: { metric: 'x', value }, rates })!;
        const t = computeFunnelTargets(s);
        expect(t.signups / t.clicks).toBeLessThanOrEqual(RATE_BOUNDS.click_to_signup.max + 1e-9);
        expect(t.clicks / t.reach).toBeLessThanOrEqual(RATE_BOUNDS.reach_to_click.max + 1e-9);
        expect(t.active / t.signups).toBeLessThanOrEqual(RATE_BOUNDS.signup_to_active.max + 1e-9);
      }
    }
  });
});

describe('cumulativePhaseFractions', () => {
  it('ramps toward later phases and always ends at exactly 1', () => {
    const f = cumulativePhaseFractions([4, 4, 5]);
    expect(f.length).toBe(3);
    expect(f[0]).toBeLessThan(f[1]);
    expect(f[1]).toBeLessThan(f[2]);
    expect(f[2]).toBe(1);
    // Ramp: phase 1's share of the total is LESS than its share of the weeks (4/13).
    expect(f[0]).toBeLessThan(4 / 13);
  });
});

describe('stampFunnelGoals (code is the only writer of numbers)', () => {
  type G = { kpi: string; target: string; why: string; actual: string | null; metric?: string; value?: number };
  type P = { duration_weeks: number; goals: G[] };
  const phases = (): P[] => [
    { duration_weeks: 4, goals: [{ kpi: 'interazioni reali', target: 'crescita costante', why: 'llm prose', actual: null }] },
    { duration_weeks: 4, goals: [] },
    { duration_weeks: 5, goals: [{ kpi: 'community', target: 'prime conversazioni', why: 'llm prose', actual: null }] }
  ];

  it('stamps cumulative milestones, keeps LLM qualitative goals, labels everything as assumption', () => {
    const out = stampFunnelGoals(phases(), spec());
    // LLM goals untouched.
    expect(out[0].goals[0]).toEqual({ kpi: 'interazioni reali', target: 'crescita costante', why: 'llm prose', actual: null });
    // Stamped goals carry code-owned metric+value and the "ipotesi" label.
    const stamped0 = out[0].goals.filter((g) => g.metric);
    expect(stamped0.map((g) => g.metric)).toEqual(['reach', 'signups']);
    for (const g of stamped0) {
      expect(g.target).toContain('ipotesi funnel');
      expect(g.why).toContain('ipotesi');
      expect(typeof g.value).toBe('number');
    }
    // Milestones are cumulative and end exactly on the totals.
    const t = computeFunnelTargets(spec());
    const reachByPhase = out.map((p) => p.goals.find((g) => g.metric === 'reach')!.value!);
    expect(reachByPhase[0]).toBeLessThan(reachByPhase[1]);
    expect(reachByPhase[1]).toBeLessThan(reachByPhase[2]);
    expect(reachByPhase[2]).toBe(t.reach);
    // Final objective only on the last phase.
    expect(out[0].goals.some((g) => g.metric === 'final')).toBe(false);
    expect(out[2].goals.find((g) => g.metric === 'final')?.value).toBe(t.active);
  });

  it('is idempotent: re-stamping (even with a new spec) replaces, never duplicates or drifts', () => {
    const once = stampFunnelGoals(phases(), spec());
    const twice = stampFunnelGoals(once, spec());
    expect(twice).toEqual(once);
    // Re-stamp with a DIFFERENT spec: old numbers fully replaced — no stale value survives.
    const restamped = stampFunnelGoals(once, spec({ final: { metric: 'utenti attivi', value: 100 } }));
    const t100 = computeFunnelTargets(spec({ final: { metric: 'utenti attivi', value: 100 } }));
    expect(restamped[2].goals.find((g) => g.metric === 'final')?.value).toBe(100);
    expect(restamped[2].goals.find((g) => g.metric === 'reach')?.value).toBe(t100.reach);
    expect(restamped[0].goals.filter((g) => g.metric === 'reach').length).toBe(1);
  });

  // Backward compat: no spec → byte-identical phases (the funnel layer is opt-in).
  it('returns phases UNCHANGED when spec is null/undefined', () => {
    const p = phases();
    expect(stampFunnelGoals(p, null)).toBe(p);
    expect(stampFunnelGoals(p, undefined)).toBe(p);
  });
});

describe('funnelBrief / ratesLabel', () => {
  it('labels the numbers as computed and the rates as assumptions', () => {
    const b = funnelBrief(spec());
    expect(b).toContain('DETERMINISTICALLY');
    expect(b).toContain('ipotesi');
    expect(b).toContain('625'); // clicks — computed, in the prompt, not asked of the model
    expect(ratesLabel(spec().rates)).toBe('reach→click 2% · click→signup 8% · signup→attivo 40%');
  });
});
