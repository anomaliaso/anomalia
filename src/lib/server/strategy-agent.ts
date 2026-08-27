import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import type { GoogleGenAI } from '@google/genai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { DEEPSEEK_MODEL, deepseekAlive, noteDeepseekFailure } from '$lib/server/deepseek';
import { geminiFlash } from '$lib/server/gemini';
import { tool, stepCountIs, hasToolCall, type StopCondition } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { genaiClient } from '$lib/server/brand-context';
import { computeCostUsd, logAiCall, setBrandPlanContext, withBrandContext } from '$lib/server/ai-log';
import { persistAgentRun } from '$lib/server/agent-runs';
import { getCreditsUsage, type Brand } from '$lib/server/credits';
import { createAdminClient } from '$lib/server/supabase-admin';
import { groundedText } from '$lib/server/research';
import { benchmarkDigest, type Benchmark, type Citation } from '$lib/server/research';
import { analyzePostHistory, historyInsightsDigest } from '$lib/server/post-history-insights';
import { checkFeasibility, type FeasibilityContext } from '$lib/server/check-feasibility';
import {
  normalizePlan,
  planForPrompt,
  PLAN_WEEKS,
  type EditorialPlan,
  type ProposePlanOpts
} from '$lib/server/editorial-plan';
import { aiStructured, parallelVariants, VARIANT_LENSES, CREATIVE_TEMPERATURE, PIN_GEMINI } from '$lib/server/xiaomi';
import type { KieReasoningEffort } from '$lib/server/kie';
import {
  readBrandStudioForAgent,
  readEditorialPlanForAgent,
  readGtmForAgent,
  readKnowledgeForAgent,
  readLeadsForAgent,
  readMediaForAgent,
  readRubricsForAgent,
  readStrategyReportForAgent
} from '$lib/server/strategy-agent-reads';

// ── Strategy agent (Fase B) ───────────────────────────────────────────────────
// Agentic loop for editorial plan revise/replan. Generator stays parallelVariants; the agent
// decides when to read, search, brief, draft, verify, repair, and finish.

export const STRATEGY_AGENT_MODEL = geminiFlash;

// ── Which model runs the TEXT agents ──────────────────────────────────────────
// The editorial-plan, GTM, week-planner, SEO and analytics-review agents are pure text reasoning
// over brand context: read the studio, weigh the benchmark, draft a plan, verify it.
//
// Gemini 3.7 Flash runs them, DeepSeek V4 Flash is the fallback. DeepSeek is ~10x cheaper per
// input token, but these are the flagship outputs and the loop's stop conditions (stepCountIs,
// stall detection) were tuned against Gemini's tool-calling rhythm — the saving is not worth
// paying for in plan quality. Il lavoro strutturato di sfondo NON passa più da DeepSeek: è tornato
// tutto su Gemini Flash (vedi xiaomi.ts), quindi questo è rimasto l'unico posto dove DeepSeek fa
// del ragionamento.
//
// Force either side with AGENT_PROVIDER=deepseek|gemini — no deploy, no code change. Whichever is
// not primary is the fallback, used when the primary has no key and by withAgentFallback() when a
// run dies before touching anything. The IMAGE agent stays on Gemini regardless: DeepSeek is not
// multimodal, which is also why nothing here falls back the other way for vision work.
//
// DeepSeek is OpenAI-compatible, so this reuses @ai-sdk/openai (already a dependency) rather than
// adding a provider package.
const AGENT_PROVIDER = (env.AGENT_PROVIDER || 'gemini').toLowerCase();

export type AgentModel = { model: LanguageModel; provider: 'gemini' | 'deepseek'; modelId: string };

const geminiAgentConfigured = (): boolean => !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
// `deepseekAlive()`, non la sola presenza della chiave: una rete di salvataggio che parte solo
// quando Gemini è già morto e poi fallisce anche lei non salva niente — aggiunge una chiamata
// condannata e la stessa eccezione, un 402 più tardi.
const deepseekAgentConfigured = (): boolean => deepseekAlive();

// One cache slot per provider: both can be live at once now that one falls back to the other,
// and a single slot would rebuild the client on every alternation.
let cachedGeminiAgent: AgentModel | undefined;
let cachedDeepseekAgent: AgentModel | undefined;

function geminiAgent(): AgentModel {
  const modelId = STRATEGY_AGENT_MODEL();
  if (cachedGeminiAgent?.modelId === modelId) return cachedGeminiAgent;
  const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY });
  cachedGeminiAgent = { model: google(modelId), provider: 'gemini', modelId };
  return cachedGeminiAgent;
}

function deepseekAgent(): AgentModel {
  if (cachedDeepseekAgent?.modelId === DEEPSEEK_MODEL) return cachedDeepseekAgent;
  const deepseek = createOpenAI({
    baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    apiKey: env.DEEPSEEK_API_KEY
  });
  // .chat() pins the chat-completions surface — DeepSeek does not implement the Responses API.
  cachedDeepseekAgent = { model: deepseek.chat(DEEPSEEK_MODEL), provider: 'deepseek', modelId: DEEPSEEK_MODEL };
  return cachedDeepseekAgent;
}

