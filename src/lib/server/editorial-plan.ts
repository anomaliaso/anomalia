import { renderDesignDoc } from '$lib/server/brand-design-doc';
import type { GoogleGenAI } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { structured, benchmarkDigest, type Benchmark } from '$lib/server/research';
import { aiStructured, parallelVariants, VARIANT_LENSES, CREATIVE_TEMPERATURE, PIN_GEMINI } from '$lib/server/xiaomi';
import { countForFrequency } from '$lib/server/plans';
import { PLAN_WEEKS } from '$lib/plans';
export { PLAN_WEEKS };
import type { ContentPrefs, PastWinner } from '$lib/server/content-preview';
import { rubricsBrief, type Rubric } from '$lib/server/rubrics';

// The EDITORIAL PLAN engine — the agency-grade strategy document the AI proposes and the user
// approves, replacing the onboarding "style" questions (mood/tone/frequency/goal). An active
// plan is the source of truth for voice + cadence and DRIVES recurring generation: every batch
// executes ONE of its 4 rolling weeks (the week's theme/brief becomes planStrategy's
// strategyBrief). Flexibility lives here too: a per-week user brief triggers replanWeek(), and
// conversational feedback on the whole plan produces a reviewable revision via revisePlan().
// For 0→1 brands (no real social history) the plan additionally carries organic go-to-market
// guidance: which platforms to bet on and why, grounded in the competitor benchmark.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrandProfile = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;


export type PlanVoice = { mood: string; tone: string; goal: string; personality: string };
export type PlatformMixEntry = { platform: string; share: string; role: string };
export type GtmPlatformRec = {
  platform: string;
  priority: 'primary' | 'secondary' | 'experiment';
  why: string;
  organic_potential: string;
};
export type PlanGtm = {
  stage: 'zero_to_one' | 'growth';
  summary: string;
  platform_recs: GtmPlatformRec[];
  plays: string[];
};
export type PlanWeek = {
  index: number;
  // YYYY-MM-DD Monday of the week, in the brand's timezone. null on proposals; stamped at activation.
  week_start: string | null;
  theme: string;
  focus: string;
  content_mix: Array<{ type: string; count: number }>;
  rationale: string;
  // The user's authoritative brief for this week ("product launch week") — replanWeek() rebuilds
  // the week around it and weekStrategyBrief() passes it verbatim to the batch planner.
  brief: string | null;
  // User-selected products for this week (exact product titles from the catalog).
  // When set, the batch planner MUST feature these products. Empty or null = AI chooses freely.
  products: string[] | null;
  status: 'upcoming' | 'planned' | 'done';
};
export type EditorialPlan = {
  id?: string;
  status?: string;
  strategy: string;
  voice: PlanVoice;
  cadence: string; // '3/week' | '5/week' | 'daily'
  platform_mix: PlatformMixEntry[];
  gtm: PlanGtm | null;
  weeks: PlanWeek[];
  changes_summary?: string[];
};

// ── Cadence ─────────────────────────────────────────────────────────────────
// La cadenza dice come una settimana è SPARSA sui giorni, non quanta ce n'è. Il volume lo decide
// il budget contro il listino dei formati (plan-budget.ts + content-cost.ts), e il gate rifiuta un
// batch che non ci sta.
//
// Era gated dal piano — go poteva solo '3/week' — perché il mix doveva sommare alla cadenza: un
// tetto sul ritmo era quindi un tetto sui post, e un Pro da 90 post al mese ne vedeva pianificati
// 28. Tolto quel legame, limitare il ritmo per piano non protegge più niente: toglie solo a un
// brand piccolo la possibilità di postare spesso e corto, che è una scelta editoriale legittima.
export const CADENCES = ['3/week', '5/week', 'daily'] as const;
export function cadenceAllowed(_planTier?: string | null): string[] {
  return [...CADENCES];
}
export function clampCadence(cadence: string | null | undefined, allowed: string[]): string {
  const c = String(cadence ?? '').trim();
  if (allowed.includes(c)) return c;
  // Fall back to the most ambitious allowed cadence below the proposal (or the lowest one).
  return allowed[allowed.length - 1] ?? '3/week';
}

// ── Pure date helpers (brand-timezone wall-clock, no date library) ───────────

