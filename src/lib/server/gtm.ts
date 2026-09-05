import type { GoogleGenAI } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { benchmarkDigest, type Benchmark } from '$lib/server/research';
import { mondayOf } from '$lib/server/editorial-plan';
import type { PastWinner } from '$lib/server/content-preview';
import { aiStructured, VARIANT_LENSES, CREATIVE_TEMPERATURE, PIN_GEMINI } from '$lib/server/xiaomi';
import { clampFunnelSpec, funnelBrief, stampFunnelGoals, ratesLabel, DEFAULT_RATES, type FunnelSpec } from '$lib/server/funnel';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// The GTM (go-to-market) engine — the TIME-AXIS strategy layer above the editorial plan. It
// decides where the brand is going phase by phase: platform weights that evolve over time,
// pillars/CTAs to anchor, and honest targets calibrated on the brand's real starting data.
// Anomalia proposes; the user approves or redirects a phase conversationally (Anomalia replies with what
// it changed and why); at phase end, real KPIs are compared with targets and a course
// correction is proposed. The ACTIVE GTM phase is injected into every planner brief
// (gtmPhaseBrief), so the strategy actually steers production instead of living in a document.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrandProfile = any;

export const HORIZONS = ['90d', '6m'] as const;
export type Horizon = (typeof HORIZONS)[number];

// metric/value are the CODE-OWNED numeric channel (funnel-stamped goals only): the LLM's Gemini
// schema has no such fields, so the model cannot emit them — stampFunnelGoals is their single
// writer, and normGoal only PRESERVES them across DB round-trips.
export type GtmGoal = { kpi: string; target: string; why: string; actual: string | null; metric?: string; value?: number };
export type GtmWeight = { platform: string; percent: number };
export type GtmPhase = {
  index: number;
  name: string;
  objective: string;
  rationale: string;
  duration_weeks: number;
  // YYYY-MM-DD, stamped at activation; null on proposals. done/now/next is DERIVED from these.
  start_date: string | null;
  end_date: string | null;
  platform_weights: GtmWeight[];
  pillars: string[];
  goals: GtmGoal[];
};
export type GtmPlan = {
  id?: string;
  status?: string;
  horizon: Horizon;
  objective: string;
  phases: GtmPhase[];
  phases_90d?: GtmPhase[];
  phases_6m?: GtmPhase[];
  // The explicit funnel assumptions driving the numeric targets (gtm_plans.funnel). null/absent
  // (every pre-funnel plan) → no numeric layer: behaviour identical to before.
  funnel?: FunnelSpec | null;
  reply?: string;
  changes_summary?: string[];
};

// Returns the phases array for a given horizon from a dual-horizon plan.
export function phasesForHorizon(plan: Pick<GtmPlan, 'phases_90d' | 'phases_6m'>, h: Horizon): GtmPhase[] {
  return h === '90d' ? (plan.phases_90d ?? []) : (plan.phases_6m ?? []);
}

// ── Horizon maths ────────────────────────────────────────────────────────────
export function horizonWeeks(h: Horizon): number {
  return { '90d': 13, '6m': 26 }[h];
}
// How many phases a horizon should split into: short horizons are tactical, long ones macro.
export function phaseBounds(h: Horizon): { min: number; max: number } {
  return { '90d': { min: 2, max: 3 }, '6m': { min: 3, max: 3 } }[h];
}

// ── Normalisation (never trust LLM output shape) ─────────────────────────────

function normGoal(g: AnyRec): GtmGoal {
  return {
    kpi: String(g?.kpi ?? ''),
    target: String(g?.target ?? ''),
    why: String(g?.why ?? ''),
    actual: typeof g?.actual === 'string' && g.actual.trim() ? g.actual.trim() : null,
    // Code-owned numeric channel: PRESERVED across DB round-trips, never created here (the LLM
    // schema has no metric/value — stampFunnelGoals is the only writer).
    ...(typeof g?.metric === 'string' && g.metric ? { metric: g.metric } : {}),
    ...(Number.isFinite(Number(g?.value)) && g?.value != null ? { value: Number(g.value) } : {})
  };
}

function normPhase(p: AnyRec, i: number): GtmPhase {
  return {
    index: i,
    name: String(p?.name ?? ''),
    objective: String(p?.objective ?? ''),
    rationale: String(p?.rationale ?? ''),
    duration_weeks: Math.max(2, Math.round(Number(p?.duration_weeks) || 4)),
    start_date: typeof p?.start_date === 'string' ? p.start_date : null,
    end_date: typeof p?.end_date === 'string' ? p.end_date : null,
    platform_weights: Array.isArray(p?.platform_weights)
      ? p.platform_weights
          .map((w: AnyRec) => ({
            platform: String(w?.platform ?? '').toLowerCase().trim(),
            percent: Math.max(0, Math.min(100, Math.round(Number(w?.percent) || 0)))
          }))
          .filter((w: GtmWeight) => w.platform && w.percent > 0)
      : [],
    pillars: Array.isArray(p?.pillars) ? p.pillars.map(String).filter(Boolean).slice(0, 6) : [],
    // Cap raised 5 → 8 so code-stamped funnel goals (up to 3 per phase) survive a DB re-read on
    // top of the LLM's 2-4 qualitative ones. Existing rows carry ≤5 goals — unaffected.
    goals: Array.isArray(p?.goals) ? p.goals.map(normGoal).filter((g: GtmGoal) => g.kpi).slice(0, 8) : []
  };
}

// Scale phase durations so they sum to the horizon (the LLM is directionally right but sloppy
// on arithmetic); the last phase absorbs the rounding remainder.
export function fitDurations(phases: GtmPhase[], horizon: Horizon): GtmPhase[] {
  if (!phases.length) return phases;
  const total = phases.reduce((a, p) => a + p.duration_weeks, 0) || 1;
  const target = horizonWeeks(horizon);
  const scaled = phases.map((p) => ({ ...p, duration_weeks: Math.max(2, Math.round((p.duration_weeks / total) * target)) }));
  const sum = scaled.reduce((a, p) => a + p.duration_weeks, 0);
  scaled[scaled.length - 1].duration_weeks = Math.max(2, scaled[scaled.length - 1].duration_weeks + (target - sum));
  return scaled;
}