/**
 * The model the text agents run on, plus the ids ai_calls must be billed against — they travel
 * together on purpose: logging a Gemini model id for a DeepSeek call would price the run at ~10x
 * its real cost and quietly corrupt every credit figure downstream.
 * Memoised per model id, so an env bump applies without recycling the process.
 */
export function agentModel(): AgentModel {
  if (AGENT_PROVIDER === 'deepseek' && deepseekAgentConfigured()) return deepseekAgent();
  if (geminiAgentConfigured()) return geminiAgent();
  // No Gemini key: DeepSeek keeps the agents running rather than failing the job outright.
  if (deepseekAgentConfigured()) return deepseekAgent();
  return geminiAgent();
}

/** The other provider, when it is configured — null when there is nothing to fall back to. */
export function agentFallbackModel(): AgentModel | null {
  const primary = agentModel();
  if (primary.provider === 'gemini') return deepseekAgentConfigured() ? deepseekAgent() : null;
  return geminiAgentConfigured() ? geminiAgent() : null;
}

/**
 * Run an agent loop on {@link agentModel}, retrying once on the other provider if the first
 * attempt dies.
 *
 * The retry is gated on `markDirty`, and that gate is the whole point. These loops are not pure:
 * their tools propose plans, edit scheduled posts and spend credits. Re-running one that already
 * executed a tool would apply those effects twice — a second set of proposals, a post edited
 * again, the budget charged twice. So the fallback only covers the failure it can cover safely:
 * the model dying before it changed anything (bad key, quota, 5xx on the first call). Once a tool
 * has run the error propagates, exactly as it does today.
 *
 * Each attempt is its own harness session, so the Usage transcript shows both — same as the
 * director's kie→Gemini retry.
 */
export async function withAgentFallback<T>(
  label: string,
  run: (m: AgentModel, markDirty: () => void) => Promise<T>
): Promise<T> {
  const primary = agentModel();
  let dirty = false;
  const markDirty = () => {
    dirty = true;
  };
  try {
    return await run(primary, markDirty);
  } catch (err) {
    if (primary.provider === 'deepseek') noteDeepseekFailure(err);
    const fallback = agentFallbackModel();
    if (dirty || !fallback) throw err;
    console.warn(
      `[${label}] ${primary.provider} failed before any tool ran, retrying on ${fallback.provider}:`,
      err instanceof Error ? err.message : err
    );
    try {
      return await run(fallback, markDirty);
    } catch (err2) {
      // Un 401/402 qui spegne DeepSeek per il processo: la prossima volta `agentFallbackModel()`
      // torna null e il run fallisce subito, invece di pagare un secondo tentativo condannato.
      if (fallback.provider === 'deepseek') noteDeepseekFailure(err2);
      throw err2;
    }
  }
}
export const MAX_STRATEGY_STEPS = 80;
export const MAX_STRATEGY_SEARCHES = 12;
export const MAX_STRATEGY_DRAFTS = 5;
export const MAX_STRATEGY_REPAIRS = 12;
export const STALL_STEP_THRESHOLD = 5;
export const PER_RUN_USD_CAP = 10;
const CREDITS_PER_USD = 100;
const ESTIMATED_DRAFT_USD = 0.08;
/**
 * Charged to the run budget per `search_web`. groundedText now leads with Google grounding
 * (~$0.07: $14/1k queries plus Gemini tokens) and only falls back to DeepSeek/Exa/Tavily, so the
 * old $0.005 estimate — an Exa price — under-counted a search by more than 10×. Still an upper
 * bound: a run that lands on a fallback provider spends a fraction of it. Real billing is
 * unaffected either way; it comes from ai_calls, not from this counter.
 */
export const ESTIMATED_SEARCH_USD = 0.07;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;
type BrandProfile = AnyRec;

export type StrategyAgentMode = 'propose' | 'propose_next_cycle' | 'revise' | 'replan_week';

export type StrategyAgentOpts = {
  supabase: SupabaseClient;
  userId?: string;
  brandId: string;
  profile: BrandProfile;
  constraints: {
    allowedCadences: string[];
    platforms: string[];
    planTier: string | null;
    timezone?: string;
  };
  mode: StrategyAgentMode;
  /** Required for revise/replan_week/propose_next_cycle; omit for fresh propose. */
  currentPlan?: EditorialPlan;
  seedBrief: string;
  weekIndex?: number;
  outputLanguage?: string;
  reasoningEffort?: KieReasoningEffort;
  planOpts?: ProposePlanOpts;
  deadlineMs?: number;
  budget?: { searches?: number; drafts?: number; repairs?: number };
  /** Log each tool call/result to stdout (for scripts and debugging). */
  verbose?: boolean;
};

export type StrategyAgentStepLog = {
  step: number;
  toolCalls?: Array<{ name: string; input: unknown }>;
  toolResults?: Array<{ name: string; output: unknown }>;
  text?: string;
};

export type StrategyAgentResult = {
  plan: EditorialPlan;
  notes: string;
  citations: Citation[];
  costUsd: number;
  credits: number;
  stepLog?: StrategyAgentStepLog[];
};

export type StrategyBudget = {
  searchesLeft: number;
  draftsLeft: number;
  repairsLeft: number;
  usdSpent: number;
  usdRemaining: number;
  tokensIn: number;
  tokensOut: number;
};