// YYYY-MM-DD of `now` in `tz` (en-CA formats as ISO-like Y-M-D).
function dayKey(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// YYYY-MM-DD of the MONDAY of the current week in `tz`. Weeks run Monday→Sunday, matching how
// the planner lays out day-of-week slots.
export function mondayOf(tz: string, now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(String(p.weekday));
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  d.setUTCDate(d.getUTCDate() - Math.max(0, dow));
  return d.toISOString().slice(0, 10);
}

// Stamp week_start on each week: week 0 = the Monday of the activation week (brand tz), then +7d.
export function stampWeekStarts(weeks: PlanWeek[], tz: string, now = new Date()): PlanWeek[] {
  const start = mondayOf(tz, now);
  const base = new Date(`${start}T00:00:00Z`);
  return weeks.map((w, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return { ...w, index: i, week_start: d.toISOString().slice(0, 10) };
  });
}

// Which of the plan's 4 weeks `now` falls in (brand tz). 0–3, or null when the cycle is over
// (time for a rollover proposal). Before the stamped start (shouldn't happen) clamps to 0.
export function currentWeekIndex(plan: Pick<EditorialPlan, 'weeks'>, tz: string, now = new Date()): number | null {
  const start = plan.weeks?.[0]?.week_start;
  if (!start) return null;
  const today = Date.parse(`${dayKey(tz, now)}T00:00:00Z`);
  const t0 = Date.parse(`${start}T00:00:00Z`);
  if (Number.isNaN(today) || Number.isNaN(t0)) return null;
  const idx = Math.floor((today - t0) / (7 * 24 * 3600 * 1000));
  if (idx < 0) return 0;
  return idx >= (plan.weeks?.length || PLAN_WEEKS) ? null : idx;
}

// The [start, end) wall-clock window of week `weekIndex`, derived from its stamped week_start.
// Lets "This week" find a week's posts by their SCHEDULE DATE — robust to the (fragile)
// editorial_plan_id/editorial_week linkage going NULL or pointing at a superseded plan. The
// week_start is a brand-tz Monday stored as a date; comparing against UTC midnight is close
// enough for bucketing posts into weeks (edge slip of a tz offset is immaterial here).
export function weekWindow(plan: Pick<EditorialPlan, 'weeks'>, weekIndex: number): { startISO: string; endISO: string } | null {
  const start = plan.weeks?.[weekIndex]?.week_start;
  if (!start) return null;
  const t0 = Date.parse(`${start}T00:00:00Z`);
  if (Number.isNaN(t0)) return null;
  return { startISO: new Date(t0).toISOString(), endISO: new Date(t0 + 7 * 24 * 3600 * 1000).toISOString() };
}

// ── Plan → planner glue ──────────────────────────────────────────────────────

// The scheduler-readable snapshot derived from an approved plan. brands.content_prefs stays the
// single thing every read path consumes (zero changes there); this is its ONLY writer once a
// plan exists. language/platformInstructions are user-level settings, never plan sections — keep.
export function prefsFromPlan(plan: EditorialPlan, existing: ContentPrefs = {}): ContentPrefs {
  return {
    ...existing,
    mood: plan.voice?.mood || existing.mood,
    tone: plan.voice?.tone || existing.tone,
    goal: plan.voice?.goal || existing.goal,
    // One-line personality from the approved plan — caption writers lead with this over HOUSE_VOICE.
    personality: plan.voice?.personality || existing.personality,
    frequency: plan.cadence || existing.frequency
  };
}

// How many posts a week's batch should produce: the SUM of the week's content-mix counts — the
// number the user saw and approved on the plan — clamped to a sane ceiling. Falls back to the
// plan's cadence when the mix is empty/malformed. The plan's number is authoritative: if the
// approved week says 4 posts, the batch is 4 posts, never a hardcoded count.
/** Tetto di sicurezza per settimana. Non è il volume: quello lo dice il piano del brand. */
const MAX_WEEK_POSTS = 30;
export function postsForWeek(plan: Pick<EditorialPlan, 'weeks' | 'cadence'>, weekIndex: number): number {
  const mix = plan.weeks?.[weekIndex]?.content_mix ?? [];
  const sum = mix.reduce((acc, m) => acc + (Number(m?.count) || 0), 0);
  if (sum > 0) return Math.min(sum, MAX_WEEK_POSTS);
  return countForFrequency(plan.cadence);
}

/**
 * Quanti post produce un batch che copre `weeks` settimane a partire da `weekIndex`.
 *
 * Il tetto `MAX_WEEK_POSTS` è PER SETTIMANA, non per batch: applicarlo alla somma taglierebbe un
 * batch di due settimane a metà della prima e la seconda uscirebbe vuota.
 */
export function postsForWeeks(
  plan: Pick<EditorialPlan, 'weeks' | 'cadence'>,
  weekIndex: number,
  weeks = 1
): number {
  const span = Math.max(1, Math.floor(weeks));
  let total = 0;
  for (let i = 0; i < span; i++) {
    if (!plan.weeks?.[weekIndex + i]) break;
    total += postsForWeek(plan, weekIndex + i);
  }
  return total;
}

/**
 * Il mix atteso di un batch. Con una settimana sola le voci NON portano la settimana — valgono per
 * il batch, che è il comportamento di sempre; con più settimane ognuna porta la sua, o due episodi
 * nella prima e zero nella seconda farebbero comunque tornare il conto.
 */
export function weekMixForSpan(
  plan: EditorialPlan | null,
  weekIndex: number,
  weeks = 1
): Array<{ week?: number; type: string; count: number }> {
  const span = Math.max(1, Math.floor(weeks));
  if (span === 1) return (plan?.weeks?.[weekIndex]?.content_mix ?? []).map((m) => ({ ...m }));
  const out: Array<{ week?: number; type: string; count: number }> = [];
  for (let i = 0; i < span; i++) {
    const w = plan?.weeks?.[weekIndex + i];
    if (!w) break;
    for (const m of w.content_mix ?? []) out.push({ week: weekIndex + i, type: m.type, count: m.count });
  }
  return out;
}

// Serialize ONE week of the plan into the strategyBrief string planStrategy() consumes, so the
// batch the autopilot (or manual generate) produces executes the approved plan rather than
// improvising. The user's week brief, when present, is authoritative and says so.
/**
 * Il brief del piano per il batch che sta per partire.
 *
 * `weeks` è quante settimane copre il batch: con 1 il testo è identico a quello di sempre, con più
 * di una ognuna porta il SUO tema, focus e mix, e ogni seed deve dichiarare a quale appartiene.
 * Senza, i post della seconda settimana nascono sul tema della prima e la cadenza delle rubriche
 * non ha modo di essere rispettata.
 */
export function weekStrategyBrief(
  plan: EditorialPlan,
  weekIndex: number,
  rubrics: Rubric[] = [],
  weeks = 1
): string {
  const week = plan.weeks?.[weekIndex];
  if (!week) return '';
  const span = plan.weeks.slice(weekIndex, weekIndex + Math.max(1, Math.floor(weeks)));
  // '' when the brand has no approved rubrics → the brief is identical to the pre-rubric one.
  const rubricsLine = rubricsBrief(rubrics);
  const mixOf = (w: PlanWeek) => (w.content_mix ?? []).map((m) => `${m.count}× ${m.type}`).join(', ');
  const mix = mixOf(week);
  const multi = span.length > 1;
  const weekBlock = (w: PlanWeek, i: number) =>
    [
      // L'etichetta resta leggibile (WEEK 1), il numero da SCRIVERE è accanto: il modello aveva
      // copiato l'etichetta in un campo che è un indice, e il batch slittava di una settimana.
      `WEEK ${weekIndex + i + 1} (write week=${weekIndex + i}) — theme: ${w.theme}`,
      w.focus ? `  Focus: ${w.focus}` : '',
      mixOf(w) ? `  Content mix target: ${mixOf(w)}.` : '',
      w.rationale ? `  Why this week: ${w.rationale}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  const lines = [
    multi
      ? `EDITORIAL PLAN (user-approved — this batch executes weeks ${weekIndex + 1}–${weekIndex + span.length} of ${plan.weeks.length}):`
      : `EDITORIAL PLAN (user-approved — this batch executes week ${weekIndex + 1} of ${plan.weeks.length}):`,
    plan.strategy ? `Strategy: ${plan.strategy}` : '',
    plan.voice?.personality ? `Brand personality: ${plan.voice.personality}` : '',
    multi ? '' : `This week's theme: ${week.theme}`,
    multi ? '' : week.focus ? `Focus: ${week.focus}` : '',
    multi ? '' : mix ? `Content mix target for the week: ${mix}.` : '',
    multi ? '' : week.rationale ? `Why this week: ${week.rationale}` : '',
    multi
      ? `WEEK BRIEF — every seed carries "week" with the number in brackets for the week it belongs to (write that number, not the label), and each week must get its own theme and its own content mix. Spreading them evenly is not the same as honouring each week's mix.\n${span.map(weekBlock).join('\n')}`
      : '',
    plan.gtm?.stage === 'zero_to_one' && plan.gtm.summary
      ? `GO-TO-MARKET CONTEXT (organic 0→1 — the brand is building its audience from scratch): ${plan.gtm.summary}`
      : '',
    'FORMATS the production engine supports (when a row/seed needs a format, use EXACTLY these names): single_image, carousel, text_post, link_post, video.',
    rubricsLine,
    'REDDIT CONTENT TYPES — if Reddit is in the platform mix, use these: TEXT posts (media:"text", title + body in Markdown, for discussions/guides/questions — no image needed), LINK posts (media:"link", title + link_url for sharing a blog article or resource — no image), IMAGE posts (media:"image", title + one image). Every Reddit seed MUST include title (max 300 chars) and subreddit. For non-Reddit platforms, title/link_url/subreddit are empty strings and media is always "image" (or "text" for X/Threads only).'
  ].filter(Boolean);
  if (week.brief?.trim()) {
    lines.push(
      `USER BRIEF FOR THIS WEEK (authoritative — build the whole batch around this, it overrides the theme above where they conflict): ${week.brief.trim()}`
    );
  }
  if (week.products?.length) {
    lines.push(
      `FEATURED PRODUCTS (authoritative — you MUST include at least one post per product listed here, copy the name verbatim into the seed's "product" field):\n${week.products.map((p: string) => `- ${p}`).join('\n')}`
    );
  }
  return lines.join('\n');
}

// ── Normalisation (never trust LLM output shape) ─────────────────────────────

function normWeek(w: AnyRec, i: number): PlanWeek {
  // Models sometimes put the theme under alternate keys — accept them so we never pad with blanks
  // when the model did produce a week arc.
  const theme = String(w?.theme ?? w?.title ?? w?.name ?? w?.week_theme ?? '').trim();
  const focus = String(w?.focus ?? w?.goal ?? w?.intent ?? '').trim();
  return {
    index: i,
    week_start: typeof w?.week_start === 'string' ? w.week_start : null,
    theme,
    focus,
    content_mix: Array.isArray(w?.content_mix)
      ? w.content_mix
          .map((m: AnyRec) => ({ type: String(m?.type ?? ''), count: Math.max(0, Math.round(Number(m?.count) || 0)) }))
          .filter((m: { type: string; count: number }) => m.type && m.count > 0)
      : [],
    rationale: String(w?.rationale ?? w?.why ?? '').trim(),
    brief: typeof w?.brief === 'string' && w.brief.trim() ? w.brief.trim() : null,
    products: Array.isArray(w?.products) ? w.products.filter((p: unknown) => typeof p === 'string' && p.trim()).map((p: string) => p.trim()) : null,
    status: w?.status === 'planned' || w?.status === 'done' ? w.status : 'upcoming'
  };
}

function normGtm(g: AnyRec | null | undefined): PlanGtm | null {
  if (!g || typeof g !== 'object') return null;
  const recs = Array.isArray(g.platform_recs)
    ? g.platform_recs
        .map((r: AnyRec) => ({
          platform: String(r?.platform ?? '').toLowerCase().trim(),
          priority: r?.priority === 'primary' || r?.priority === 'experiment' ? r.priority : ('secondary' as const),
          why: String(r?.why ?? ''),
          organic_potential: String(r?.organic_potential ?? '')
        }))
        .filter((r: GtmPlatformRec) => r.platform)
    : [];
  if (!recs.length && !String(g.summary ?? '').trim()) return null;
  return {
    stage: g.stage === 'zero_to_one' ? 'zero_to_one' : 'growth',
    summary: String(g.summary ?? ''),
    platform_recs: recs,
    plays: Array.isArray(g.plays) ? g.plays.map(String).filter(Boolean).slice(0, 6) : []
  };
}

export function normalizePlan(raw: AnyRec, allowedCadences: string[]): EditorialPlan {
  const weeks = (Array.isArray(raw?.weeks) ? raw.weeks : []).slice(0, PLAN_WEEKS).map(normWeek);
  // Pad to exactly PLAN_WEEKS so the rolling cycle is always well-formed.
  while (weeks.length < PLAN_WEEKS) {
    weeks.push(normWeek({ theme: '', focus: '', rationale: '' }, weeks.length));
  }
  return {
    strategy: String(raw?.strategy ?? ''),
    voice: {
      mood: String(raw?.voice?.mood ?? ''),
      tone: String(raw?.voice?.tone ?? ''),
      goal: String(raw?.voice?.goal ?? ''),
      personality: String(raw?.voice?.personality ?? '')
    },
    cadence: clampCadence(raw?.cadence, allowedCadences),
    platform_mix: Array.isArray(raw?.platform_mix)
      ? raw.platform_mix
          .map((m: AnyRec) => ({
            platform: String(m?.platform ?? '').toLowerCase().trim(),
            share: String(m?.share ?? ''),
            role: String(m?.role ?? '')
          }))
          .filter((m: PlatformMixEntry) => m.platform)
      : [],
    gtm: normGtm(raw?.gtm),
    weeks,
    ...(Array.isArray(raw?.changes_summary)
      ? { changes_summary: raw.changes_summary.map(String).filter(Boolean) }
      : {})
  };
}

// ── Gemini schemas ───────────────────────────────────────────────────────────

const WEEK_SCHEMA = {
  type: 'object' as const,
  properties: {
    theme: { type: 'string' as const, description: 'The editorial theme tying this week together (one sharp line, not a generic label).' },
    focus: { type: 'string' as const, description: "What this week concretely pushes (offering, narrative, moment) — the strategist's intent in one line." },
    content_mix: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          type: { type: 'string' as const, description: "Content type, e.g. 'educational', 'product', 'behind the scenes', 'social proof', 'launch'." },
          count: { type: 'number' as const, description: "How many posts of this type this week. The counts must sum to the week's stated volume — the cadence says how they are spread across days, never how many there are." }
        },
        required: ['type', 'count']
      }
    },
    rationale: { type: 'string' as const, description: 'Why this theme this week — grounded in the strategy/benchmark, not generic advice.' }
  },
  required: ['theme', 'focus', 'content_mix', 'rationale']
};