/** Salvage complete phase objects from a truncated JSON array string (MiMo often truncates mid-object). */
export function salvagePhasesFromJsonString(raw: string): unknown[] {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('[') ? trimmed.slice(1) : trimmed;
  const phases: unknown[] = [];
  let depth = 0;
  let inStr = false;
  let escaped = false;
  let objStart = -1;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          phases.push(JSON.parse(inner.slice(objStart, i + 1)));
        } catch {
          /* skip malformed object */
        }
        objStart = -1;
      }
    }
  }
  return phases;
}

export function normalizeGtm(raw: AnyRec, horizon: Horizon): GtmPlan {
  const bounds = phaseBounds(horizon);
  // Handle phases as string (some models return JSON-stringified arrays).
  let rawPhases = raw?.phases;
  if (typeof rawPhases === 'string') {
    console.log(`[GTM] normalizeGtm: phases is a string (${rawPhases.length} chars), attempting JSON.parse…`);
    try {
      rawPhases = JSON.parse(rawPhases);
      console.log(`[GTM] normalizeGtm: string parsed OK, got ${Array.isArray(rawPhases) ? rawPhases.length : '?'} phases`);
    } catch (e) {
      console.warn('[GTM] normalizeGtm: failed to parse phases string:', (e as Error).message);
      const salvaged = salvagePhasesFromJsonString(rawPhases);
      if (salvaged.length) {
        rawPhases = salvaged;
        console.log(`[GTM] normalizeGtm: salvaged ${salvaged.length} complete phase object(s) from truncated string`);
      } else {
      // Try fixing truncated JSON by closing open braces
      try {
        const fixed = rawPhases
          .replace(/,\s*$/, '')
          .replace(/,\s*"[^"]*$/, '')
          .replace(/"[^"]*$/, '"')  // close incomplete string value
          .replace(/\}\s*$/, '}')   // ensure last object closes
          + ']';
        rawPhases = JSON.parse(fixed);
        console.log(`[GTM] normalizeGtm: fixed truncated JSON, got ${Array.isArray(rawPhases) ? rawPhases.length : '?'} phases`);
      } catch {
        // More aggressive fix: close all open braces/brackets
        try {
          let depth = 0;
          let inStr = false;
          let escaped = false;
          let lastGood = 0;
          for (let i = 0; i < rawPhases.length; i++) {
            const ch = rawPhases[i];
            if (escaped) { escaped = false; continue; }
            if (ch === '\\') { escaped = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === '{' || ch === '[') depth++;
            if (ch === '}' || ch === ']') { depth--; if (depth === 0) lastGood = i + 1; }
          }
          if (lastGood > 0) {
            rawPhases = JSON.parse(rawPhases.slice(0, lastGood) + ']');
            console.log(`[GTM] normalizeGtm: aggressive fix worked, got ${Array.isArray(rawPhases) ? rawPhases.length : '?'} phases`);
          }
        } catch { /* give up */ }
      }
      }
    }
  }
  const phases = (Array.isArray(rawPhases) ? rawPhases : []).slice(0, bounds.max).map(normPhase);
  if (phases.length === 0) {
    console.warn(`[GTM] normalizeGtm: 0 phases for horizon ${horizon}. Raw data was:`, JSON.stringify(raw).slice(0, 500));
  }
  return {
    horizon,
    objective: String(raw?.objective ?? ''),
    phases: fitDurations(phases, horizon),
    ...(typeof raw?.reply === 'string' && raw.reply.trim() ? { reply: raw.reply.trim() } : {}),
    ...(Array.isArray(raw?.changes_summary) ? { changes_summary: raw.changes_summary.map(String).filter(Boolean) } : {})
  };
}

// ── Pure date helpers ────────────────────────────────────────────────────────

function dayKey(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Stamp consecutive phase windows starting from this week's Monday (brand tz).
export function stampPhases(phases: GtmPhase[], tz: string, now = new Date()): GtmPhase[] {
  const start = mondayOf(tz, now);
  let cursor = new Date(`${start}T00:00:00Z`);
  return phases.map((p, i) => {
    const s = cursor.toISOString().slice(0, 10);
    const end = new Date(cursor);
    end.setUTCDate(end.getUTCDate() + p.duration_weeks * 7);
    cursor = end;
    return { ...p, index: i, start_date: s, end_date: end.toISOString().slice(0, 10) };
  });
}

// Which phase `now` falls in. null when the plan is over (time for a new horizon) or unstamped.
export function currentPhaseIndex(plan: Pick<GtmPlan, 'phases'>, tz: string, now = new Date()): number | null {
  const today = dayKey(tz, now);
  const phases = plan.phases ?? [];
  if (!phases.length || !phases[0].start_date) return null;
  if (today < phases[0].start_date) return 0;
  for (const p of phases) {
    if (p.start_date && p.end_date && today >= p.start_date && today < p.end_date) return p.index;
  }
  return null;
}

// done / now / next, derived from the stamped dates (never stored).
export function phaseStatus(phase: GtmPhase, tz: string, now = new Date()): 'done' | 'now' | 'next' {
  const today = dayKey(tz, now);
  if (phase.end_date && today >= phase.end_date) return 'done';
  if (phase.start_date && today >= phase.start_date) return 'now';
  return 'next';
}

// ── GTM phase → planner brief (the inheritance link) ────────────────────────

// Serialize the CURRENT GTM phase into a brief the content planner consumes alongside the
// editorial-plan week. This is what makes the roadmap actually steer production.
export function gtmPhaseBrief(plan: GtmPlan, phaseIndex: number): string {
  const phase = plan.phases?.[phaseIndex];
  if (!phase) return '';
  const weights = (phase.platform_weights ?? []).map((w) => `${w.platform} ${w.percent}%`).join(', ');
  const goals = (phase.goals ?? []).map((g) => `${g.kpi} → ${g.target}`).join('; ');
  return [
    `GTM PHASE (the brand's growth roadmap — this period executes phase ${phaseIndex + 1}, "${phase.name}"):`,
    plan.objective ? `Business objective: ${plan.objective}` : '',
    phase.objective ? `Phase objective: ${phase.objective}` : '',
    weights ? `Platform weights this phase (bias the batch mix toward these): ${weights}.` : '',
    phase.pillars?.length ? `Anchor these pillars/CTAs in the content: ${phase.pillars.join('; ')}.` : '',
    goals ? `Phase targets the content should push toward: ${goals}.` : '',
    // '' for pre-funnel plans → brief identical to before. The rates are labelled assumptions.
    plan.funnel ? `Funnel assumptions behind the numeric targets (ipotesi, non garanzie): ${ratesLabel(plan.funnel.rates)}.` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Gemini schemas ───────────────────────────────────────────────────────────

const PHASE_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    name: { type: 'string' as const, description: 'Short phase name (e.g. "Fondamenta", "Trazione", "Scala").' },
    objective: { type: 'string' as const, description: "The phase's job in one line (e.g. 'turn attention into interest')." },
    rationale: { type: 'string' as const, description: 'Why this phase now, grounded in the data — the user reads this.' },
    duration_weeks: { type: 'number' as const, description: 'Phase length in weeks. All phases together must cover the horizon.' },
    platform_weights: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          platform: { type: 'string' as const },
          percent: { type: 'number' as const, description: 'Share of effort, 0-100. Weights in a phase sum to ~100.' }
        },
        required: ['platform', 'percent']
      },
      description: 'The weights must EVOLVE phase to phase — that evolution IS the strategy.'
    },
    pillars: { type: 'array' as const, items: { type: 'string' as const }, description: '2-4 pillars/CTAs to anchor in this phase\'s content.' },
    goals: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kpi: { type: 'string' as const, description: "Short metric label (e.g. 'interazioni reali', 'frequenza', 'click al sito')." },
          target: { type: 'string' as const, description: 'HONEST target calibrated on the starting data. Modest and concrete, never inflated.' },
          why: { type: 'string' as const, description: 'Why this target is realistic given the data.' }
        },
        required: ['kpi', 'target', 'why']
      }
    }
  },
  required: ['name', 'objective', 'rationale', 'duration_weeks', 'platform_weights', 'pillars', 'goals']
};