// Opt-IN, like the image agent: a migration this size ships dark and is switched on per brand
// once measured. Defaulting on would have put an unproven loop in front of onboarding.
/** Opt-out: STRATEGY_AGENT_ENABLED=false falls back to legacy editorial propose/revise. Default ON. */
export function strategyAgentEnabled(): boolean {
  return env.STRATEGY_AGENT_ENABLED !== 'false';
}

export function createStrategyBudget(opts?: {
  searches?: number;
  drafts?: number;
  repairs?: number;
  usdRemaining?: number;
}): StrategyBudget {
  return {
    searchesLeft: opts?.searches ?? MAX_STRATEGY_SEARCHES,
    draftsLeft: opts?.drafts ?? MAX_STRATEGY_DRAFTS,
    repairsLeft: opts?.repairs ?? MAX_STRATEGY_REPAIRS,
    usdSpent: 0,
    usdRemaining: opts?.usdRemaining ?? PER_RUN_USD_CAP,
    tokensIn: 0,
    tokensOut: 0
  };
}

export function consumeSearchBudget(budget: StrategyBudget): { ok: true } | { ok: false; error: string } {
  if (budget.searchesLeft <= 0) {
    return { ok: false, error: `search_web budget exhausted (max ${MAX_STRATEGY_SEARCHES} per run)` };
  }
  budget.searchesLeft -= 1;
  return { ok: true };
}

export function consumeDraftBudget(budget: StrategyBudget): { ok: true } | { ok: false; error: string } {
  if (budget.draftsLeft <= 0) {
    return { ok: false, error: `draft_variants budget exhausted (max ${MAX_STRATEGY_DRAFTS} per run)` };
  }
  budget.draftsLeft -= 1;
  return { ok: true };
}

export function consumeRepairBudget(budget: StrategyBudget): { ok: true } | { ok: false; error: string } {
  if (budget.repairsLeft <= 0) {
    return { ok: false, error: `repair_plan budget exhausted (max ${MAX_STRATEGY_REPAIRS} per run)` };
  }
  budget.repairsLeft -= 1;
  return { ok: true };
}

/**
 * `ran` is the model that actually served the step. It defaults to the primary, but a loop that
 * fell back to the other provider must pass its own — DeepSeek and Gemini are ~10x apart per
 * token, so pricing a DeepSeek step as Gemini would eat the run's budget an order of magnitude
 * too fast (or too slow) and corrupt the credit figures downstream.
 */
export function addStrategyStepCost(
  budget: StrategyBudget,
  usage?: { inputTokens?: number; outputTokens?: number },
  ran?: AgentModel
): void {
  if (!usage) return;
  budget.tokensIn += usage.inputTokens ?? 0;
  budget.tokensOut += usage.outputTokens ?? 0;
  const billed = ran ?? agentModel();
  const stepUsd =
    computeCostUsd({
      label: 'strategy-agent-step',
      provider: billed.provider,
      model: billed.modelId,
      ms: 0,
      ok: true,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens
    }) ?? 0;
  budget.usdSpent += stepUsd;
  budget.usdRemaining = Math.max(0, budget.usdRemaining - stepUsd);
}

function capRunUsdBudget(remainingCreditsUsd: number): number {
  return Math.min(PER_RUN_USD_CAP, Math.max(0, remainingCreditsUsd / CREDITS_PER_USD));
}

export async function fetchUsdBudget(brandId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { data: brand } = await admin.from('brands').select('id, plan, activated_at, status').eq('id', brandId).maybeSingle();
    if (!brand) return PER_RUN_USD_CAP;
    setBrandPlanContext((brand as Brand).plan);
    const usage = await getCreditsUsage(admin, brand as Brand);
    return capRunUsdBudget(usage.remaining);
  } catch {
    return PER_RUN_USD_CAP;
  }
}

export async function loadFeasibilityContext(
  supabase: SupabaseClient,
  brandId: string,
  allowedCadences: string[],
  platforms: string[]
): Promise<FeasibilityContext> {
  const [{ data: products }, { data: people }, rubrics] = await Promise.all([
    supabase.from('products').select('images').eq('brand_id', brandId),
    supabase.from('people').select('images').eq('brand_id', brandId),
    import('$lib/server/rubrics').then(({ loadApprovedRubrics }) => loadApprovedRubrics(supabase, brandId))
  ]);
  const productsWithImages = (products ?? []).filter((p) => Array.isArray(p.images) && p.images.length > 0).length;
  const peopleWithImages = (people ?? []).filter((p) => Array.isArray(p.images) && p.images.length > 0).length;
  return {
    allowedCadences,
    selectedPlatforms: platforms,
    productsWithImages,
    peopleWithImages,
    approvedRubrics: rubrics
  };
}

const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY });

function planSchema(allowedCadences: string[], withChanges = false) {
  return {
    type: 'object' as const,
    properties: {
      strategy: { type: 'string' as const },
      voice: {
        type: 'object' as const,
        properties: {
          mood: { type: 'string' as const },
          tone: { type: 'string' as const },
          goal: { type: 'string' as const },
          personality: { type: 'string' as const }
        },
        required: ['mood', 'tone', 'goal', 'personality']
      },
      cadence: { type: 'string' as const, enum: allowedCadences as [string, ...string[]] },
      platform_mix: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            platform: { type: 'string' as const },
            share: { type: 'string' as const },
            role: { type: 'string' as const }
          },
          required: ['platform', 'share', 'role']
        }
      },
      gtm: { type: 'object' as const },
      weeks: { type: 'array' as const },
      ...(withChanges ? { changes_summary: { type: 'array' as const, items: { type: 'string' as const } } } : {})
    },
    required: ['strategy', 'voice', 'cadence', 'platform_mix', 'weeks', ...(withChanges ? ['changes_summary'] : [])]
  };
}

