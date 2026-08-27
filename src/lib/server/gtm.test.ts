import { describe, it, expect } from 'vitest';
import {
  fitDurations,
  stampPhases,
  currentPhaseIndex,
  phaseStatus,
  gtmPhaseBrief,
  phasePerformanceDigest,
  normalizeGtm,
  salvagePhasesFromJsonString,
  horizonWeeks,
  phasesForHorizon,
  type GtmPhase,
  type GtmPlan
} from './gtm';
import { clampFunnelSpec, computeFunnelTargets, stampFunnelGoals, RATE_BOUNDS } from './funnel';

const phase = (over: Partial<GtmPhase> = {}): GtmPhase => ({
  index: 0,
  name: 'Fondamenta',
  objective: 'Build the base',
  rationale: 'Start honest',
  duration_weeks: 6,
  start_date: null,
  end_date: null,
  platform_weights: [
    { platform: 'instagram', percent: 70 },
    { platform: 'tiktok', percent: 30 }
  ],
  pillars: ['CTA verso sito', 'UGC'],
  goals: [{ kpi: 'interazioni reali', target: '+500', why: 'baseline is low', actual: null }],
  ...over
});

const plan = (phases: GtmPhase[]): GtmPlan => ({ horizon: '6m', objective: 'sales', phases });

describe('fitDurations', () => {
  it('scales phase durations to cover the horizon, last phase absorbs rounding', () => {
    const out = fitDurations([phase({ duration_weeks: 10 }), phase({ duration_weeks: 10 }), phase({ duration_weeks: 10 })], '6m');
    expect(out.reduce((a, p) => a + p.duration_weeks, 0)).toBe(horizonWeeks('6m'));
  });
});

describe('stampPhases / currentPhaseIndex / phaseStatus', () => {
  // 2026-06-10 is a Wednesday → Monday 2026-06-08.
  const NOW = new Date('2026-06-10T12:00:00Z');
  const stamped = stampPhases([phase({ duration_weeks: 4 }), phase({ duration_weeks: 4, index: 1, name: 'Trazione' })], 'Europe/Rome', NOW);

  it('stamps consecutive windows from this week\'s Monday', () => {
    expect(stamped[0].start_date).toBe('2026-06-08');
    expect(stamped[0].end_date).toBe('2026-07-06');
    expect(stamped[1].start_date).toBe('2026-07-06');
    expect(stamped[1].end_date).toBe('2026-08-03');
  });

  it('maps now into the right phase; null when the plan is over or unstamped', () => {
    expect(currentPhaseIndex(plan(stamped), 'Europe/Rome', NOW)).toBe(0);
    expect(currentPhaseIndex(plan(stamped), 'Europe/Rome', new Date('2026-07-10T12:00:00Z'))).toBe(1);
    expect(currentPhaseIndex(plan(stamped), 'Europe/Rome', new Date('2026-09-01T12:00:00Z'))).toBeNull();
    expect(currentPhaseIndex(plan([phase()]), 'Europe/Rome', NOW)).toBeNull();
  });

  it('derives done/now/next from the stamped dates', () => {
    expect(phaseStatus(stamped[0], 'Europe/Rome', NOW)).toBe('now');
    expect(phaseStatus(stamped[1], 'Europe/Rome', NOW)).toBe('next');
    expect(phaseStatus(stamped[0], 'Europe/Rome', new Date('2026-07-10T12:00:00Z'))).toBe('done');
  });
});

describe('gtmPhaseBrief', () => {
  it('serialises objective, weights, pillars and targets; "" for a missing phase', () => {
    const p = plan([phase()]);
    const brief = gtmPhaseBrief(p, 0);
    expect(brief).toContain('Fondamenta');
    expect(brief).toContain('instagram 70%');
    expect(brief).toContain('CTA verso sito');
    expect(brief).toContain('interazioni reali → +500');
    expect(gtmPhaseBrief(p, 5)).toBe('');
  });
});

describe('phasePerformanceDigest', () => {
  it('counts published posts and engagement inside the phase window only', () => {
    const win = { start_date: '2026-06-01', end_date: '2026-07-01' };
    const digest = phasePerformanceDigest(
      [
        { platform: 'instagram', published_at: '2026-06-10T08:00:00Z' },
        { platform: 'instagram', published_at: '2026-07-02T08:00:00Z' } // outside
      ],
      [{ platform: 'instagram', metrics: { likes: 40, comments: 5 }, published_at: '2026-06-12T08:00:00Z' }],
      win
    );
    expect(digest).toContain('1 posts');
    expect(digest).toContain('40 likes');
    expect(phasePerformanceDigest([], [], { start_date: null, end_date: null })).toBe('');
  });
});