function gtmSchema(withReply = false) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      objective: { type: 'string' as const, description: 'The business goal the whole plan optimises for, one line.' },
      phases: { type: 'array' as const, items: PHASE_SCHEMA },
      ...(withReply
        ? {
            reply: {
              type: 'string' as const,
              description: "Your short, motivated reply to the user's request — what you changed and why, ending with a confirmation question. First person, plain language."
            },
            changes_summary: { type: 'array' as const, items: { type: 'string' as const }, description: 'What changed vs the current plan, as short user-facing bullets.' }
          }
        : {})
    },
    required: ['objective', 'phases', ...(withReply ? ['reply', 'changes_summary'] : [])]
  };
}

const GTM_SYSTEM =
  'You are a senior growth strategist at an agency, building a brand\'s go-to-market roadmap. Be specific and grounded in the data provided. Targets must be HONEST and calibrated on the brand\'s real starting point — prefer "real interactions +500", "stable cadence", "first conversion signal" over follower counts or virality promises. Inflated targets destroy trust and are a product failure.';

const HONESTY_LINE = `TARGETS: calibrate every goal on the brand's REAL starting data below (benchmark, history). Modest, concrete, verifiable. NEVER promise virality, big follower numbers or revenue the data cannot support.`;

// ── Funnel spec proposal ─────────────────────────────────────────────────────
// The LLM proposes the STARTING VALUES of the explicit FunnelSpec (final objective + the three
// conversion rates); code clamps them into RATE_BOUNDS either way — the returned spec is the
// single source of truth for every number, the model's prose never is. Best-effort: null on any
// failure, which simply means "no funnel layer" (today's behaviour).
const FUNNEL_SPEC_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    final_metric: { type: 'string' as const, description: "The final funnel objective's metric, short, in the plan's output language (e.g. 'utenti attivi', 'beta signup', 'clienti paganti'). Derived from the business objective." },
    final_value: { type: 'number' as const, description: 'The HONEST final target number for the horizon, calibrated on the starting data. Modest and concrete.' },
    reach_to_click_pct: { type: 'number' as const, description: 'Assumed reach→click rate as a PERCENT (e.g. 2 for 2%). Honest for organic social in this niche.' },
    click_to_signup_pct: { type: 'number' as const, description: 'Assumed click→signup rate as a PERCENT (e.g. 8 for 8%).' },
    signup_to_active_pct: { type: 'number' as const, description: 'Assumed signup→active rate as a PERCENT (e.g. 40 for 40%).' },
    why: { type: 'string' as const, description: 'One sentence: why these assumptions are honest for THIS brand. (Prose only — the numbers above are what count.)' }
  },
  required: ['final_metric', 'final_value', 'reach_to_click_pct', 'click_to_signup_pct', 'signup_to_active_pct', 'why']
};

async function proposeFunnelSpec(
  ai: GoogleGenAI,
  profile: BrandProfile,
  opts: Omit<ProposeGtmOpts, 'horizon'>
): Promise<FunnelSpec | null> {
  try {
    const prompt = `Propose the FUNNEL ASSUMPTIONS for this brand's go-to-market plan: the final objective (metric + number) and the three conversion rates reach→click→signup→active. These are explicit HYPOTHESES the client will see and can edit — honest starting values, not promises. Typical organic social funnels: reach→click ${DEFAULT_RATES.reach_to_click * 100}%, click→signup ${DEFAULT_RATES.click_to_signup * 100}%, signup→active ${DEFAULT_RATES.signup_to_active * 100}%; adjust for this brand's niche and starting data.

${profileBlock(profile)}
${evidenceBlock(opts)}

${opts.objective ? `Business objective (user-stated — derive the final metric/number from this): ${opts.objective}` : 'No stated objective — propose the most sensible final metric and an honest number for it.'}
${HONESTY_LINE}
${languageLine(opts.outputLanguage)}
Return JSON.`;
    const raw = await aiStructured<AnyRec>(ai, prompt, FUNNEL_SPEC_SCHEMA, GTM_SYSTEM, 'return_funnel_spec', { ...PIN_GEMINI });
    return clampFunnelSpec({
      final: { metric: raw?.final_metric, value: raw?.final_value },
      rates: {
        reach_to_click: Number(raw?.reach_to_click_pct) / 100,
        click_to_signup: Number(raw?.click_to_signup_pct) / 100,
        signup_to_active: Number(raw?.signup_to_active_pct) / 100
      }
    });
  } catch (e) {
    console.warn('[GTM] funnel spec proposal failed (continuing without funnel):', e instanceof Error ? e.message : e);
    return null;
  }
}

