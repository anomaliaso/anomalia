// The DETERMINISTIC FUNNEL — the arithmetic layer under the GTM plan's numeric targets.
// Before this module, every phase's KPI was free text generated in isolation: the model could
// write "15 beta signups" in one phase and "20 clicks" in another — a 75% click→signup
// conversion that cannot exist. Now the numbers flow ONE way:
//
//   FunnelSpec (explicit, visible, editable assumptions: final objective + three rates)
//     → computeFunnelTargets (backward arithmetic, in code)
//       → stampFunnelGoals (cumulative per-phase milestones, written by CODE onto the phases)
//
// The LLM proposes the spec's starting values (clamped into RATE_BOUNDS) and writes strategy
// PROSE around the computed numbers — it is never the source of any number. Every label this
// module emits says "ipotesi" (assumption): the rates are hypotheses to revisit, not promises.
//
// Everything here is pure and synchronous — no LLM, no DB — so the arithmetic is testable.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type FunnelRates = {
  reach_to_click: number; // fraction, e.g. 0.02
  click_to_signup: number; // fraction, e.g. 0.08
  signup_to_active: number; // fraction, e.g. 0.4
};

export type FunnelSpec = {
  // The business objective the whole funnel is computed backward from.
  final: { metric: string; value: number }; // e.g. { metric: 'utenti attivi', value: 20 }
  rates: FunnelRates;
};

// Sanity bounds — clamped in CODE so an absurd input (LLM or human) can never produce an
// absurd funnel. click→signup capped at 25%: the "15 beta from 20 clicks" class of impossible
// conversion is unrepresentable by construction.
export const RATE_BOUNDS: Record<keyof FunnelRates, { min: number; max: number }> = {
  reach_to_click: { min: 0.001, max: 0.1 },
  click_to_signup: { min: 0.005, max: 0.25 },
  signup_to_active: { min: 0.05, max: 0.8 }
};