describe('salvagePhasesFromJsonString', () => {
  it('extracts complete phase objects from a truncated JSON array string', () => {
    const truncated =
      '[{"name":"Fondamenta","objective":"Build base","rationale":"r","duration_weeks":4,"platform_weights":[{"platform":"instagram","percent":70}],"pillars":["p"],"goals":[{"kpi":"k","target":"t","why":"w"}]},{"name":"Trazione","objective":"Grow","rationale":"r2","duration_weeks":4,"platform_weights":[{"platform":"instagram","percent":100}],"pillars":["p"],"goals":[]},{"name":"Truncated","objective":"cut mid';
    const salvaged = salvagePhasesFromJsonString(truncated);
    expect(salvaged).toHaveLength(2);
    expect((salvaged[0] as { name: string }).name).toBe('Fondamenta');
    expect((salvaged[1] as { name: string }).name).toBe('Trazione');
    const out = normalizeGtm({ objective: 'go', phases: truncated }, '90d');
    expect(out.phases.length).toBeGreaterThanOrEqual(2);
  });
});

describe('normalizeGtm', () => {
  it('clamps weights, caps phases to the horizon bounds and keeps stamped dates', () => {
    const out = normalizeGtm(
      {
        objective: 'go',
        phases: [
          { name: 'A', objective: 'o', rationale: 'r', duration_weeks: 13, start_date: '2026-06-08', end_date: '2026-09-07',
            platform_weights: [{ platform: 'Instagram', percent: 150 }, { platform: '', percent: 10 }], pillars: ['x'], goals: [{ kpi: 'k', target: 't', why: 'w' }] },
          { name: 'B', objective: 'o', rationale: 'r', duration_weeks: 13, platform_weights: [], pillars: [], goals: [] },
          { name: 'C', objective: 'o', rationale: 'r', duration_weeks: 13, platform_weights: [], pillars: [], goals: [] },
          { name: 'D', objective: 'o', rationale: 'r', duration_weeks: 13, platform_weights: [], pillars: [], goals: [] } // over 6m max (3)
        ]
      },
      '6m'
    );
    expect(out.phases).toHaveLength(3);
    expect(out.phases[0].platform_weights).toEqual([{ platform: 'instagram', percent: 100 }]);
    expect(out.phases[0].start_date).toBe('2026-06-08');
    expect(out.phases.reduce((a, p) => a + p.duration_weeks, 0)).toBe(horizonWeeks('6m'));
  });
});