function profileBlock(profile: BrandProfile): string {
  return [
    `Brand: ${profile?.name ?? ''}`,
    `About: ${profile?.about ?? ''}`,
    `Category: ${profile?.category ?? ''}`,
    `Brand archetype: ${String(profile?.site_type ?? 'generic')}`,
    `Target audience: ${profile?.target_audience ?? ''}`,
    // Cap keeps tokens bounded, but must stay ABOVE the composite context's typical size —
    // ai_context accumulates history digest + visual playbook + competitive delta at the END,
    // and a 2500-char cap used to cut exactly those sections off before the strategist saw them.
    profile?.ai_context ? `\nBRAND CONTEXT & HISTORY:\n${String(profile.ai_context).slice(0, 6000)}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export type ProposeGtmOpts = {
  horizon: Horizon;
  platforms: string[];
  objective?: string; // user-stated business goal ('' → propose one)
  outputLanguage?: string;
  benchmark?: Benchmark | null;
  topPosts?: PastWinner[];
  zeroToOne?: boolean;
  // Explicit funnel assumptions override (raw spec shape, clamped in code). Provided → used as-is
  // (no LLM proposal); absent → the LLM proposes starting values; null-able failure → no funnel.
  funnelSpec?: unknown;
};

/** Runtime opts for dual-horizon GTM generation (agent path + legacy). */
export type GtmDualOpts = Omit<ProposeGtmOpts, 'horizon'> & {
  agentBrief?: string;
  supabase?: SupabaseClient;
  brandId?: string;
  userId?: string;
  agentVerbose?: boolean;
  timezone?: string;
};

function evidenceBlock(opts: GtmDualOpts): string {
  const winners = (opts.topPosts ?? []).slice(0, 6);
  return [
    opts.benchmark ? `\nMARKET BENCHMARK (real competitor numbers — calibrate weights and targets on these):\n${benchmarkDigest(opts.benchmark)}` : '',
    winners.length
      ? `\nTHE BRAND'S OWN TOP POSTS:\n` + winners.map((p) => `- [${p.platform ?? '?'}] ${String(p.content ?? '').replace(/\s+/g, ' ').slice(0, 140)}`).join('\n')
      : '',
    opts.zeroToOne ? `\nSTAGE: the brand is 0→1 — essentially no organic audience yet. Phase 1 must build foundations; growth claims must be proportionate.` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function languageLine(outputLanguage?: string): string {
  return `Write ALL user-facing prose (objective, phase names, objectives, rationales, pillars, KPI labels, targets, why) in ${outputLanguage || 'English'}; keep platform names unchanged.`;
}

// ── LLM calls ────────────────────────────────────────────────────────────────

// Number of parallel variants per horizon — more = better quality, higher cost.
const VARIANTS = 3;

// Generate a single GTM variant (one LLM call). Used in parallel by proposeGtmDual.
async function generateGtmVariant(
  ai: GoogleGenAI,
  profile: BrandProfile,
  opts: GtmDualOpts & { horizon: Horizon },
  existingPlan?: GtmPlan,
  // Anti-convergence: a distinct positioning lens per parallel variant, so the N proposals
  // explore different strategic territory instead of re-rolling the same plan (see VARIANT_LENSES).
  lens?: string,
  // The clamped funnel spec: its COMPUTED numbers enter the prompt as authoritative context (the
  // model writes prose around them); the numeric goals are stamped in code after selection.
  funnel?: FunnelSpec | null
): Promise<GtmPlan> {
  const bounds = phaseBounds(opts.horizon);
  const horizonLabel = opts.horizon === '90d' ? '90-day (13 weeks)' : '6-month (26 weeks)';
  const existingBlock = existingPlan
    ? `\nThe 90-day plan below has already been chosen. Your 6-month plan MUST extend it: keep the first ~13 weeks logically aligned with the 90-day phases (same arc, same direction), then add phases for the remaining time.\n\nCHOSEN 90-DAY PLAN:\n${JSON.stringify({ objective: existingPlan.objective, phases: existingPlan.phases.map((p) => ({ phase: p.index + 1, name: p.name, objective: p.objective, duration_weeks: p.duration_weeks, platform_weights: p.platform_weights, pillars: p.pillars, goals: p.goals.map((g) => ({ kpi: g.kpi, target: g.target })) })) }, null, 1)}\n`
    : '';
  const prompt = `Design this brand's GO-TO-MARKET roadmap over a ${horizonLabel} horizon. This is the phased growth plan a serious agency would present. The client approves it; every phase then steers content production.

${profileBlock(profile)}
${evidenceBlock(opts)}

Platforms available: ${opts.platforms.join(', ') || 'n/a'}.
${opts.objective ? `Business objective (user-stated, optimise for this): ${opts.objective}` : 'Propose the most sensible business objective for this brand.'}
${existingBlock}${lens ? `\nSTRATEGIC LENS (this proposal deliberately explores ONE direction — commit to it where the data allows, but never against the data): ${lens}\n` : ''}${funnel ? `\n${funnelBrief(funnel)}\n` : ''}${opts.agentBrief?.trim() ? `\nAGENT BRIEF (authoritative direction from prior research — incorporate into this roadmap):\n${opts.agentBrief.trim()}\n` : ''}
Produce ${bounds.min === bounds.max ? `exactly ${bounds.min}` : `${bounds.min}-${bounds.max}`} phases forming a logical arc (foundations → traction → scale/authority). For each: name, one-line objective, a data-grounded rationale, duration in weeks (together they must cover the whole horizon), platform weights that EVOLVE from phase to phase (the evolution is the strategy — e.g. one channel carries discovery early, another takes over for conversion later), 2-4 pillars/CTAs to anchor, and 2-4 goals.
${HONESTY_LINE}
${languageLine(opts.outputLanguage)}
Return JSON.`;

  const raw = await aiStructured<AnyRec>(ai, prompt, gtmSchema(), GTM_SYSTEM, 'return_result', { temperature: CREATIVE_TEMPERATURE, ...PIN_GEMINI });
  const plan = normalizeGtm(raw, opts.horizon);
  if (plan.phases.length === 0) {
    console.error(`[GTM] generateGtmVariant: 0 phases for ${opts.horizon}. Raw:`, JSON.stringify(raw).slice(0, 1000));
    throw new Error(`GTM variant failed: 0 phases for ${opts.horizon}`);
  }
  return plan;
}

// Pick the best plan from N variants using an LLM comparison call.
async function selectBestGtm(
  ai: GoogleGenAI,
  variants: GtmPlan[],
  profile: BrandProfile,
  horizon: Horizon,
  outputLanguage?: string
): Promise<GtmPlan> {
  if (variants.length === 0) throw new Error('No variants to select from');
  if (variants.length === 1) return variants[0];

  const horizonLabel = horizon === '90d' ? '90-day' : '6-month';
  const summaries = variants.map((v, i) => {
    const phaseSummary = v.phases.map((p) => `  ${p.index + 1}. "${p.name}" (${p.duration_weeks}w) — ${p.objective}; weights: ${p.platform_weights.map((w) => `${w.platform} ${w.percent}%`).join(', ')}; goals: ${p.goals.map((g) => `${g.kpi}: ${g.target}`).join('; ')}`).join('\n');
    return `\nOPTION ${i + 1}:\nObjective: ${v.objective}\nPhases:\n${phaseSummary}`;
  }).join('\n---');

  const prompt = `You are a senior strategy reviewer. Compare these ${variants.length} ${horizonLabel} GTM roadmap variants for the brand below and pick the BEST one.

${profileBlock(profile)}

VARIANTS:
${summaries}

Pick the variant with: (1) most coherent phase arc that builds logically, (2) most realistic and honest targets, (3) best platform-weight evolution that reflects a real strategy, (4) strongest alignment with the brand's data and stage.
${languageLine(outputLanguage)}
Return JSON.`;

  const schema = {
    type: 'object' as const,
    properties: {
      winner: { type: 'number' as const, description: `1-based index of the best variant (1-${variants.length}).` }
    },
    required: ['winner']
  };

  try {
    console.log(`[GTM] selecting best ${horizonLabel} from ${variants.length} variants…`);
    const raw = await aiStructured<{ winner?: number }>(ai, prompt, schema, GTM_SYSTEM, 'return_result', { ...PIN_GEMINI });
    const idx = Math.max(0, Math.min(variants.length - 1, (raw?.winner ?? 1) - 1));
    console.log(`[GTM] selected variant ${idx + 1} as best ${horizonLabel}`);
    return variants[idx];
  } catch (err) {
    console.warn(`[GTM] selection failed, falling back to variant 1:`, err);
    return variants[0];
  }
}

export async function proposeGtm(ai: GoogleGenAI, profile: BrandProfile, opts: ProposeGtmOpts): Promise<GtmPlan> {
  const bounds = phaseBounds(opts.horizon);
  // Settle the funnel spec first (caller override wins, clamped; else LLM proposes, clamped;
  // failure → null → no funnel). Same one-way flow as proposeGtmDual.
  const funnel = clampFunnelSpec(opts.funnelSpec as AnyRec) ?? (await proposeFunnelSpec(ai, profile, opts));
  const prompt = `Design this brand's GO-TO-MARKET roadmap over a ${opts.horizon === '90d' ? '90-day' : opts.horizon === '6m' ? '6-month' : opts.horizon === '1y' ? '1-year' : '2-year'} horizon (${horizonWeeks(opts.horizon)} weeks) — the phased growth plan a serious agency would present. The client approves it; every phase then steers content production.

${profileBlock(profile)}
${evidenceBlock(opts)}

Platforms available: ${opts.platforms.join(', ') || 'n/a'}.
${opts.objective ? `Business objective (user-stated, optimise for this): ${opts.objective}` : 'Propose the most sensible business objective for this brand.'}
${funnel ? `\n${funnelBrief(funnel)}\n` : ''}
Produce ${bounds.min === bounds.max ? `exactly ${bounds.min}` : `${bounds.min}-${bounds.max}`} phases forming a logical arc (foundations → traction → scale/authority). For each: name, one-line objective, a data-grounded rationale, duration in weeks (together they must cover the whole horizon), platform weights that EVOLVE from phase to phase (the evolution is the strategy — e.g. one channel carries discovery early, another takes over for conversion later), 2-4 pillars/CTAs to anchor, and 2-4 goals.
${HONESTY_LINE}
${languageLine(opts.outputLanguage)}
Return JSON.`;

  const raw = await aiStructured<AnyRec>(ai, prompt, gtmSchema(), GTM_SYSTEM, 'return_result', { ...PIN_GEMINI });
  const plan = normalizeGtm(raw, opts.horizon);
  // Code owns the numbers: stamp deterministic funnel goals over whatever the model wrote.
  plan.phases = stampFunnelGoals(plan.phases, funnel);
  plan.funnel = funnel ?? null;
  return plan;
}

export async function proposeGtmDual(ai: GoogleGenAI, profile: BrandProfile, opts: GtmDualOpts): Promise<GtmPlan> {
  return proposeGtmDualInner(ai, profile, opts);
}

async function proposeGtmDualInner(ai: GoogleGenAI, profile: BrandProfile, opts: GtmDualOpts): Promise<GtmPlan> {
  console.log(`[GTM] proposeGtmDual: generating ${VARIANTS} 90d variants in parallel…`);
  const t0 = Date.now();

  // Phase 0: settle the FUNNEL SPEC before any variant runs, so every variant reasons around the
  // SAME computed numbers. Caller-provided spec wins (clamped); else the LLM proposes starting
  // values (clamped); on failure → null → no funnel layer (pre-funnel behaviour).
  const funnel = clampFunnelSpec(opts.funnelSpec as AnyRec) ?? (await proposeFunnelSpec(ai, profile, opts));
  if (funnel) console.log(`[GTM] funnel spec: ${funnel.final.value} ${funnel.final.metric} (rates ${JSON.stringify(funnel.rates)})`);

  // Phase 1: generate N 90-day variants in parallel, each with its own positioning lens so the
  // proposals genuinely diverge (the 6m variants inherit the chosen 90d arc, so no lens there —
  // a clashing lens would fight the "MUST extend it" constraint).
  const variants90dResults = await Promise.allSettled(
    Array.from({ length: VARIANTS }, (_, i) => {
      console.log(`[GTM]   90d variant ${i + 1}/${VARIANTS} started`);
      return generateGtmVariant(ai, profile, { ...opts, horizon: '90d' }, undefined, VARIANT_LENSES[i % VARIANT_LENSES.length], funnel).then((v) => {
        console.log(`[GTM]   90d variant ${i + 1}/${VARIANTS} done — ${v.phases.length} phases: ${v.phases.map((p) => p.name).join(', ')}`);
        return v;
      });
    })
  );
  const variants90d = variants90dResults.filter((r): r is PromiseFulfilledResult<GtmPlan> => r.status === 'fulfilled').map((r) => r.value);
  const failed90d = variants90dResults.filter((r) => r.status === 'rejected');
  if (failed90d.length) console.warn(`[GTM] ${failed90d.length}/${VARIANTS} 90d variants failed`);
  if (variants90d.length === 0) throw new Error('All 90d GTM variants failed');
  console.log(`[GTM] 90d variants done in ${Date.now() - t0}ms, selecting best from ${variants90d.length}…`);
  const best90d = await selectBestGtm(ai, variants90d, profile, '90d', opts.outputLanguage);
  console.log(`[GTM] best 90d selected: ${best90d.objective}`);

  // Phase 2: generate N 6-month variants in parallel, each extending the chosen 90-day plan.
  console.log(`[GTM] generating ${VARIANTS} 6m variants (extending 90d)…`);
  const t1 = Date.now();
  const variants6mResults = await Promise.allSettled(
    Array.from({ length: VARIANTS }, (_, i) => {
      console.log(`[GTM]   6m variant ${i + 1}/${VARIANTS} started`);
      return generateGtmVariant(ai, profile, { ...opts, horizon: '6m' }, best90d, undefined, funnel).then((v) => {
        console.log(`[GTM]   6m variant ${i + 1}/${VARIANTS} done — ${v.phases.length} phases: ${v.phases.map((p) => p.name).join(', ')}`);
        return v;
      });
    })
  );
  const variants6m = variants6mResults.filter((r): r is PromiseFulfilledResult<GtmPlan> => r.status === 'fulfilled').map((r) => r.value);
  const failed6m = variants6mResults.filter((r) => r.status === 'rejected');
  if (failed6m.length) console.warn(`[GTM] ${failed6m.length}/${VARIANTS} 6m variants failed`);
  if (variants6m.length === 0) throw new Error('All 6m GTM variants failed');
  console.log(`[GTM] 6m variants done in ${Date.now() - t1}ms, selecting best from ${variants6m.length}…`);
  const best6m = await selectBestGtm(ai, variants6m, profile, '6m', opts.outputLanguage);
  console.log(`[GTM] best 6m selected: ${best6m.objective}`);
  console.log(`[GTM] proposeGtmDual total: ${Date.now() - t0}ms`);

  // POST-PARSE STAMPING — the Correzione-2 contract: whatever the model wrote, the numeric goals
  // are (re)written here in code from the spec. The LLM's text is never the source of a number.
  const phases90d = stampFunnelGoals(best90d.phases, funnel);
  const phases6m = stampFunnelGoals(best6m.phases, funnel);

  return {
    horizon: '6m',
    objective: best6m.objective || best90d.objective,
    phases: phases6m,
    phases_90d: phases90d,
    phases_6m: phases6m,
    funnel: funnel ?? null
  };
}

// Serialize the current plan for redirect/review prompts.
export function gtmForPrompt(plan: GtmPlan): string {
  return JSON.stringify(
    {
      horizon: plan.horizon,
      objective: plan.objective,
      phases: plan.phases.map((p) => ({
        phase: p.index + 1,
        name: p.name,
        objective: p.objective,
        duration_weeks: p.duration_weeks,
        start: p.start_date,
        end: p.end_date,
        platform_weights: p.platform_weights,
        pillars: p.pillars,
        goals: p.goals
      }))
    },
    null,
    1
  );
}

// Dual-horizon redirect with parallel variants: generate N revised 90-day plans in parallel,
// pick the best, then generate N revised 6-month plans extending it, pick the best.
export async function redirectGtmDual(
  ai: GoogleGenAI,
  current: GtmPlan,
  feedback: string,
  phaseIndex: number | null,
  profile: BrandProfile,
  opts: GtmDualOpts
): Promise<GtmPlan> {
  return redirectGtmDualInner(ai, current, feedback, phaseIndex, profile, opts);
}

async function redirectGtmDualInner(
  ai: GoogleGenAI,
  current: GtmPlan,
  feedback: string,
  phaseIndex: number | null,
  profile: BrandProfile,
  opts: GtmDualOpts
): Promise<GtmPlan> {
  console.log(`[GTM] redirectGtmDual: generating ${VARIANTS} revised variants per horizon…`);
  const t0 = Date.now();
  const cur90d = current.phases_90d ?? [];
  const cur6m = current.phases_6m ?? current.phases;
  const formatPhases = (phases: GtmPhase[]) =>
    phases.map((p) => ({
      phase: p.index + 1, name: p.name, objective: p.objective,
      duration_weeks: p.duration_weeks, start: p.start_date, end: p.end_date,
      platform_weights: p.platform_weights, pillars: p.pillars, goals: p.goals
    }));
  const clientBlock = `CLIENT REQUEST${phaseIndex != null ? ` (about phase ${phaseIndex + 1})` : ''}:\n${feedback.trim()}`;

  // Generate N revised 90-day variants in parallel.
  const variants90d = await Promise.all(
    Array.from({ length: VARIANTS }, async () => {
      const prompt = `The client wants to redirect their 90-day GTM roadmap. Recalculate it keeping the thread coherent: change what the request targets, keep everything else, and propagate consequences sensibly. Phases already completed (end date in the past) must NOT change.

${profileBlock(profile)}
${evidenceBlock(opts)}

CURRENT 90-DAY PLAN:
${JSON.stringify({ objective: current.objective, phases: formatPhases(cur90d) }, null, 1)}

${clientBlock}
${opts.agentBrief?.trim() ? `\nAGENT BRIEF:\n${opts.agentBrief.trim()}\n` : ''}

Return the FULL revised plan, plus:
- "reply": your short, motivated answer — what you changed and why, ending with a confirmation question.
- "changes_summary": short bullets of what changed.
${HONESTY_LINE}
${languageLine(opts.outputLanguage)}
Return JSON.`;
      const raw = await aiStructured<AnyRec>(ai, prompt, gtmSchema(true), GTM_SYSTEM, 'return_result', { temperature: CREATIVE_TEMPERATURE, ...PIN_GEMINI });
      return normalizeGtm(raw, '90d');
    })
  );
  const best90d = await selectBestGtm(ai, variants90d, profile, '90d', opts.outputLanguage);
  const reply90d = (variants90d[0] as AnyRec)?.reply ?? '';

  // Generate N revised 6-month variants in parallel, each extending the chosen 90-day plan.
  const variants6m = await Promise.all(
    Array.from({ length: VARIANTS }, async () => {
      const prompt = `The client wants to redirect their GTM roadmap. Recalculate the 6-month plan keeping the thread coherent. The revised 90-day plan below has already been chosen — your 6-month plan MUST extend it. Phases already completed (end date in the past) must NOT change.

${profileBlock(profile)}
${evidenceBlock(opts)}

CHOSEN REVISED 90-DAY PLAN:
${JSON.stringify({ objective: best90d.objective, phases: formatPhases(best90d.phases) }, null, 1)}

CURRENT 6-MONTH PLAN:
${JSON.stringify({ objective: current.objective, phases: formatPhases(cur6m) }, null, 1)}

${clientBlock}
${opts.agentBrief?.trim() ? `\nAGENT BRIEF:\n${opts.agentBrief.trim()}\n` : ''}

Return the FULL revised 6-month plan, plus:
- "reply": your short, motivated answer — what you changed and why, ending with a confirmation question.
- "changes_summary": short bullets of what changed.
${HONESTY_LINE}
${languageLine(opts.outputLanguage)}
Return JSON.`;
      const raw = await aiStructured<AnyRec>(ai, prompt, gtmSchema(true), GTM_SYSTEM, 'return_result', { temperature: CREATIVE_TEMPERATURE, ...PIN_GEMINI });
      return normalizeGtm(raw, '6m');
    })
  );
  const best6m = await selectBestGtm(ai, variants6m, profile, '6m', opts.outputLanguage);
  const reply6m = (variants6m[0] as AnyRec)?.reply ?? '';
  const reply = reply6m || reply90d;
  const changes = [
    ...(Array.isArray((variants6m[0] as AnyRec)?.changes_summary) ? (variants6m[0] as AnyRec).changes_summary : []),
    ...(Array.isArray((variants90d[0] as AnyRec)?.changes_summary) ? (variants90d[0] as AnyRec).changes_summary : [])
  ].map(String).filter(Boolean);

  console.log(`[GTM] redirectGtmDual total: ${Date.now() - t0}ms`);

  // A redirect keeps the plan's funnel spec; numeric goals re-stamped in code (no-op when null).
  const stamped90d = stampFunnelGoals(best90d.phases, current.funnel);
  const stamped6m = stampFunnelGoals(best6m.phases, current.funnel);

  return {
    horizon: '6m',
    objective: best6m.objective || best90d.objective || current.objective,
    phases: stamped6m,
    phases_90d: stamped90d,
    phases_6m: stamped6m,
    funnel: current.funnel ?? null,
    ...(reply ? { reply } : {}),
    ...(changes.length ? { changes_summary: changes } : {})
  };
}

// End-of-phase review: compare real performance with the phase's targets and propose what to do
// next — always motivated, always awaiting approval.
export type PhaseReview = {
  verdict: 'on_track' | 'adjust';
  message: string;
  changes_summary: string[];
  plan: GtmPlan | null; // revised plan when verdict === 'adjust'
};

const REVIEW_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    verdict: { type: 'string' as const, enum: ['on_track', 'adjust'] as const },
    message: {
      type: 'string' as const,
      description: "Your verdict for the client in 2-4 sentences: what the numbers say vs the targets, and what you propose. Confident, never hype (e.g. 'TikTok rende il doppio di Instagram: ti propongo di anticipare lo spostamento di peso')."
    },
    changes_summary: { type: 'array' as const, items: { type: 'string' as const }, description: 'Bullets of proposed changes; empty when on_track.' },
    phases: { type: 'array' as const, items: PHASE_SCHEMA, description: 'The FULL revised phase list when adjusting; repeat the current phases when on_track.' }
  },
  required: ['verdict', 'message', 'changes_summary', 'phases']
};