const PLAN_SYSTEM =
  'You are a senior social-media strategist at an agency, writing the editorial plan a client signs off on. Be specific, honest and grounded in the data provided.';

async function draftEditorialVariants(
  ai: GoogleGenAI,
  profile: BrandProfile,
  agentBrief: string,
  opts: ProposePlanOpts & { n?: number; lenses?: string[]; withChanges?: boolean; brandId?: string }
): Promise<AnyRec> {
  const n = Math.min(3, Math.max(1, opts.n ?? 3));
  const lenses = opts.lenses?.length ? opts.lenses.slice(0, n) : VARIANT_LENSES.slice(0, n);
  const schema = planSchema(opts.allowedCadences, !!opts.withChanges);
  const makePrompt = (lens?: string) => `Design this brand's EDITORIAL PLAN for the next ${PLAN_WEEKS} weeks.

AGENT BRIEF (authoritative direction from prior research):
${agentBrief}

Brand: ${profile?.name ?? ''}
About: ${profile?.about ?? ''}
Platforms: ${opts.platforms.join(', ') || 'n/a'}
Cadence must be ONE of [${opts.allowedCadences.join(', ')}].
${lens ? `STRATEGIC LENS: ${lens}` : ''}
Each week: non-empty theme, focus, content_mix summing to weekly cadence, rationale.
${opts.outputLanguage ? `Write user-facing prose in ${opts.outputLanguage}.` : ''}
Return JSON.`;

  return parallelVariants<AnyRec>(
    ai,
    (i) =>
      aiStructured<AnyRec>(ai, makePrompt(lenses[i % lenses.length]), schema, PLAN_SYSTEM, 'return_editorial_plan', {
        temperature: CREATIVE_TEMPERATURE,
        model: opts.model,
        brandId: opts.brandId,
        ...PIN_GEMINI
      }),
    async (picked) => {
      if (picked.length === 1) return picked[0];
      const summaries = picked.map((v, i) => `\nOPTION ${i + 1}:\nStrategy: ${v.strategy}\nCadence: ${v.cadence}`).join('\n---');
      const prompt = `Pick the best editorial plan.\n${summaries}\nReturn JSON: { "winner": <1-based index> }`;
      const selSchema = { type: 'object' as const, properties: { winner: { type: 'number' as const } }, required: ['winner'] };
      try {
        const result = await aiStructured<{ winner?: number }>(ai, prompt, selSchema, PLAN_SYSTEM, 'pick_best', {
          brandId: opts.brandId,
          ...PIN_GEMINI
        });
        const idx = Math.max(0, Math.min(picked.length - 1, (result?.winner ?? 1) - 1));
        return picked[idx];
      } catch {
        return picked[0];
      }
    },
    n,
    'strategy_draft'
  );
}

function applyPlanPatch(plan: EditorialPlan, patch: AnyRec): EditorialPlan {
  const merged: EditorialPlan = {
    ...plan,
    ...patch,
    voice: { ...plan.voice, ...(patch.voice ?? {}) },
    weeks: plan.weeks.map((w, i) => {
      const pw = Array.isArray(patch.weeks) ? patch.weeks[i] : undefined;
      if (!pw || typeof pw !== 'object') return w;
      return {
        ...w,
        theme: pw.theme != null ? String(pw.theme) : w.theme,
        focus: pw.focus != null ? String(pw.focus) : w.focus,
        rationale: pw.rationale != null ? String(pw.rationale) : w.rationale,
        content_mix: Array.isArray(pw.content_mix) ? pw.content_mix : w.content_mix,
        brief: pw.brief != null ? String(pw.brief) : w.brief
      };
    })
  };
  if (Array.isArray(patch.changes_summary)) {
    merged.changes_summary = patch.changes_summary.map(String).filter(Boolean);
  }
  return merged;
}

function emptyPlanStub(allowedCadences: string[]): EditorialPlan {
  return {
    strategy: '',
    voice: { mood: '', tone: '', goal: '', personality: '' },
    cadence: allowedCadences[0] ?? '3/week',
    platform_mix: [],
    gtm: null,
    weeks: []
  };
}

function buildSystemPrompt(mode: StrategyAgentMode, allowedCadences: string[]): string {
  const modeLine =
    mode === 'propose'
      ? 'Create a brand-new 4-week editorial plan from scratch.'
      : mode === 'propose_next_cycle'
        ? 'Propose the NEXT 4-week cycle — evolve from the previous plan and performance data.'
        : mode === 'replan_week'
          ? 'Rebuild ONE week around the client brief; keep other weeks aligned.'
          : 'Revise the editorial plan from client feedback; preserve what was not criticised.';

  return `You are a strategy agent for editorial plans. ${modeLine}

Workflow:
1. read_* tools are FREE — start with read_brand_studio, read_rubrics, read_leads, read_gtm, read_editorial_plan, read_knowledge, read_media, read_post_history, read_competitors, read_radar as needed.
2. search_web costs money (max ${MAX_STRATEGY_SEARCHES}/run) — only when DB data is insufficient.
3. Write a clear brief, then draft_variants (max ${MAX_STRATEGY_DRAFTS}/run, n≤3).
4. check_feasibility on the plan before finish — repair_plan or draft again if violations remain. When the brand has approved rubrics (serie ripetibili), content_mix types MUST be rubric names.
5. finish with the final plan, notes explaining what you did, and citations from search.

Cadence allowed: ${allowedCadences.join(', ')}. Mode: ${mode}.
No critique tool — you judge in your reasoning.`;
}