function planSchema(allowedCadences: string[], withChanges = false) {
  return {
    type: 'object' as const,
    properties: {
      strategy: {
        type: 'string' as const,
        description: 'The strategy statement: the single editorial bet for the next 4 weeks, in 2-4 sentences a client would sign off on.'
      },
      voice: {
        type: 'object' as const,
        properties: {
          mood: { type: 'string' as const, description: "The brand mood you propose (e.g. Bold, Minimal, Warm) — one or two words." },
          tone: { type: 'string' as const, description: 'The tone of voice you propose (e.g. Professional, Witty, Dry) — one or two words.' },
          goal: { type: 'string' as const, description: "The primary goal every post optimises for: 'awareness', 'sales' or 'community'." },
          personality: { type: 'string' as const, description: 'One sentence describing how the brand should sound on social.' }
        },
        required: ['mood', 'tone', 'goal', 'personality']
      },
      cadence: {
        type: 'string' as const,
        enum: allowedCadences,
        description: 'Posting cadence, grounded in what the market sustains and what builds momentum without burning quota.'
      },
      platform_mix: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            platform: { type: 'string' as const },
            share: { type: 'string' as const, description: "Rough share of the cadence, e.g. '40%' or '2/week'." },
            role: { type: 'string' as const, description: "This platform's job in the strategy (e.g. 'discovery engine', 'authority + B2B reach')." }
          },
          required: ['platform', 'share', 'role']
        }
      },
      gtm: {
        type: 'object' as const,
        description: 'Organic go-to-market guidance. Required when the brand is 0→1 (no real social presence yet); for established brands keep it minimal with stage "growth".',
        properties: {
          stage: { type: 'string' as const, enum: ['zero_to_one', 'growth'] as const },
          summary: { type: 'string' as const, description: 'The organic GTM thesis in 2-3 sentences: how this brand gets from zero to its first real audience.' },
          platform_recs: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                platform: { type: 'string' as const, description: 'May include platforms the user did NOT select, when the data says they should be there.' },
                priority: { type: 'string' as const, enum: ['primary', 'secondary', 'experiment'] as const },
                why: { type: 'string' as const, description: 'Grounded in the benchmark: cite the competitor/market numbers that justify this bet.' },
                organic_potential: { type: 'string' as const, description: 'What organic performance looks like here for this niche (cite the benchmark where possible).' }
              },
              required: ['platform', 'priority', 'why', 'organic_potential']
            }
          },
          plays: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: '3-6 concrete organic plays (not paid) for this stage, e.g. founder-led posting, niche communities, launch moments.'
          }
        },
        required: ['stage', 'summary', 'platform_recs', 'plays']
      },
      weeks: { type: 'array' as const, items: WEEK_SCHEMA, description: 'Exactly 4 weeks forming a deliberate arc, not 4 disconnected themes.' },
      ...(withChanges
        ? {
            changes_summary: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'What you changed vs the current plan and why, as short user-facing bullets.'
            }
          }
        : {})
    },
    required: ['strategy', 'voice', 'cadence', 'platform_mix', 'gtm', 'weeks', ...(withChanges ? ['changes_summary'] : [])]
  };
}