export async function reviewPhase(
  ai: GoogleGenAI,
  plan: GtmPlan,
  phaseIndex: number,
  performanceDigest: string,
  profile: BrandProfile,
  outputLanguage?: string
): Promise<PhaseReview> {
  const prompt = `Phase ${phaseIndex + 1} ("${plan.phases[phaseIndex]?.name ?? ''}") of this brand's GTM roadmap has ended. Compare the REAL performance below with the phase's targets and decide: proceed as planned (on_track) or propose a course correction (adjust) for the REMAINING phases. Completed phases never change.

${profileBlock(profile)}

PLAN:
${gtmForPrompt(plan)}

REAL PERFORMANCE IN THE PHASE WINDOW:
${performanceDigest || '(no data collected — say so honestly and keep the plan unless the absence of data itself demands a change)'}

${HONESTY_LINE}
${languageLine(outputLanguage)}
Return JSON.`;

  const raw = await aiStructured<AnyRec>(ai, prompt, REVIEW_SCHEMA, GTM_SYSTEM, 'return_result', { ...PIN_GEMINI });
  const verdict = raw?.verdict === 'adjust' ? 'adjust' : 'on_track';
  const revised = verdict === 'adjust' ? normalizeGtm({ objective: plan.objective, phases: raw?.phases }, plan.horizon) : null;
  // A course correction keeps the funnel spec; the numeric goals are re-stamped in code.
  if (revised) {
    revised.phases = stampFunnelGoals(revised.phases, plan.funnel);
    revised.funnel = plan.funnel ?? null;
  }
  return {
    verdict,
    message: String(raw?.message ?? ''),
    changes_summary: Array.isArray(raw?.changes_summary) ? raw.changes_summary.map(String).filter(Boolean) : [],
    plan: revised
  };
}