// Honest defaults for an organic 0→1 brand — the proposal starting point when nothing better
// is known. The LLM may propose different values; they are clamped into RATE_BOUNDS either way.
export const DEFAULT_RATES: FunnelRates = { reach_to_click: 0.02, click_to_signup: 0.08, signup_to_active: 0.4 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Normalise ANY raw spec-shaped input (LLM proposal, API PUT body, DB row) into a valid spec.
// Never throws, never passes an out-of-bounds rate through. Returns null only when there is no
// usable final value — a funnel needs an objective to compute backward from.
export function clampFunnelSpec(raw: AnyRec | null | undefined): FunnelSpec | null {
  const value = Math.round(Number(raw?.final?.value));
  if (!Number.isFinite(value) || value < 1) return null;
  const rates: FunnelRates = { ...DEFAULT_RATES };
  for (const key of Object.keys(RATE_BOUNDS) as (keyof FunnelRates)[]) {
    const v = Number(raw?.rates?.[key]);
    rates[key] = Number.isFinite(v) && v > 0 ? clamp(v, RATE_BOUNDS[key].min, RATE_BOUNDS[key].max) : DEFAULT_RATES[key];
  }
  return {
    final: { metric: String(raw?.final?.metric ?? '').trim() || 'obiettivo finale', value },
    rates
  };
}

export type FunnelTargets = { active: number; signups: number; clicks: number; reach: number };

// The backward arithmetic: from the final objective up the funnel, ceiling at every stage so
// targets are always sufficient. The invariant tests rely on: signups/clicks can never exceed
// the clamped click_to_signup rate, etc.
export function computeFunnelTargets(spec: FunnelSpec): FunnelTargets {
  const active = spec.final.value;
  const signups = Math.ceil(active / spec.rates.signup_to_active);
  const clicks = Math.ceil(signups / spec.rates.click_to_signup);
  const reach = Math.ceil(clicks / spec.rates.reach_to_click);
  return { active, signups, clicks, reach };
}

// Human label for the assumptions, e.g. "reach→click 2% · click→signup 8% · signup→attivo 40%".
export function ratesLabel(rates: FunnelRates): string {
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  return `reach→click ${pct(rates.reach_to_click)} · click→signup ${pct(rates.click_to_signup)} · signup→attivo ${pct(rates.signup_to_active)}`;
}

const fmtN = (n: number) => n.toLocaleString('it-IT');

// The funnel block injected into GTM prompts: the COMPUTED numbers, explicitly labelled as
// derived from assumptions, with a hard "do not change them" contract for the model.
export function funnelBrief(spec: FunnelSpec): string {
  const t = computeFunnelTargets(spec);
  return [
    `FUNNEL TARGETS (computed DETERMINISTICALLY in code from the assumptions below — AUTHORITATIVE: never change, re-derive or invent ANY of these numbers; your job is the strategy and the prose around them):`,
    `- Final objective: ${fmtN(t.active)} ${spec.final.metric}`,
    `- Requires ≥ ${fmtN(t.signups)} signups ← ≥ ${fmtN(t.clicks)} clicks ← ≥ ${fmtN(t.reach)} reach`,
    `- Assumptions (ipotesi, not guarantees): ${ratesLabel(spec.rates)}`,
    `Numeric phase milestones are stamped onto your phases in code AFTER you answer — write qualitative goals that complement them and never contradict this arithmetic.`
  ].join('\n');
}

// ── Per-phase milestone stamping ─────────────────────────────────────────────

// The metric tags code-stamped goals carry. Their presence marks a goal as CODE-OWNED: stamping
// is idempotent (previous stamped goals are stripped and rewritten), and the LLM cannot produce
// them (the Gemini schema has no metric/value fields).
export const FUNNEL_METRICS = ['reach', 'clicks', 'signups', 'final'] as const;
export type FunnelMetric = (typeof FUNNEL_METRICS)[number];

type PhaseLike = {
  duration_weeks: number;
  goals: Array<{ kpi: string; target: string; why: string; actual: string | null; metric?: string; value?: number }>;
};

// Cumulative fraction of the funnel each phase should have banked by its END. Ramped: later
// phases carry more weight per week (audiences compound), via weight_i = duration_i * (i+1).
export function cumulativePhaseFractions(durations: number[]): number[] {
  const weights = durations.map((d, i) => Math.max(1, d) * (i + 1));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return weights.map((w, i) => {
    acc += w;
    return i === weights.length - 1 ? 1 : acc / total;
  });
}

// Stamp deterministic, cumulative funnel milestones onto the phases. CODE is the only writer of
// numeric goal values — the LLM's own qualitative goals are left untouched, and any previously
// stamped goals are replaced (idempotent). spec null/undefined → phases returned UNCHANGED
// (byte-identical): the whole funnel layer is opt-in, like rubrics.
export function stampFunnelGoals<T extends PhaseLike>(phases: T[], spec: FunnelSpec | null | undefined): T[] {
  if (!spec || !phases.length) return phases;
  const t = computeFunnelTargets(spec);
  const fracs = cumulativePhaseFractions(phases.map((p) => p.duration_weeks));
  const assumptions = `Calcolo deterministico dal funnel — ipotesi: ${ratesLabel(spec.rates)}`;
  return phases.map((phase, i) => {
    const frac = fracs[i];
    const isLast = i === phases.length - 1;
    const milestone = (total: number) => (isLast ? total : Math.ceil(total * frac));
    const stamped: PhaseLike['goals'] = [
      {
        kpi: 'Funnel · reach cumulato',
        target: `≥ ${fmtN(milestone(t.reach))} reach (ipotesi funnel)`,
        why: assumptions,
        actual: null,
        metric: 'reach',
        value: milestone(t.reach)
      },
      {
        kpi: 'Funnel · signup cumulati',
        target: `≥ ${fmtN(milestone(t.signups))} signup (ipotesi funnel)`,
        why: assumptions,
        actual: null,
        metric: 'signups',
        value: milestone(t.signups)
      },
      ...(isLast
        ? [{
            kpi: `Funnel · ${spec.final.metric}`,
            target: `≥ ${fmtN(t.active)} ${spec.final.metric} (ipotesi funnel)`,
            why: assumptions,
            actual: null,
            metric: 'final' as const,
            value: t.active
          }]
        : [])
    ];
    // Strip previously stamped goals (metric-tagged), keep the LLM's qualitative ones, append.
    const qualitative = (phase.goals ?? []).filter((g) => !g.metric);
    return { ...phase, goals: [...qualitative, ...stamped] };
  });
}