// ── Shared prompt assembly ───────────────────────────────────────────────────

export type ProposePlanOpts = {
  platforms: string[];
  allowedCadences: string[];
  /**
   * I crediti che una settimana può spendere in produzione. QUANTI post entrino non lo dice
   * nessuno: lo decide questo budget contro il listino dei formati. Legare il volume alla cadenza
   * faceva pianificare 28 post al mese a un Pro che ne paga 90 — un tetto che nessuno aveva scelto.
   * Assente → si torna al vecchio comportamento (il mix somma alla cadenza).
   */
  weeklyCredits?: number;
  /** Il listino, come lo legge chi pianifica. Vuoto quando il budget non si sa. */
  costBrief?: string;
  // Language for ALL user-facing prose in the plan (it's a document the client reads — follows
  // the UI locale, like the strategy report).
  outputLanguage?: string;
  // Compact white-space/angles brief from the research report (strategyBriefFromReport).
  strategyBrief?: string;
  // The full competitor benchmark — grounds cadence + the GTM platform recommendations in data.
  benchmark?: Benchmark | null;
  topPosts?: PastWinner[];
  // 0→1 detection: the brand has no meaningful social history, so the plan must carry a real
  // organic go-to-market section (computed by the caller, who has the scrape counts).
  zeroToOne?: boolean;
  // Pre-fetched upcomingTimelyHooks() output ('' when none) so week themes can be timely.
  calendarHooks?: string;
  // The brand's APPROVED rubrics. Absent/empty → no rubric block anywhere: the plan prompts are
  // byte-identical to the pre-rubric behaviour (the whole rubric layer is opt-in).
  rubrics?: Rubric[];
  // Optional Xiaomi model override (e.g. mimo-v2.5-pro-ultraspeed for onboarding latency).
  model?: string;
  // How many parallel proposal variants to generate (default 3). Use 1 for faster onboarding.
  variants?: number;
  // Strategy agent path — default ON; STRATEGY_AGENT_ENABLED=false → legacy.
  supabase?: SupabaseClient;
  brandId?: string;
  userId?: string;
  planTier?: string | null;
  timezone?: string;
  /** Log each agent step to stdout (scripts / debugging). */
  agentVerbose?: boolean;
  /** Wall clock left in the caller's invocation. Absent → the caller owns its own time. */
  remainingMs?: number;
};

/** Exported for tests: the brand half of every plan prompt, pure over the profile. */
export function profileBlock(profile: BrandProfile): string {
  // The brand's own linkable pages (content library). Surfaced so the plan can deliberately weave
  // in link-driving content — Reddit link posts and topic-led posts pointing to these resources.
  const pages = (Array.isArray(profile?.pages) ? profile.pages : []).slice(0, 15);
  // The no-invented-assets rule covers PROSE too (strategy/themes/focus/rationales), not just
  // URLs — the model used to cite blog articles that don't exist ("The Cost of the Click") in the
  // strategic narrative. The rule is emitted even when NO pages are indexed, which is exactly
  // when inventing is most tempting.
  const pagesBlock = pages.length
    ? `\nOWN SITE CONTENT (the brand's real pages — plan some weeks/rows around DRIVING TRAFFIC to the relevant ones, e.g. a Reddit link post or a topic-led post that references the page). These are the ONLY articles/pages that exist: never invent URLs, and never cite an article, guide or page that is not in this list in ANY prose field (strategy, themes, focus, rationales):\n${pages
        .map((p: AnyRec) => `- ${p?.title || p?.url}${Array.isArray(p?.topics) && p.topics.length ? ` [${(p.topics as string[]).slice(0, 4).join(', ')}]` : ''}`)
        .join('\n')}`
    : '\nOWN SITE CONTENT: none indexed — NEVER reference or invent any specific blog article, guide or page (by title or URL) in any prose field (strategy, themes, focus, rationales).';
  // The brand, rendered by the same function every other surface uses (`brand-design-doc.ts`).
  // This block used to be seven hand-written lines that left out the voice, the palette, the
  // catalogue, the faces and the competitors — so the plan that decides a month of posts knew less
  // about the brand than the chat did. `plannerProfile` carries the kit flat, which is exactly the
  // shape the renderer reads.
  //
  // 'summary' on the visual brief keeps the original intent: the planner needs to know what the
  // brand can render well when it picks formats, while the full art direction stays with the image
  // pipeline that actually executes it.
  const brandDoc = renderDesignDoc(
    {
      brandName: profile?.name ?? '',
      kit: profile ?? null,
      language: profile?.language ?? null,
      targetPlatforms: Array.isArray(profile?.target_platforms) ? profile.target_platforms : null,
      products: Array.isArray(profile?.studio_products) ? profile.studio_products : null,
      people: Array.isArray(profile?.studio_people) ? profile.studio_people : null,
      competitors: Array.isArray(profile?.studio_competitors) ? profile.studio_competitors : null
    },
    {
      // The plan engine is a structured call with no tools — an operative line telling it to call
      // read_products would be an instruction it cannot follow.
      toolHints: false,
      // The knowledge index is a list of things to go and read; the planner cannot read them.
      include: { documents: false },
      visualStyleDetail: 'summary'
    }
  );
  return [brandDoc, pagesBlock].filter(Boolean).join('\n');
}