// Compact, honest digest of what actually happened in a phase window — feeds reviewPhase.
// Pure + testable. posts: published rows; history: synced analytics rows.
export function phasePerformanceDigest(
  posts: Array<{ platform: string | null; published_at: string | null }>,
  history: Array<{ platform: string | null; metrics: AnyRec | null; published_at: string | null }>,
  phase: Pick<GtmPhase, 'start_date' | 'end_date'>
): string {
  if (!phase.start_date || !phase.end_date) return '';
  const inWindow = (d: string | null) => !!d && d.slice(0, 10) >= phase.start_date! && d.slice(0, 10) < phase.end_date!;
  const published = posts.filter((p) => inWindow(p.published_at));
  const byPlatform = new Map<string, number>();
  for (const p of published) {
    const k = (p.platform ?? '?').toLowerCase();
    byPlatform.set(k, (byPlatform.get(k) ?? 0) + 1);
  }
  const eng = new Map<string, { posts: number; likes: number; comments: number; shares: number; views: number }>();
  for (const h of history.filter((x) => inWindow(x.published_at))) {
    const k = (h.platform ?? '?').toLowerCase();
    const e = eng.get(k) ?? { posts: 0, likes: 0, comments: 0, shares: 0, views: 0 };
    e.posts += 1;
    e.likes += Number(h.metrics?.likes) || 0;
    e.comments += Number(h.metrics?.comments) || 0;
    e.shares += Number(h.metrics?.shares) || 0;
    e.views += Number(h.metrics?.views) || 0;
    eng.set(k, e);
  }
  const lines: string[] = [];
  if (published.length) {
    lines.push(`Published via Anomalia: ${published.length} posts (${[...byPlatform.entries()].map(([p, n]) => `${p}: ${n}`).join(', ')}).`);
  }
  for (const [p, e] of eng.entries()) {
    const extras = [
      e.shares ? `${e.shares} shares` : '',
      e.views ? `${e.views} views` : ''
    ]
      .filter(Boolean)
      .join(', ');
    lines.push(
      `${p}: ${e.posts} tracked posts, ${e.likes} likes, ${e.comments} comments${extras ? `, ${extras}` : ''}.`
    );
  }
  return lines.join('\n');
}