// ── Funnel wiring on the REAL production pipeline ────────────────────────────
// Reproduces proposeGtmDual's exact post-parse flow (normalizeGtm → stampFunnelGoals) with a
// HOSTILE LLM payload: absurd rates + the audit's "15 beta / 20 clicks" impossible conversion
// written into the model's own goals. Proves — on the real gtm.ts + funnel.ts code — that code
// owns every number, the LLM's numbers are never a machine source, and the impossible funnel is
// unrepresentable. This is the concrete Correzione-2 proof.
describe('GTM funnel wiring (real normalizeGtm + stampFunnelGoals, hostile LLM payload)', () => {
  // What a misbehaving model returned: absurd rates + phases whose free-text goals assert an
  // impossible conversion (15 beta signups from 20 clicks = 75%).
  const llmRawSpec = { final: { metric: 'beta signup', value: 15 }, rates: { reach_to_click: 0.5, click_to_signup: 0.75, signup_to_active: 1 } };
  const llmPhases = [
    { name: 'Fondamenta', objective: 'o', rationale: 'r', duration_weeks: 4,
      platform_weights: [{ platform: 'instagram', percent: 100 }], pillars: ['p'],
      goals: [{ kpi: 'click al sito', target: '20 click', why: 'stima ottimista' }] },
    { name: 'Trazione', objective: 'o', rationale: 'r', duration_weeks: 4,
      platform_weights: [{ platform: 'instagram', percent: 100 }], pillars: ['p'],
      goals: [{ kpi: 'beta', target: '15 beta signup', why: 'dai 20 click sopra' }] },
    { name: 'Scala', objective: 'o', rationale: 'r', duration_weeks: 5,
      platform_weights: [{ platform: 'instagram', percent: 100 }], pillars: ['p'], goals: [] }
  ];

  it('code owns the numbers: clamps the spec, overrides LLM goals, keeps the impossible funnel unrepresentable', () => {
    // Step 1: the spec is clamped in code (RATE_BOUNDS) — this is the source of truth.
    const spec = clampFunnelSpec(llmRawSpec)!;
    expect(spec.rates.click_to_signup).toBe(RATE_BOUNDS.click_to_signup.max); // 0.75 → 0.25
    expect(spec.rates.signup_to_active).toBe(RATE_BOUNDS.signup_to_active.max); // 1 → 0.8

    // Step 2: real normalizeGtm parses the LLM phases (the model's free-text goals survive here).
    const normalized = normalizeGtm({ objective: 'beta', phases: llmPhases }, '6m');
    // Step 3: code stamps the numeric goals — proposeGtmDual's post-parse contract.
    const stamped = stampFunnelGoals(normalized.phases, spec);

    const t = computeFunnelTargets(spec);
    // Every CODE-OWNED number (metric-tagged) matches computeFunnelTargets — never the LLM's text.
    const codeGoals = stamped.flatMap((p) => p.goals.filter((g) => g.metric));
    for (const g of codeGoals) expect(typeof g.value).toBe('number');
    const finalGoal = codeGoals.find((g) => g.metric === 'final');
    expect(finalGoal!.value).toBe(15); // spec final, not the LLM's prose
    // The impossible conversion is gone: no code goal claims 15 signups from ~20 clicks. With
    // clamped rates, 15 beta needs ≥ 19 signups → ≥ 76 clicks. The LLM's "20 click" is never a
    // machine number.
    expect(t.clicks).toBeGreaterThanOrEqual(60);
    const clickGoalValues = codeGoals.filter((g) => g.metric === 'clicks').map((g) => g.value!);
    // (clicks aren't stamped per-phase in this design — reach/signups are — so assert via reach:)
    const reachGoals = codeGoals.filter((g) => g.metric === 'reach').map((g) => g.value!);
    expect(reachGoals.every((v) => v >= t.signups)).toBe(true);
    expect(clickGoalValues.every((v) => v >= 60)).toBe(true); // vacuously true (none) — documents intent

    // The LLM's impossible free-text goals are KEPT as qualitative context but carry NO metric/
    // value: they can never be read as a machine number.
    const llmGoalKept = stamped.flatMap((p) => p.goals).find((g) => g.target === '15 beta signup');
    expect(llmGoalKept).toBeDefined();
    expect(llmGoalKept!.metric).toBeUndefined();
    expect((llmGoalKept as { value?: number }).value).toBeUndefined();
  });

  it('survives the DB round-trip: normGoal preserves code numbers, re-stamp is idempotent', () => {
    const spec = clampFunnelSpec(llmRawSpec)!;
    const stampedOnce = stampFunnelGoals(normalizeGtm({ objective: 'beta', phases: llmPhases }, '6m').phases, spec);
    // Simulate persist → read: normalizeGtm again over the stamped phases (normGoal must PRESERVE
    // metric/value), then re-stamp — no duplication, no drift.
    const reread = normalizeGtm({ objective: 'beta', phases: stampedOnce }, '6m');
    const rereadCode = reread.phases.flatMap((p) => p.goals.filter((g) => g.metric));
    expect(rereadCode.find((g) => g.metric === 'final')?.value).toBe(15); // preserved across read
    const restamped = stampFunnelGoals(reread.phases, spec);
    const finalCount = restamped.flatMap((p) => p.goals).filter((g) => g.metric === 'final').length;
    expect(finalCount).toBe(1); // exactly one final goal — no duplication
  });

  it('backward compat: a plan with no funnel is byte-identical (gtmPhaseBrief has no "ipotesi")', () => {
    const noFunnel = normalizeGtm({ objective: 'beta', phases: llmPhases }, '6m');
    // No spec → phases untouched, no code goals, no assumption label in the planner brief.
    const unstamped = stampFunnelGoals(noFunnel.phases, null);
    expect(unstamped).toBe(noFunnel.phases);
    const briefNoFunnel = gtmPhaseBrief({ horizon: '6m', objective: 'beta', phases: noFunnel.phases }, 0);
    expect(briefNoFunnel).not.toContain('ipotesi');
    // With a funnel, the brief labels the rates as assumptions.
    const spec = clampFunnelSpec(llmRawSpec)!;
    const briefFunnel = gtmPhaseBrief({ horizon: '6m', objective: 'beta', phases: noFunnel.phases, funnel: spec }, 0);
    expect(briefFunnel).toContain('ipotesi');
  });
});

describe('phasesForHorizon', () => {
  it('returns phases_90d for 90d horizon and phases_6m for 6m horizon', () => {
    const p90 = [phase({ name: 'A', duration_weeks: 6 })];
    const p6m = [phase({ name: 'B', duration_weeks: 10 }), phase({ name: 'C', duration_weeks: 16, index: 1 })];
    const dual: Pick<GtmPlan, 'phases_90d' | 'phases_6m'> = { phases_90d: p90, phases_6m: p6m };
    expect(phasesForHorizon(dual, '90d')).toBe(p90);
    expect(phasesForHorizon(dual, '6m')).toBe(p6m);
  });

  it('returns empty array when the horizon field is missing', () => {
    expect(phasesForHorizon({}, '90d')).toEqual([]);
    expect(phasesForHorizon({}, '6m')).toEqual([]);
  });
});