export function appendBudgetToSystem(base: string, budget: StrategyBudget, remainingSec: number): string {
  return `${base}\n\nBUDGET: searches_left=${budget.searchesLeft}, drafts_left=${budget.draftsLeft}, repairs_left=${budget.repairsLeft}, usd_remaining≈$${budget.usdRemaining.toFixed(2)}, time_left≈${remainingSec}s`;
}

/**
 * Per-step stall fingerprint. Includes WHAT THE STEP DID (tool names + inputs), not just the
 * resulting state — reading ten different things in a row is progress, and a state-only
 * fingerprint cannot tell it apart from spinning. Every agent prompt here opens with a run of
 * free read_* calls, so a state-only fingerprint tripped the stall detector on the exact
 * sequence the prompt asks for. Identical repeated calls still collide, which is the real stall.
 */
export function stepFingerprint(
  state: unknown,
  toolCalls?: Array<{ toolName: string; input?: unknown }>
): string {
  const calls = (toolCalls ?? []).map((tc) => {
    let input = '';
    try {
      input = JSON.stringify(tc.input ?? null);
    } catch {
      input = '[unserializable]';
    }
    // Cap the input slice: a huge draft payload would make every step unique and disable the
    // detector entirely, which is the opposite failure.
    return `${tc.toolName}:${input.slice(0, 300)}`;
  });
  return JSON.stringify({ state, calls });
}

export function stallDetected(fingerprints: string[], threshold: number): boolean {
  if (fingerprints.length < threshold) return false;
  const tail = fingerprints.slice(-threshold);
  return tail.every((f) => f === tail[0]);
}

/** True once the run has burned its wall-clock budget. Used as a stop condition so the agent
 *  returns its best draft instead of being killed mid-flight by the platform's function timeout. */
export function deadlineReached(startedAt: number, deadlineMs: number): boolean {
  return Date.now() - startedAt >= deadlineMs;
}

export async function runStrategyAgent(opts: StrategyAgentOpts): Promise<StrategyAgentResult> {
  return withBrandContext(opts.brandId, () => runStrategyAgentInner(opts));
}