function evidenceBlock(opts: ProposePlanOpts): string {
  const winners = (opts.topPosts ?? []).slice(0, 6);
  // '' for brands without approved rubrics — the block simply doesn't exist.
  const rubrics = rubricsBrief(opts.rubrics ?? []);
  return [
    opts.benchmark ? `\nMARKET BENCHMARK (real numbers from the brand's competitors — ground cadence and platform bets in these):\n${benchmarkDigest(opts.benchmark)}` : '',
    opts.strategyBrief?.trim() ? `\nMARKET STRATEGY BRIEF:\n${opts.strategyBrief.trim()}` : '',
    rubrics ? `\n${rubrics}` : '',
    winners.length
      ? `\nWHAT ACTUALLY WORKED (the brand's own top posts):\n` +
        winners
          .map((p) => `- [${p.platform ?? '?'}] ${String(p.content ?? '').replace(/\s+/g, ' ').slice(0, 160)}`)
          .join('\n')
      : '',
    opts.calendarHooks ? `\n${opts.calendarHooks}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function languageLine(outputLanguage?: string): string {
  return `Write ALL user-facing prose (strategy, personality, roles, themes, focus, rationales, GTM text, content-mix type labels) in ${outputLanguage || 'English'}; keep platform names and the cadence value unchanged.`;
}

function proposeGtmLine(zeroToOne?: boolean): string {
  return zeroToOne
    ? `GO-TO-MARKET: this brand has essentially NO organic social presence yet — it is going 0→1. The plan MUST include a serious organic go-to-market section (gtm.stage = "zero_to_one"): which platforms to bet on (primary/secondary/experiment) WITH benchmark numbers that justify each bet, what organic performance looks like in this niche, and 3-6 concrete organic plays. Week 1 should lay the foundation. Organic only — never recommend paid media.`
    : `GO-TO-MARKET: the brand already has a social presence. Set gtm.stage = "growth" and keep the gtm section short: where to double down and why, grounded in the benchmark.`;
}

/** Seed brief for the strategy agent when proposing a fresh editorial plan. */
export function buildProposeSeedBrief(opts: ProposePlanOpts): string {
  const rubricNote =
    (opts.rubrics?.length ?? 0) > 0
      ? `The brand has ${opts.rubrics!.length} approved recurring series (rubrics). Use read_rubrics and express every week's content_mix as counts of those series names.`
      : '';
  return [
    proposeGtmLine(opts.zeroToOne),
    evidenceBlock(opts),
    `Platforms the user selected: ${opts.platforms.join(', ') || 'n/a'}.`,
    `Cadence: choose ONE of [${opts.allowedCadences.join(', ')}] — how the week is spread, not how much of it there is.`,
    opts.weeklyCredits ? `Weekly budget: ${opts.weeklyCredits} credits of production a week — the content_mix is what they buy, not a fixed count.` : '',
    rubricNote,
    languageLine(opts.outputLanguage)
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Seed brief for the strategy agent when rolling over to the next 4-week cycle. */
export function buildNextCycleSeedBrief(opts: ProposePlanOpts): string {
  return [
    evidenceBlock(opts),
    `Evolve the strategy from what the previous cycle did and what actually performed — double down on what worked, retire what didn't, bring new angles.`,
    `Cadence must be ONE of [${opts.allowedCadences.join(', ')}]. Update gtm if the brand shifted from 0→1 to growth.`,
    languageLine(opts.outputLanguage)
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Wall clock the strategy agent may spend, from what is left of the caller's invocation.
 *
 * `AGENT_PLAN_MAX_MS` is what the agent takes when it runs alone in its own request. Inside the
 * onboarding worker it does not: the market study ran first, and the legacy pipeline still has to
 * fit afterwards if the agent ends without a plan. Production said the ceiling was already being
 * touched — research jobs finishing at 299s, 278s, 225s against a 300s cap, and the one that died
 * died at `editorialPlan`.
 *
 * `null` → do not start the agent: what is left cannot hold it AND the pipeline it must degrade
 * into, so starting it buys a killed invocation instead of a plan.
 */
export const AGENT_PLAN_MAX_MS = 280_000;
/** `return_editorial_plan` took at most 87s over 206 production calls; round up. */
export const LEGACY_PLAN_RESERVE_MS = 90_000;
/** Under this the agent cannot close a loop — its fastest production run was 28s, its median 52s. */
export const MIN_AGENT_PLAN_MS = 60_000;

export function agentPlanBudget(remainingMs: number): number | null {
  const forAgent = Math.min(remainingMs - LEGACY_PLAN_RESERVE_MS, AGENT_PLAN_MAX_MS);
  return forAgent >= MIN_AGENT_PLAN_MS ? forAgent : null;
}

async function invokeEditorialAgent(
  profile: BrandProfile,
  opts: ProposePlanOpts,
  mode: 'propose' | 'propose_next_cycle' | 'revise' | 'replan_week',
  seedBrief: string,
  currentPlan?: EditorialPlan,
  weekIndex?: number
): Promise<EditorialPlan | null> {
  const { strategyAgentEnabled, runStrategyAgent } = await import('$lib/server/strategy-agent');
  if (!strategyAgentEnabled() || !opts.supabase || !opts.brandId) return null;
  const deadlineMs = opts.remainingMs == null ? undefined : agentPlanBudget(opts.remainingMs);
  if (deadlineMs === null) {
    console.warn(
      `[editorial-plan] ${Math.round(opts.remainingMs! / 1000)}s left: too little for the agent and the fallback, going legacy`
    );
    return null;
  }
  // null → the caller falls through to the legacy pipeline. The guard lives HERE, in the one place
  // all four call sites (propose / revise / replan_week / next_cycle) route through: an agent that
  // ends without a plan must degrade to the pipeline that still works, never take onboarding down.
  try {
    const result = await runStrategyAgent({
      supabase: opts.supabase,
      userId: opts.userId,
      brandId: opts.brandId,
      profile,
      constraints: {
        allowedCadences: opts.allowedCadences,
        platforms: opts.platforms,
        planTier: opts.planTier ?? null,
        timezone: opts.timezone
      },
      mode,
      currentPlan,
      seedBrief,
      weekIndex,
      outputLanguage: opts.outputLanguage,
      planOpts: opts,
      verbose: opts.agentVerbose,
      deadlineMs
    });
    return result.plan;
  } catch (e) {
    console.warn('[editorial-plan] strategy agent failed, falling back to legacy:', e instanceof Error ? e.message : e);
    return null;
  }
}

const PLAN_SYSTEM =
  'You are a senior social-media strategist at an agency, writing the editorial plan a client signs off on. Be specific, honest and grounded in the data provided — never generic agency filler. Every week must earn its place in a deliberate 4-week arc.';

// ── LLM calls ────────────────────────────────────────────────────────────────

// Propose a brand-new 4-week editorial plan from the research output. Called at the end of the
// onboarding research pipeline (replacing the old immediate post-planning) and on demand for
// legacy brands from the strategy page.
export async function proposePlan(ai: GoogleGenAI, profile: BrandProfile, opts: ProposePlanOpts): Promise<EditorialPlan> {
  const agentPlan = await invokeEditorialAgent(profile, opts, 'propose', buildProposeSeedBrief(opts));
  if (agentPlan) return agentPlan;

  const gtmLine = opts.zeroToOne
    ? `\nGO-TO-MARKET: this brand has essentially NO organic social presence yet — it is going 0→1. The plan MUST include a serious organic go-to-market section (gtm.stage = "zero_to_one"): which platforms to bet on (primary/secondary/experiment) WITH the benchmark numbers that justify each bet, what organic performance looks like in this niche, and 3-6 concrete organic plays. You MAY recommend a platform the user did not select when the data clearly supports it. Week 1 should lay the foundation (positioning, profile-worthy pillars), with the arc building toward launch/amplification. Organic only — never recommend paid media.`
    : `\nGO-TO-MARKET: the brand already has a social presence. Set gtm.stage = "growth" and keep the gtm section short: where to double down and why, grounded in the benchmark.`;
  const model = opts.model;
  const variants = Math.max(1, opts.variants ?? 3);

  const makePrompt = (lens?: string) => `Design this brand's EDITORIAL PLAN for the next ${PLAN_WEEKS} weeks — the strategy document an agency presents for client approval BEFORE producing content. The client will see it, edit it, and approve it; recurring content generation will then execute it week by week.

${profileBlock(profile)}
${evidenceBlock(opts)}

Platforms the user selected: ${opts.platforms.join(', ') || 'n/a'}.
Cadence: choose ONE of [${opts.allowedCadences.join(', ')}] — it says how the week is SPREAD across days, never how much of it there is; ground it in the market's real rhythm.${opts.weeklyCredits ? `

WEEKLY BUDGET — how many posts a week holds is not a number anyone wrote down: it is what this budget buys. Each week has ${opts.weeklyCredits} credits of production.
${opts.costBrief ?? ''}
Size every week's content_mix to what those credits buy, and spend them where the week deserves it rather than splitting them evenly — a week carrying one long illustrated story and two short posts can be worth more than six interchangeable ones. Planning far under the budget quietly gives the brand less than it pays for; planning over it makes a week that cannot be produced.` : ''}${gtmLine}
${lens ? `\nSTRATEGIC LENS (this proposal deliberately explores ONE direction — commit to it where the data allows, but never against the data): ${lens}\n` : ''}
Produce: the strategy statement, the voice you PROPOSE for this brand (mood, tone, goal, one-line personality — inferred from their context, not asked), the cadence, the platform mix (share + each platform's role), the gtm section, and exactly ${PLAN_WEEKS} weeks. Each week MUST have a non-empty theme, focus, content_mix (sized to ${opts.weeklyCredits ? "the week's budget" : 'the weekly cadence'}), and rationale. The 4 themes must form a deliberate arc — never 4 interchangeable labels or empty strings.
${languageLine(opts.outputLanguage)}
Return JSON.`;

  const schema = planSchema(opts.allowedCadences);

  const raw = await parallelVariants<AnyRec>(
    ai,
    (i) => aiStructured<AnyRec>(ai, makePrompt(VARIANT_LENSES[i % VARIANT_LENSES.length]), schema, PLAN_SYSTEM, 'return_editorial_plan', { temperature: CREATIVE_TEMPERATURE, model, ...PIN_GEMINI }),
    async (picked) => {
      if (picked.length === 1) return picked[0];
      const summaries = picked.map((v, i) => {
        const weeks = Array.isArray(v.weeks) ? v.weeks.map((w: AnyRec) => `W${w.week ?? w.index ?? '?'}: ${w.theme}`).join(', ') : '?';
        return `\nOPTION ${i + 1}:\nStrategy: ${v.strategy}\nCadence: ${v.cadence}\nWeeks: ${weeks}`;
      }).join('\n---');
      const prompt = `Compare these ${picked.length} editorial plans and pick the BEST one. Consider: strategic coherence, arc progression, realistic cadence, platform mix groundedness, and whether every week has a concrete theme.\n${summaries}\nReturn JSON: { "winner": <1-based index> }`;
      const selSchema = { type: 'object' as const, properties: { winner: { type: 'number' as const } }, required: ['winner'] };
      try {
        const result = await aiStructured<{ winner?: number }>(ai, prompt, selSchema, PLAN_SYSTEM, 'pick_best', { model, ...PIN_GEMINI });
        const idx = Math.max(0, Math.min(picked.length - 1, (result?.winner ?? 1) - 1));
        return picked[idx];
      } catch { return picked[0]; }
    },
    variants,
    'editorial_plan'
  );

  return normalizePlan(raw, opts.allowedCadences);
}

// Serialize the current plan for revision/replan prompts (compact, stable field order).
export function planForPrompt(plan: EditorialPlan): string {
  return JSON.stringify(
    {
      strategy: plan.strategy,
      voice: plan.voice,
      cadence: plan.cadence,
      platform_mix: plan.platform_mix,
      gtm: plan.gtm,
      weeks: plan.weeks.map((w) => ({
        week: w.index + 1,
        theme: w.theme,
        focus: w.focus,
        content_mix: w.content_mix,
        rationale: w.rationale,
        ...(w.brief ? { user_brief: w.brief } : {}),
        status: w.status
      }))
    },
    null,
    1
  );
}

// Full-plan revision from conversational feedback. Returns a NEW plan (the caller inserts it as
// status 'proposed' with parent_id) + changes_summary bullets for the review UI.
export async function revisePlan(
  ai: GoogleGenAI,
  current: EditorialPlan,
  feedback: string,
  profile: BrandProfile,
  opts: ProposePlanOpts
): Promise<EditorialPlan> {
  const agentPlan = await invokeEditorialAgent(profile, opts, 'revise', feedback, current);
  if (agentPlan) return agentPlan;

  const prompt = `Revise this brand's editorial plan based on the client's feedback. Keep everything the feedback does NOT criticise — this is a revision, not a fresh start. Weeks already marked "planned" or "done" have content produced against them: keep their themes stable unless the feedback explicitly targets them.

${profileBlock(profile)}
${evidenceBlock(opts)}

CURRENT PLAN:
${planForPrompt(current)}

CLIENT FEEDBACK:
${feedback.trim()}

Cadence must be ONE of [${opts.allowedCadences.join(', ')}]. Return the FULL revised plan (same structure, exactly ${PLAN_WEEKS} weeks) plus changes_summary: short user-facing bullets of what you changed and why.
${languageLine(opts.outputLanguage)}
Return JSON.`;

  const raw = await structured<AnyRec>(ai, prompt, planSchema(opts.allowedCadences, true), PLAN_SYSTEM);
  return normalizePlan(raw, opts.allowedCadences);
}

// Rebuild ONE week around the user's brief ("product launch week"), keeping the other weeks
// untouched. Returns the new week; the caller splices it into plan.weeks (preserving week_start,
// index and the brief itself).
export async function replanWeek(
  ai: GoogleGenAI,
  plan: EditorialPlan,
  weekIndex: number,
  brief: string,
  profile: BrandProfile,
  outputLanguage?: string,
  agentOpts?: Pick<ProposePlanOpts, 'supabase' | 'brandId' | 'userId' | 'platforms' | 'allowedCadences' | 'planTier' | 'benchmark' | 'topPosts' | 'strategyBrief' | 'agentVerbose'>
): Promise<PlanWeek> {
  if (agentOpts?.supabase && agentOpts.brandId) {
    const agentPlan = await invokeEditorialAgent(
      profile,
      { ...agentOpts, allowedCadences: agentOpts.allowedCadences ?? ['3/week', '5/week'], platforms: agentOpts.platforms ?? [] },
      'replan_week',
      brief,
      plan,
      weekIndex
    );
    if (agentPlan) {
      const week = agentPlan.weeks[weekIndex];
      if (!week) throw new Error('Strategy agent returned no week at index');
      week.week_start = plan.weeks[weekIndex]?.week_start ?? null;
      week.brief = brief.trim() || null;
      week.status = plan.weeks[weekIndex]?.status ?? 'upcoming';
      return week;
    }
  }

  const week = plan.weeks[weekIndex];
  const others = plan.weeks
    .filter((_, i) => i !== weekIndex)
    .map((w) => `- Week ${w.index + 1}: ${w.theme}${w.focus ? ` (${w.focus})` : ''}`)
    .join('\n');
  const prompt = `The client reserved week ${weekIndex + 1} of their editorial plan for something specific. Rebuild THAT WEEK ONLY around their brief, keeping it coherent with the plan's strategy and the neighbouring weeks.

${profileBlock(profile)}

PLAN STRATEGY: ${plan.strategy}
CADENCE: ${plan.cadence}
OTHER WEEKS (do not change these — your week must fit between them):
${others}

CURRENT WEEK ${weekIndex + 1}: theme "${week?.theme ?? ''}", focus "${week?.focus ?? ''}".

CLIENT BRIEF FOR THIS WEEK (authoritative): ${brief.trim()}

Return the new week: theme, focus, a content mix whose counts sum to the weekly cadence, rationale. ${languageLine(outputLanguage)}
Return JSON.`;

  const raw = await structured<AnyRec>(ai, prompt, WEEK_SCHEMA, PLAN_SYSTEM);
  const next = normWeek(raw, weekIndex);
  // Preserve identity fields the LLM doesn't own.
  next.week_start = week?.week_start ?? null;
  next.brief = brief.trim() || null;
  next.status = week?.status ?? 'upcoming';
  return next;
}

// Rollover: propose the NEXT 4-week cycle from the outgoing plan + what actually performed.
// Inserted as status 'proposed' (source 'rollover') for the user to approve — or auto-activated
// by the scheduler when the old cycle has fully lapsed, so autopilot never stalls.
export async function proposeNextCycle(
  ai: GoogleGenAI,
  previous: EditorialPlan,
  profile: BrandProfile,
  opts: ProposePlanOpts
): Promise<EditorialPlan> {
  const agentPlan = await invokeEditorialAgent(
    profile,
    opts,
    'propose_next_cycle',
    buildNextCycleSeedBrief(opts),
    previous
  );
  if (agentPlan) return agentPlan;

  const prompt = `The brand just completed a 4-week editorial cycle. Propose the NEXT ${PLAN_WEEKS}-week plan: evolve the strategy from what the previous cycle did and what actually performed — double down on what worked, retire what didn't, and bring genuinely new angles. Do NOT repeat the previous weeks' themes.

${profileBlock(profile)}
${evidenceBlock(opts)}

PREVIOUS CYCLE (just ended):
${planForPrompt(previous)}

Cadence must be ONE of [${opts.allowedCadences.join(', ')}]. Keep the gtm section updated: if the brand was 0→1 and is now getting traction, shift stage to "growth" and say where to double down.
${languageLine(opts.outputLanguage)}
Return JSON.`;

  const raw = await structured<AnyRec>(ai, prompt, planSchema(opts.allowedCadences), PLAN_SYSTEM);
  return normalizePlan(raw, opts.allowedCadences);
}

// ── DB writers (the ONLY places that activate plans / sync prefs) ────────────

// Write the approved plan's voice + cadence into brands.content_prefs (the snapshot every
// existing read path consumes), preserving language/platformInstructions.
export async function syncPrefsFromPlan(supabase: SupabaseClient, brandId: string, plan: EditorialPlan): Promise<void> {
  const { data: brand } = await supabase.from('brands').select('content_prefs').eq('id', brandId).maybeSingle();
  const existing = (brand?.content_prefs as ContentPrefs) ?? {};
  await supabase.from('brands').update({ content_prefs: prefsFromPlan(plan, existing) }).eq('id', brandId);
}

export type ProposalSaved = { ok: true; id: string } | { ok: false; error: 'insert_failed'; message: string };

// Deposit a plan as the brand's pending proposal — the ONE writer both the generated and the
// externally authored path use, so the two produce the same row. The active plan is not touched:
// only an earlier pending proposal is superseded, and activatePlan stays the step that flips it.
export async function saveProposedPlan(
  supabase: SupabaseClient,
  brandId: string,
  plan: EditorialPlan
): Promise<ProposalSaved> {
  await supabase.from('editorial_plans').update({ status: 'rejected' }).eq('brand_id', brandId).eq('status', 'proposed');

  const { data, error } = await supabase
    .from('editorial_plans')
    .insert({
      brand_id: brandId,
      status: 'proposed',
      strategy: plan.strategy || null,
      voice: plan.voice,
      cadence: plan.cadence,
      platform_mix: plan.platform_mix,
      gtm: plan.gtm,
      weeks: plan.weeks,
      source: 'manual'
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: 'insert_failed', message: error?.message ?? 'editorial_plans insert failed' };
  return { ok: true, id: data.id as string };
}

// Activate a proposed plan: supersede the current active one, stamp week_starts from this week's
// Monday (brand tz), flip status, and sync content_prefs. Every approval path goes through here.
export async function activatePlan(
  supabase: SupabaseClient,
  brandId: string,
  planId: string,
  tz: string,
  now = new Date()
): Promise<EditorialPlan | null> {
  const { data: row } = await supabase
    .from('editorial_plans')
    .select('id, strategy, voice, cadence, platform_mix, gtm, weeks')
    .eq('id', planId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!row) return null;
  const plan: EditorialPlan = {
    id: row.id,
    strategy: row.strategy ?? '',
    voice: (row.voice as PlanVoice) ?? { mood: '', tone: '', goal: '', personality: '' },
    cadence: row.cadence ?? '3/week',
    platform_mix: (row.platform_mix as PlatformMixEntry[]) ?? [],
    gtm: (row.gtm as PlanGtm) ?? null,
    weeks: ((row.weeks as PlanWeek[]) ?? []).map((w, i) => normWeek(w, i))
  };
  const weeks = stampWeekStarts(plan.weeks, tz, now);

  // Supersede whatever is active first — the partial unique index allows only one 'active' row.
  await supabase
    .from('editorial_plans')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .neq('id', planId);
  await supabase
    .from('editorial_plans')
    .update({ status: 'active', weeks, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', planId);
  const activated = { ...plan, weeks, status: 'active' };
  await syncPrefsFromPlan(supabase, brandId, activated);
  return activated;
}

// Load a brand's active editorial plan, normalised. null when the brand has none (legacy brands
// keep the pre-plan behaviour everywhere).
const EDITORIAL_PLAN_COLS =
  'id, status, strategy, voice, cadence, platform_mix, gtm, weeks, changes_summary, source, created_at, parent_id';

function editorialPlanFromRow(row: AnyRec): EditorialPlan {
  return {
    id: row.id,
    status: row.status,
    strategy: row.strategy ?? '',
    voice: (row.voice as PlanVoice) ?? { mood: '', tone: '', goal: '', personality: '' },
    cadence: row.cadence ?? '3/week',
    platform_mix: (row.platform_mix as PlatformMixEntry[]) ?? [],
    gtm: (row.gtm as PlanGtm) ?? null,
    weeks: ((row.weeks as PlanWeek[]) ?? []).map((w, i) => ({ ...normWeek(w, i), week_start: w?.week_start ?? null })),
    ...(Array.isArray(row.changes_summary) ? { changes_summary: row.changes_summary.map(String) } : {})
  };
}

export type EditorialPlanLoadWhich = 'active' | 'proposed' | 'both';

/** Load active and/or proposed editorial plans for strategy-agent reads. */
export async function loadEditorialPlans(
  supabase: SupabaseClient,
  brandId: string,
  which: EditorialPlanLoadWhich = 'both'
): Promise<{ active: EditorialPlan | null; proposed: EditorialPlan | null }> {
  const out = { active: null as EditorialPlan | null, proposed: null as EditorialPlan | null };
  const tasks: Promise<void>[] = [];
  if (which === 'active' || which === 'both') {
    tasks.push(
      supabase
        .from('editorial_plans')
        .select(EDITORIAL_PLAN_COLS)
        .eq('brand_id', brandId)
        .eq('status', 'active')
        .maybeSingle()
        .then(({ data }) => {
          if (data) out.active = editorialPlanFromRow(data);
        })
    );
  }
  if (which === 'proposed' || which === 'both') {
    tasks.push(
      supabase
        .from('editorial_plans')
        .select(EDITORIAL_PLAN_COLS)
        .eq('brand_id', brandId)
        .eq('status', 'proposed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (data) out.proposed = editorialPlanFromRow(data);
        })
    );
  }
  await Promise.all(tasks);
  return out;
}

export async function loadActivePlan(supabase: SupabaseClient, brandId: string): Promise<EditorialPlan | null> {
  const { active } = await loadEditorialPlans(supabase, brandId, 'active');
  return active;
}

// Mark one week's lifecycle status on the stored plan (e.g. 'planned' once its batch exists).
export async function setWeekStatus(
  supabase: SupabaseClient,
  planId: string,
  weekIndex: number,
  status: PlanWeek['status']
): Promise<void> {
  const { data: row } = await supabase.from('editorial_plans').select('weeks').eq('id', planId).maybeSingle();
  const weeks = Array.isArray(row?.weeks) ? (row?.weeks as PlanWeek[]) : [];
  if (!weeks[weekIndex]) return;
  weeks[weekIndex] = { ...weeks[weekIndex], status };
  await supabase.from('editorial_plans').update({ weeks, updated_at: new Date().toISOString() }).eq('id', planId);
}

// ── Product selection for the planner ────────────────────────────────────────
// A raw catalog (esp. Shopify) is mostly noise for a social planner: add-ons, default-choice
// options, spare PCBs, single keycaps. Left unranked, the planner just features whatever comes
// first — usually a bare kit/case, which photographs as a hollow shell, not a desirable product.
// This picks the SUBSTANTIAL, photogenic hero products and spreads them across categories so the
// batch isn't three near-identical objects.

type CatalogProduct = { title: string; description?: string | null; kind?: string | null; pricing?: string | null; images?: unknown };

// Pure accessories/options that should never be the SUBJECT of a post (they're upsells, not heroes).
const ACCESSORY_TITLE_RE = /\b(add-?ons?|extras?|default choice|default options?|default pcb|spare|replacement|gift card|shipping)\b/i;
// Shopify product_type values (stored in `kind`) that are supporting parts, not standalone heroes.
const SUPPORTING_KINDS = new Set(['add-on', 'accessories', 'computer accessories']);
// Categories that read as substantial, finished, photogenic products — featured first.
const HERO_KIND_RANK: Record<string, number> = {
  monitor: 100, desk: 95, 'game controller': 70, keyboards: 60, deskmat: 40,
  'sadhu board': 35, 'light bar': 30, 'volume knob': 25, switches: 15,
  'keyboard keys & caps': 12, keycaps: 12
};

function productScore(p: CatalogProduct): number {
  const title = String(p.title ?? '');
  const kind = String(p.kind ?? '').toLowerCase().trim();
  const price = parseFloat(String(p.pricing ?? '0')) || 0;
  let score = HERO_KIND_RANK[kind] ?? 20;
  // A "fully assembled" / complete product beats a bare kit/case (which looks like an empty shell).
  if (/fully assembled|wireless|complete/i.test(title)) score += 30;
  if (/\b(kit|case|barebones)\b/i.test(title) && !/fully assembled/i.test(title)) score -= 15;
  // In-Stock products are buyable NOW → ideal for posts with a real CTA. Group Buys are usually
  // time-limited campaigns that may already be closed; deprioritise them so the planner doesn't
  // build a post around false "limited-time" urgency for a drop that ended weeks ago.
  if (/\bin[-\s]?stock\b/i.test(title)) score += 25;
  if (/\b(gb|group\s?buy)\b/i.test(title)) score -= 25;
  // Price is a rough proxy for "hero" weight, capped so a 1600€ monitor doesn't dwarf everything.
  score += Math.min(price / 20, 30);
  return score;
}

// Select up to `limit` featurable products: drop imageless items and pure accessories, rank by
// substance, then round-robin across categories so the planner gets variety, not 3 of one kind.
export function selectFeaturableProducts<T extends CatalogProduct>(raw: T[], limit = 40): T[] {
  const eligible = raw.filter((p) => {
    const hasImages = Array.isArray(p.images) && p.images.length > 0;
    const kind = String(p.kind ?? '').toLowerCase().trim();
    const isAccessory = SUPPORTING_KINDS.has(kind) || ACCESSORY_TITLE_RE.test(String(p.title ?? ''));
    return hasImages && !isAccessory;
  });

  // Group by category, each group sorted best-first.
  const byKind = new Map<string, T[]>();
  for (const p of eligible) {
    const k = String(p.kind ?? 'product').toLowerCase().trim();
    (byKind.get(k) ?? byKind.set(k, []).get(k)!).push(p);
  }
  for (const list of byKind.values()) list.sort((a, b) => productScore(b) - productScore(a));

  // Order categories by their single best product, then round-robin across them so the final list
  // interleaves categories (variety) while still front-loading the strongest heroes.
  const kinds = [...byKind.keys()].sort(
    (a, b) => productScore(byKind.get(b)![0]) - productScore(byKind.get(a)![0])
  );
  const out: T[] = [];
  let added = true;
  while (out.length < limit && added) {
    added = false;
    for (const k of kinds) {
      const list = byKind.get(k)!;
      if (list.length) {
        out.push(list.shift()!);
        added = true;
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}