// ── DB helpers ───────────────────────────────────────────────────────────────

const GTM_COLS = 'id, status, horizon, objective, phases, funnel, parent_id, revision_feedback, reply, changes_summary, source, created_at, activated_at';

export function gtmRowToPlan(row: AnyRec): GtmPlan & { id: string; status: string } {
  // The `phases` column stores either:
  //   - Legacy: an array of phase objects (single horizon)
  //   - Dual: { horizon_90d: [...], horizon_6m: [...] }
  const rawPhases = row?.phases;
  let raw90d: AnyRec[] = [];
  let raw6m: AnyRec[] = [];
  if (rawPhases && typeof rawPhases === 'object' && !Array.isArray(rawPhases) && 'horizon_90d' in rawPhases) {
    // New dual-horizon format
    raw90d = Array.isArray(rawPhases.horizon_90d) ? rawPhases.horizon_90d : [];
    raw6m = Array.isArray(rawPhases.horizon_6m) ? rawPhases.horizon_6m : [];
  } else if (Array.isArray(rawPhases)) {
    // Legacy single-horizon: treat as both 90d and 6m (backward compat)
    raw90d = rawPhases;
    raw6m = rawPhases;
  }
  const plan90d = normalizeGtm({ objective: row?.objective ?? '', phases: raw90d }, '90d');
  const plan6m = normalizeGtm({ objective: row?.objective ?? '', phases: raw6m }, '6m');
  const primaryPhases = plan6m.phases.length ? plan6m.phases : plan90d.phases;
  return {
    horizon: '6m',
    objective: String(row?.objective ?? ''),
    phases: primaryPhases,
    phases_90d: plan90d.phases,
    phases_6m: plan6m.phases.length ? plan6m.phases : plan90d.phases,
    // Clamped on read too: even a hand-edited DB value can't smuggle an out-of-bounds rate in.
    funnel: clampFunnelSpec(row?.funnel),
    id: String(row.id),
    status: String(row.status),
    ...(typeof row?.reply === 'string' && row.reply ? { reply: row.reply } : {}),
    ...(Array.isArray(row?.changes_summary) ? { changes_summary: row.changes_summary.map(String) } : {})
  };
}