async function runStrategyAgentInner(opts: StrategyAgentOpts): Promise<StrategyAgentResult> {
  const ai = genaiClient();
  const basePlan = opts.currentPlan ?? emptyPlanStub(opts.constraints.allowedCadences);
  const feasibilityCtx = await loadFeasibilityContext(
    opts.supabase,
    opts.brandId,
    opts.constraints.allowedCadences,
    opts.constraints.platforms
  );
  const usdBudget = await fetchUsdBudget(opts.brandId);
  const budget = createStrategyBudget({ ...opts.budget, usdRemaining: usdBudget });
  const citations: Citation[] = [];
  let workingPlan: EditorialPlan | null = null;
  let finished: { plan: EditorialPlan; notes: string } | null = null;
  const stallFingerprints: string[] = [];
  const stepLog: StrategyAgentStepLog[] = [];
  let stepNum = 0;
  const t0 = Date.now();
  const deadlineMs = opts.deadlineMs ?? 280_000;
  const baseSystem = buildSystemPrompt(opts.mode, opts.constraints.allowedCadences);

  const planOpts: ProposePlanOpts & { withChanges?: boolean; brandId?: string } = {
    platforms: opts.constraints.platforms,
    allowedCadences: opts.constraints.allowedCadences,
    outputLanguage: opts.outputLanguage,
    brandId: opts.brandId,
    withChanges: opts.mode === 'revise',
    ...opts.planOpts
  };

  const userPrompt =
    opts.mode === 'propose'
      ? `Design a brand-new ${PLAN_WEEKS}-week editorial plan for this brand.\n\nSEED CONTEXT (pre-assembled — verify and enrich with read_* tools):\n${opts.seedBrief}`
      : opts.mode === 'propose_next_cycle'
        ? `Propose the NEXT ${PLAN_WEEKS}-week editorial cycle. Evolve from what performed; do NOT repeat previous themes.\n\nSEED CONTEXT:\n${opts.seedBrief}\n\nPREVIOUS CYCLE:\n${planForPrompt(basePlan)}`
        : opts.mode === 'replan_week'
          ? `Rebuild week ${(opts.weekIndex ?? 0) + 1} of the editorial plan around this brief. Other weeks must stay aligned.\n\nBRIEF:\n${opts.seedBrief}\n\nCURRENT PLAN:\n${planForPrompt(basePlan)}`
          : `Revise the editorial plan from client feedback.\n\nFEEDBACK:\n${opts.seedBrief}\n\nCURRENT PLAN:\n${planForPrompt(basePlan)}`;

  const tools = {
    read_brand: tool({
      description: 'Quick brand summary: kit highlights + asset counts (free). Prefer read_brand_studio for full Studio data.',
      inputSchema: z.object({}),
      execute: async () => {
        const { data: kit } = await opts.supabase
          .from('brand_kit')
          .select('category, about, target_audience, ai_context, content_pillars, brand_style')
          .eq('brand_id', opts.brandId)
          .maybeSingle();
        const { data: brand } = await opts.supabase
          .from('brands')
          .select('name, plan, timezone, target_platforms')
          .eq('id', opts.brandId)
          .maybeSingle();
        return {
          brand: brand?.name,
          plan_tier: brand?.plan,
          timezone: brand?.timezone,
          platforms: brand?.target_platforms,
          kit,
          assets: feasibilityCtx
        };
      }
    }),

    read_brand_studio: tool({
      description:
        'Full Studio snapshot: brand kit (identity, visual_style, brand_style, colors, fonts, logos, ai_context, content_pillars), voice prefs, products, people, competitors, completeness (free).',
      inputSchema: z.object({}),
      execute: async () => readBrandStudioForAgent(opts.supabase, opts.brandId)
    }),

    read_rubrics: tool({
      description:
        'Approved recurring content series (rubriche): named formats the brand publishes repeatedly. Authoritative for content_mix and weekly seeds when present (free).',
      inputSchema: z.object({
        which: z.enum(['approved', 'proposed', 'both']).optional().describe('Default approved')
      }),
      execute: async ({ which }) => readRubricsForAgent(opts.supabase, opts.brandId, which ?? 'approved')
    }),

    read_gtm: tool({
      description:
        'Active and/or proposed GTM roadmap (90d + 6m phases, funnel, current phase brief). Use before revising editorial strategy (free).',
      inputSchema: z.object({
        which: z.enum(['active', 'proposed', 'both']).optional().describe('Default both')
      }),
      execute: async ({ which }) =>
        readGtmForAgent(
          opts.supabase,
          opts.brandId,
          opts.constraints.timezone ?? 'Europe/Rome',
          which ?? 'both'
        )
    }),

    read_editorial_plan: tool({
      description: 'Active and/or proposed editorial plan already stored for this brand (free).',
      inputSchema: z.object({
        which: z.enum(['active', 'proposed', 'both']).optional().describe('Default both')
      }),
      execute: async ({ which }) => readEditorialPlanForAgent(opts.supabase, opts.brandId, which ?? 'both')
    }),

    read_strategy_report: tool({
      description: 'Stored strategy report + positioning + strategy brief from research (free).',
      inputSchema: z.object({}),
      execute: async () => readStrategyReportForAgent(opts.supabase, opts.brandId)
    }),

    read_knowledge: tool({
      description:
        'Search brand knowledge (chunk FTS) or list document summaries. Prefer query for facts; use kind=image for mood references (free).',
      inputSchema: z.object({
        query: z.string().optional().describe('FTS query over document chunks'),
        kind: z.enum(['note', 'document', 'image']).optional(),
        limit: z.number().int().min(1).max(60).optional()
      }),
      execute: async ({ query, kind, limit }) =>
        readKnowledgeForAgent(opts.supabase, opts.brandId, { query, kind, limit })
    }),

    read_media: tool({
      description:
        'Brand Media library with AI catalog (description, tags, when/how/where to use). Check before planning visual-heavy formats (free).',
      inputSchema: z.object({
        query: z.string().optional(),
        kind: z.enum(['image', 'video']).optional(),
        status: z.enum(['pending', 'ready', 'failed']).optional(),
        limit: z.number().int().min(1).max(50).optional()
      }),
      execute: async ({ query, kind, status, limit }) =>
        readMediaForAgent(opts.supabase, opts.brandId, { query, kind, status, limit })
    }),

    read_post_history: tool({
      description: 'Performance insights from scraped post history (free).',
      inputSchema: z.object({ limit: z.number().int().min(1).max(200).optional() }),
      execute: async ({ limit }) => {
        const { data: history } = await opts.supabase
          .from('social_post_history')
          .select('content, platform, metrics, published_at, media_type')
          .eq('brand_id', opts.brandId)
          .eq('source', 'zernio')
          .limit(limit ?? 100);
        const insights = analyzePostHistory(
          (history ?? []).map((h) => ({
            content: h.content,
            mediaType: h.media_type,
            publishedAt: h.published_at,
            metrics: h.metrics as AnyRec
          }))
        );
        return { insights, digest: historyInsightsDigest(insights) };
      }
    }),

    read_competitors: tool({
      description: 'Competitor benchmark already in DB (free).',
      inputSchema: z.object({}),
      execute: async () => {
        const { data: strategy } = await opts.supabase
          .from('brand_strategy')
          .select('benchmark')
          .eq('brand_id', opts.brandId)
          .maybeSingle();
        const benchmark = (strategy?.benchmark as Benchmark | null) ?? null;
        return { digest: benchmark ? benchmarkDigest(benchmark) : 'No benchmark stored.' };
      }
    }),

    read_radar: tool({
      description: 'Recent radar/news signals (free).',
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
      execute: async ({ limit }) => {
        const { data: items } = await opts.supabase
          .from('brand_news_items')
          .select('title, url, source_name, relevance, created_at')
          .eq('brand_id', opts.brandId)
          .order('created_at', { ascending: false })
          .limit(limit ?? 10);
        return { items: items ?? [] };
      }
    }),

    read_leads: tool({
      description:
        'Online conversations (Reddit/Threads/X) with drafted comment/DM suggestions — what people discuss about the product/category (free).',
      inputSchema: z.object({
        status: z.enum(['suggested', 'done', 'dismissed', 'all']).optional().describe('Default all'),
        limit: z.number().int().min(1).max(50).optional()
      }),
      execute: async ({ status, limit }) => readLeadsForAgent(opts.supabase, opts.brandId, { status, limit })
    }),

    check_feasibility: tool({
      description: 'Deterministic feasibility check on a plan draft (free).',
      inputSchema: z.object({ plan: z.record(z.string(), z.unknown()) }),
      execute: async ({ plan }) => {
        const normalized = normalizePlan(plan as AnyRec, opts.constraints.allowedCadences);
        const violations = checkFeasibility(normalized, feasibilityCtx);
        workingPlan = normalized;
        lastViolations = violations;
        return { ok: violations.length === 0, violations };
      }
    }),

    search_web: tool({
      description: `Paid web search via Exa (max ${MAX_STRATEGY_SEARCHES}/run). Use only when DB reads are insufficient.`,
      inputSchema: z.object({
        query: z.string(),
        source: z.enum(['exa']).optional()
      }),
      execute: async ({ query }) => {
        const gate = consumeSearchBudget(budget);
        if (!gate.ok) return { error: gate.error };
        if (budget.usdRemaining <= 0) return { error: 'USD budget exhausted for this run' };
        // Full chain, Google grounding FIRST, with DeepSeek/Exa/Tavily as fallbacks.
        const { text, citations: cits } = await groundedText(genaiClient(), query, undefined, { brandId: opts.brandId });
        citations.push(...cits);
        budget.usdSpent += ESTIMATED_SEARCH_USD;
        budget.usdRemaining = Math.max(0, budget.usdRemaining - ESTIMATED_SEARCH_USD);
        return { text, citations: cits };
      }
    }),

    draft_variants: tool({
      description: `Generate N editorial plan variants from your brief (max ${MAX_STRATEGY_DRAFTS} calls/run, n≤3).`,
      inputSchema: z.object({
        brief: z.string(),
        n: z.number().int().min(1).max(3).optional(),
        lenses: z.array(z.string()).optional()
      }),
      execute: async ({ brief, n, lenses }) => {
        const gate = consumeDraftBudget(budget);
        if (!gate.ok) return { error: gate.error };
        if (budget.usdRemaining < ESTIMATED_DRAFT_USD) return { error: 'USD budget too low for draft_variants' };
        const raw = await draftEditorialVariants(ai, opts.profile, brief, {
          ...planOpts,
          n,
          lenses
        });
        const normalized = normalizePlan(raw, opts.constraints.allowedCadences);
        if (opts.mode === 'replan_week' && opts.weekIndex != null) {
          const weeks = basePlan.weeks.map((w, i) =>
            i === opts.weekIndex ? { ...w, ...normalized.weeks[opts.weekIndex!] } : w
          );
          workingPlan = normalizePlan({ ...basePlan, ...normalized, weeks }, opts.constraints.allowedCadences);
        } else {
          workingPlan = normalized;
        }
        budget.usdSpent += ESTIMATED_DRAFT_USD;
        budget.usdRemaining = Math.max(0, budget.usdRemaining - ESTIMATED_DRAFT_USD);
        return { ok: true, strategy: workingPlan.strategy, cadence: workingPlan.cadence, weeks: workingPlan.weeks.map((w) => w.theme) };
      }
    }),

    repair_plan: tool({
      description: `Apply a targeted patch to fix feasibility violations (max ${MAX_STRATEGY_REPAIRS}/run).`,
      inputSchema: z.object({
        patch: z.record(z.string(), z.unknown()),
        reason: z.string()
      }),
      execute: async ({ patch, reason }) => {
        const gate = consumeRepairBudget(budget);
        if (!gate.ok) return { error: gate.error };
        const base = workingPlan ?? basePlan;
        workingPlan = normalizePlan(applyPlanPatch(base, patch) as unknown as AnyRec, opts.constraints.allowedCadences);
        const violations = checkFeasibility(workingPlan, feasibilityCtx);
        return { ok: violations.length === 0, reason, violations };
      }
    }),

    finish: tool({
      description: 'Complete with the final plan.',
      inputSchema: z.object({
        plan: z.record(z.string(), z.unknown()).optional(),
        notes: z.string(),
        citations: z
          .array(z.object({ uri: z.string(), title: z.string() }))
          .optional()
      }),
      execute: async ({ plan, notes, citations: extraCitations }) => {
        const raw = (plan as AnyRec) ?? workingPlan ?? basePlan;
        const normalized = normalizePlan(raw as AnyRec, opts.constraints.allowedCadences);
        const violations = checkFeasibility(normalized, feasibilityCtx);
        if (violations.length) {
          lastViolations = violations;
          return { error: 'Plan still has feasibility violations', violations };
        }
        if (extraCitations?.length) citations.push(...extraCitations);
        finished = { plan: normalized, notes: notes.trim() };
        return { ok: true };
      }
    })
  };

  const stallStop: StopCondition<typeof tools> = () => stallDetected(stallFingerprints, STALL_STEP_THRESHOLD);
  const loopT0 = Date.now();
  let loopOk = true;
  let loopError: string | undefined;
  let lastViolations: string[] = [];

  // Reassigned by withAgentFallback when the primary dies before any tool ran — the finally
  // below must bill the model that actually served the loop.
  let loopModel = agentModel();

  try {
    await withAgentFallback('strategy-agent', (chosen, markDirty) => {
      loopModel = chosen;
      return harnessGenerateText({
        brandId: opts.brandId,
        userId: opts.userId,
        agent: 'strategy',
        mode: opts.mode,
        model: loopModel.modelId,
        provider: loopModel.provider,
        surface: 'batch'
      }, {
        // Text-only reasoning → DeepSeek by default (see strategyAgentModel).
        model: loopModel.model,
        maxOutputTokens: maxOutputTokensFor(loopModel.provider),
        system: baseSystem,
        prompt: `${userPrompt}\n\nStart by reading stored brand context (read_brand_studio, read_gtm, read_editorial_plan, read_knowledge, read_media) before any paid search.`,
        tools,
        stopWhen: [hasToolCall('finish'), stepCountIs(MAX_STRATEGY_STEPS), stallStop, () => deadlineReached(t0, deadlineMs)],
        temperature: 0.4,
        prepareStep: () => {
          const elapsed = Date.now() - t0;
          const remainingSec = Math.max(0, Math.round((deadlineMs - elapsed) / 1000));
          const stepSystem = appendBudgetToSystem(baseSystem, budget, remainingSec);
          if (budget.usdRemaining <= 0 && (workingPlan || basePlan.weeks.length)) {
            return { toolChoice: { type: 'tool' as const, toolName: 'finish' }, system: stepSystem };
          }
          return { system: stepSystem };
        },
        onStepFinish: ({ usage, toolCalls, toolResults, text }) => {
          addStrategyStepCost(budget, usage, loopModel);
          stallFingerprints.push(
            stepFingerprint(
              { cadence: workingPlan?.cadence, w0: workingPlan?.weeks?.[0]?.theme, s: budget.searchesLeft, d: budget.draftsLeft },
              toolCalls?.map((tc) => ({ toolName: tc.toolName, input: 'input' in tc ? tc.input : undefined }))
            )
          );
          stepNum += 1;
          const entry: StrategyAgentStepLog = {
            step: stepNum,
            toolCalls: toolCalls?.map((tc) => ({ name: tc.toolName, input: 'input' in tc ? tc.input : undefined })),
            toolResults: toolResults?.map((tr) => ({ name: tr.toolName, output: 'output' in tr ? tr.output : undefined })),
            text: text?.trim() || undefined
          };
          stepLog.push(entry);
          if (opts.verbose) {
            console.log(`\n[strategy-agent] ══ step ${stepNum} ══`);
            for (const tc of entry.toolCalls ?? []) {
              console.log(`  → ${tc.name}`, JSON.stringify(tc.input, null, 2).slice(0, 1500));
            }
            for (const tr of entry.toolResults ?? []) {
              console.log(`  ← ${tr.name}`, JSON.stringify(tr.output, null, 2).slice(0, 3000));
            }
            if (entry.text) console.log(`  · text: ${entry.text.slice(0, 400)}`);
            console.log(
              `  · budget: searches=${budget.searchesLeft} drafts=${budget.draftsLeft} repairs=${budget.repairsLeft} usd≈$${budget.usdRemaining.toFixed(2)}`
            );
          }
        }
      }, { before: [() => { markDirty(); }] });
    });
  } catch (e) {
    loopOk = false;
    loopError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    logAiCall({
      label: 'strategy-agent',
      provider: loopModel.provider,
      model: loopModel.modelId,
      ms: Date.now() - loopT0,
      ok: loopOk,
      error: loopError,
      inputTokens: budget.tokensIn,
      outputTokens: budget.tokensOut,
      brandId: opts.brandId,
      userId: opts.userId,
      context: 'strategy-agent'
    });

    const resolvedPreview =
      finished ?? (workingPlan ? { plan: workingPlan, notes: 'Agent ended without finish; using last draft.' } : null);
    persistAgentRun({
      brandId: opts.brandId,
      userId: opts.userId,
      agent: 'strategy',
      mode: opts.mode,
      status: finished ? 'finished' : resolvedPreview ? 'fallback' : 'failed',
      finishedOk: !!finished,
      notes: resolvedPreview?.notes,
      citations,
      steps: stepLog,
      violations: lastViolations.length ? lastViolations : undefined,
      costUsdEstimate: budget.usdSpent
    });
  }

  const resolved = finished ?? (workingPlan ? { plan: workingPlan, notes: 'Agent ended without finish; using last draft.' } : null);
  if (!resolved) {
    throw new Error('Strategy agent finished without a plan');
  }

  return {
    plan: resolved.plan,
    notes: resolved.notes,
    citations,
    costUsd: budget.usdSpent,
    credits: Math.round(budget.usdSpent * CREDITS_PER_USD),
    ...(opts.verbose ? { stepLog } : {})
  };
}