export async function loadActiveGtm(supabase: SupabaseClient, brandId: string): Promise<(GtmPlan & { id: string }) | null> {
  const { data: row } = await supabase.from('gtm_plans').select(GTM_COLS).eq('brand_id', brandId).eq('status', 'active').maybeSingle();
  return row ? gtmRowToPlan(row) : null;
}

// The one-call inheritance link for every planner path: the ACTIVE GTM plan's current phase as
// a brief, or '' when the brand has no GTM plan / the plan has lapsed. Callers prepend this to
// their strategyBrief so the roadmap steers production everywhere, with zero behaviour change
// for brands without a GTM plan.
export async function activeGtmBrief(supabase: SupabaseClient, brandId: string, tz: string): Promise<string> {
  const plan = await loadActiveGtm(supabase, brandId);
  if (!plan) return '';
  // Prefer the 90-day plan for content production (tactical, immediate).
  // Fall back to 6-month plan when the 90d plan has expired (all phases done).
  const phases90d = phasesForHorizon(plan, '90d');
  const plan90d = { ...plan, phases: phases90d };
  const idx90 = currentPhaseIndex(plan90d, tz);
  if (idx90 != null) return gtmPhaseBrief(plan90d, idx90);
  // 90d plan expired → use the 6-month plan as the strategic fallback.
  const phases6m = phasesForHorizon(plan, '6m');
  const plan6m = { ...plan, phases: phases6m };
  const idx6m = currentPhaseIndex(plan6m, tz);
  return idx6m != null ? gtmPhaseBrief(plan6m, idx6m) : '';
}

// Check whether the 90-day plan has expired (all phases done) while the 6-month plan is still
// active. When true, the UI should prompt the user to regenerate the 90-day plan aligned with
// the current 6-month phase.
export function needs90dRefresh(plan: GtmPlan, tz: string, now = new Date()): boolean {
  const phases90d = phasesForHorizon(plan, '90d');
  const phases6m = phasesForHorizon(plan, '6m');
  if (!phases90d.length || !phases6m.length) return false;
  const idx90 = currentPhaseIndex({ ...plan, phases: phases90d }, tz, now);
  const idx6m = currentPhaseIndex({ ...plan, phases: phases6m }, tz, now);
  // 90d expired (no current phase) but 6m is still active.
  return idx90 === null && idx6m !== null;
}

// Activate a proposed GTM plan: supersede the current active one, stamp phase windows from this
// week's Monday, flip status. (Phases already stamped — a phase-review revision — keep dates.)
export async function activateGtm(supabase: SupabaseClient, brandId: string, planId: string, tz: string, now = new Date()): Promise<boolean> {
  const { data: row } = await supabase.from('gtm_plans').select(GTM_COLS).eq('id', planId).eq('brand_id', brandId).maybeSingle();
  if (!row) return false;
  const plan = gtmRowToPlan(row);
  // Stamp both horizons' phases with dates starting from this week's Monday.
  const stamped90d = plan.phases_90d?.[0]?.start_date ? plan.phases_90d : stampPhases(plan.phases_90d ?? [], tz, now);
  const stamped6m = plan.phases_6m?.[0]?.start_date ? plan.phases_6m : stampPhases(plan.phases_6m ?? [], tz, now);
  // Store as dual structure inside the existing `phases` jsonb column.
  const dualPhases = { horizon_90d: stamped90d, horizon_6m: stamped6m };
  await supabase
    .from('gtm_plans')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .neq('id', planId);
  await supabase
    .from('gtm_plans')
    .update({ status: 'active', phases: dualPhases, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', planId);
  return true;
}
