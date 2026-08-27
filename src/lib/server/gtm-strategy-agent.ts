import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { tool, stepCountIs, type StopCondition } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { genaiClient } from '$lib/server/brand-context';
import { withBrandContext, logAiCall } from '$lib/server/ai-log';
import { persistAgentRun, type AgentStepLog } from '$lib/server/agent-runs';
import { checkGtmFeasibility } from '$lib/server/check-gtm-feasibility';
import {
  draftGtmDualWithBrief,
  draftGtmRedirectWithBrief,
  gtmForPrompt,
  type GtmDualOpts,
  type GtmPlan
} from '$lib/server/gtm';
import { stampFunnelGoals } from '$lib/server/funnel';
import { groundedText } from '$lib/server/research';
import { benchmarkDigest, type Benchmark, type Citation } from '$lib/server/research';
import { analyzePostHistory, historyInsightsDigest } from '$lib/server/post-history-insights';
import {
  addStrategyStepCost,
  consumeDraftBudget,
  consumeRepairBudget,
  consumeSearchBudget,
  createStrategyBudget,
  fetchUsdBudget,
  stallDetected,
  stepFingerprint,
  deadlineReached,
  appendBudgetToSystem,
  MAX_STRATEGY_SEARCHES,
  MAX_STRATEGY_REPAIRS,
  ESTIMATED_SEARCH_USD,
  type StrategyBudget, agentModel, withAgentFallback } from '$lib/server/strategy-agent';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;
type BrandProfile = AnyRec;

export const MAX_GTM_AGENT_STEPS = 60;
export const MAX_GTM_AGENT_DRAFTS = 4;
const ESTIMATED_GTM_DRAFT_USD = 0.25;
const CREDITS_PER_USD = 100;

export type GtmAgentMode = 'propose' | 'revise';

export type GtmStrategyAgentOpts = {
  supabase: SupabaseClient;
  userId?: string;
  brandId: string;
  profile: BrandProfile;
  platforms: string[];
  mode: GtmAgentMode;
  seedBrief: string;
  currentPlan?: GtmPlan;
  phaseIndex?: number;
  planOpts: GtmDualOpts;
  timezone?: string;
  verbose?: boolean;
  // Wall-clock budget. Default well under the 300s platform ceiling so the agent hands back its
  // best draft instead of being killed mid-flight (a killed function skips the legacy fallback).
  deadlineMs?: number;
};

export type GtmStrategyAgentResult = {
  plan: GtmPlan;
  notes: string;
  citations: Citation[];
  costUsd: number;
  credits: number;
  stepLog?: AgentStepLog[];
};

/** Opt-out: GTM_AGENT_ENABLED=false falls back to legacy GTM propose. Default ON. */
export function gtmStrategyAgentEnabled(): boolean {
  return env.GTM_AGENT_ENABLED !== 'false';
}

function finalizeGtmPlan(raw: GtmPlan, funnel: GtmPlan['funnel']): GtmPlan {
  const phases90d = stampFunnelGoals(raw.phases_90d ?? [], funnel);
  const phases6m = stampFunnelGoals(raw.phases_6m ?? raw.phases, funnel);
  return {
    ...raw,
    horizon: '6m',
    phases: phases6m,
    phases_90d: phases90d,
    phases_6m: phases6m,
    funnel: funnel ?? null
  };
}

function applyGtmPatch(plan: GtmPlan, patch: AnyRec): GtmPlan {
  const merged: GtmPlan = {
    ...plan,
    ...(patch.objective != null ? { objective: String(patch.objective) } : {}),
    ...(patch.reply != null ? { reply: String(patch.reply) } : {}),
    ...(Array.isArray(patch.changes_summary)
      ? { changes_summary: patch.changes_summary.map(String).filter(Boolean) }
      : {})
  };
  if (Array.isArray(patch.phases_90d)) {
    merged.phases_90d = patch.phases_90d as GtmPlan['phases_90d'];
  }
  if (Array.isArray(patch.phases_6m)) {
    merged.phases_6m = patch.phases_6m as GtmPlan['phases_6m'];
    merged.phases = merged.phases_6m;
  }
  return merged;
}

export async function runGtmStrategyAgent(opts: GtmStrategyAgentOpts): Promise<GtmStrategyAgentResult> {
  return withBrandContext(opts.brandId, () => runGtmStrategyAgentInner(opts));
}

function hasGtmPhases(plan: GtmPlan | null | undefined): boolean {
  if (!plan) return false;
  return (
    (plan.phases_90d?.length ?? 0) > 0 ||
    (plan.phases_6m?.length ?? 0) > 0 ||
    (plan.phases?.length ?? 0) > 0
  );
}

function pickGtmPlan(
  partial: unknown,
  working: GtmPlan | null,
  base: GtmPlan | undefined
): GtmPlan | null {
  if (hasGtmPhases(working)) return working;
  const p = partial && typeof partial === 'object' ? (partial as GtmPlan) : null;
  if (hasGtmPhases(p)) return { ...(working ?? {}), ...p } as GtmPlan;
  if (hasGtmPhases(base)) return base ?? null;
  return working ?? base ?? null;
}

function resolveGtmAgentPlan(
  finished: { plan: GtmPlan; notes: string } | null,
  working: GtmPlan | null,
  draft: GtmPlan | null
): { plan: GtmPlan; notes: string } | null {
  if (finished) return finished;
  if (hasGtmPhases(working)) return { plan: working!, notes: 'Agent ended without finish; using last working plan.' };
  if (hasGtmPhases(draft)) return { plan: draft!, notes: 'Agent ended without finish; using last draft.' };
  return null;
}

async function runGtmStrategyAgentInner(opts: GtmStrategyAgentOpts): Promise<GtmStrategyAgentResult> {
  const ai = genaiClient();
  const google = createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY });
  const feasibilityCtx = { selectedPlatforms: opts.platforms };
  const usdBudget = await fetchUsdBudget(opts.brandId);
  const budget = createStrategyBudget({
    searches: MAX_STRATEGY_SEARCHES,
    drafts: MAX_GTM_AGENT_DRAFTS,
    repairs: MAX_STRATEGY_REPAIRS,
    usdRemaining: usdBudget
  });

  const citations: Citation[] = [];
  let workingPlan: GtmPlan | null = null;
  let lastDraftPlan: GtmPlan | null = null;
  // Must be a CLOSURE over workingPlan, not a module-scope function: as a module function the
  // assignment had no binding in scope and threw ReferenceError under ES module strict mode, so
  // workingPlan stayed null, lastDraftPlan with it, and every run ended "without a plan".
  const rememberGtmPlan = (plan: GtmPlan): void => {
    if (!hasGtmPhases(plan)) return;
    workingPlan = plan;
  };
  let finished: { plan: GtmPlan; notes: string } | null = null;
  const stallFingerprints: string[] = [];
  const stepLog: AgentStepLog[] = [];
  let stepNum = 0;
  let loopOk = true;
  let loopError: string | undefined;
  let lastViolations: string[] = [];

  const basePlan = opts.currentPlan;
  const funnel = basePlan?.funnel ?? null;

  const system = `You are a GTM strategy agent. ${opts.mode === 'propose' ? 'Create a dual-horizon (90d + 6m) go-to-market roadmap.' : 'Revise the GTM roadmap from client feedback.'}

Workflow:
1. read_* tools are FREE — start with read_brand_studio, read_strategy_report, read_leads, read_gtm, read_editorial_plan, read_rubrics, read_post_history as needed.
2. search_web costs money (max ${MAX_STRATEGY_SEARCHES}/run) — only when DB data is insufficient.
3. draft_gtm_variants (max ${MAX_GTM_AGENT_DRAFTS}/run) generates a dual-horizon GTM from your brief.
4. check_gtm_feasibility before finish — repair_gtm or draft again if violations remain.
5. finish with the final plan.

Platforms: ${opts.platforms.join(', ')}. Numeric funnel goals are stamped in code after selection — focus on phase arc, weights, pillars, qualitative targets.`;

  const userPrompt =
    opts.mode === 'propose'
      ? `Design a brand-new GTM roadmap.\n\nSEED CONTEXT:\n${opts.seedBrief}`
      : `Revise the GTM roadmap.\n\nFEEDBACK:\n${opts.seedBrief}\n\nCURRENT PLAN:\n${gtmForPrompt(basePlan!)}`;

  const planOpts = opts.planOpts;

  const tools = {
    read_brand_studio: tool({
      description: 'Brand kit, voice, products, people (free).',
      inputSchema: z.object({}),
      execute: async () => readBrandStudioForAgent(opts.supabase, opts.brandId)
    }),
    read_rubrics: tool({
      description: 'Approved recurring content series (free).',
      inputSchema: z.object({ which: z.enum(['approved', 'proposed', 'both']).optional() }),
      execute: async ({ which }) => readRubricsForAgent(opts.supabase, opts.brandId, which ?? 'approved')
    }),
    read_gtm: tool({
      description: 'Active/proposed GTM plans (free).',
      inputSchema: z.object({ which: z.enum(['active', 'proposed', 'both']).optional() }),
      execute: async ({ which }) =>
        readGtmForAgent(opts.supabase, opts.brandId, opts.timezone ?? 'Europe/Rome', which ?? 'both')
    }),
    read_editorial_plan: tool({
      description: 'Editorial plan if any (free).',
      inputSchema: z.object({ which: z.enum(['active', 'proposed', 'both']).optional() }),
      execute: async ({ which }) => readEditorialPlanForAgent(opts.supabase, opts.brandId, which ?? 'both')
    }),
    read_strategy_report: tool({
      description: 'Strategy research report (free).',
      inputSchema: z.object({}),
      execute: async () => readStrategyReportForAgent(opts.supabase, opts.brandId)
    }),
    read_leads: tool({
      description: 'Online conversations about the product (free).',
      inputSchema: z.object({
        status: z.enum(['suggested', 'done', 'dismissed', 'all']).optional(),
        limit: z.number().int().min(1).max(40).optional()
      }),
      execute: async (input) => readLeadsForAgent(opts.supabase, opts.brandId, input)
    }),
    read_knowledge: tool({
      description: 'Brand documents (free).',
      inputSchema: z.object({ kind: z.enum(['note', 'document', 'image']).optional(), limit: z.number().optional() }),
      execute: async (input) => readKnowledgeForAgent(opts.supabase, opts.brandId, input)
    }),
    read_media: tool({
      description: 'Media library (free).',
      inputSchema: z.object({ query: z.string().optional(), limit: z.number().optional() }),
      execute: async (input) => readMediaForAgent(opts.supabase, opts.brandId, input)
    }),
    read_post_history: tool({
      description: 'Post performance digest (free).',
      inputSchema: z.object({}),
      execute: async () => {
        // analyzePostHistory is SYNC and takes the rows — passing (supabase, brandId) silently
        // produced an empty digest (Array.isArray(client) === false), so the agent always believed
        // the brand had no history. Same shape as strategy-agent's read_post_history.
        const { data: history } = await opts.supabase
          .from('social_post_history')
          .select('content, platform, metrics, published_at, media_type')
          .eq('brand_id', opts.brandId)
          .limit(100);
        const insights = analyzePostHistory(
          (history ?? []).map((h) => ({
            content: h.content,
            mediaType: h.media_type,
            publishedAt: h.published_at,
            metrics: h.metrics as AnyRec
          }))
        );
        return { digest: historyInsightsDigest(insights) };
      }
    }),
    read_competitors: tool({
      description: 'Competitor benchmark digest (free).',
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await opts.supabase
          .from('brand_strategy')
          .select('benchmark')
          .eq('brand_id', opts.brandId)
          .maybeSingle();
        const benchmark = (data?.benchmark as Benchmark | null) ?? null;
        return { digest: benchmark ? benchmarkDigest(benchmark) : 'No benchmark stored.' };
      }
    }),

    check_gtm_feasibility: tool({
      description: 'Deterministic GTM feasibility (free).',
      inputSchema: z.object({ plan: z.record(z.string(), z.unknown()).optional() }),
      execute: async ({ plan }) => {
        const merged = {
          ...(workingPlan ?? {}),
          ...(plan && typeof plan === 'object' ? plan : {})
        } as GtmPlan;
        const normalized = finalizeGtmPlan(merged, funnel);
        const violations = checkGtmFeasibility(normalized, feasibilityCtx);
        if (hasGtmPhases(normalized)) rememberGtmPlan(normalized);
        lastViolations = violations;
        return { ok: violations.length === 0, violations };
      }
    }),

    search_web: tool({
      description: `Paid web search (max ${MAX_STRATEGY_SEARCHES}/run).`,
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const gate = consumeSearchBudget(budget);
        if (!gate.ok) return { error: gate.error };
        // Full chain, Google grounding FIRST, with DeepSeek/Exa/Tavily as fallbacks.
        const { text, citations: cits } = await groundedText(genaiClient(), query, undefined, { brandId: opts.brandId });
        citations.push(...cits);
        budget.usdSpent += ESTIMATED_SEARCH_USD;
        budget.usdRemaining = Math.max(0, budget.usdRemaining - ESTIMATED_SEARCH_USD);
        return { text, citations: cits };
      }
    }),

    draft_gtm_variants: tool({
      description: `Generate dual-horizon GTM from your brief (max ${MAX_GTM_AGENT_DRAFTS}/run).`,
      inputSchema: z.object({ brief: z.string() }),
      execute: async ({ brief }) => {
        const gate = consumeDraftBudget(budget);
        if (!gate.ok) return { error: gate.error };
        if (budget.usdRemaining < ESTIMATED_GTM_DRAFT_USD) return { error: 'USD budget too low for draft_gtm_variants' };
        const raw =
          opts.mode === 'revise' && basePlan
            ? await draftGtmRedirectWithBrief(
                ai,
                basePlan,
                opts.seedBrief,
                opts.phaseIndex ?? null,
                opts.profile,
                planOpts,
                brief
              )
            : await draftGtmDualWithBrief(ai, opts.profile, planOpts, brief);
        workingPlan = finalizeGtmPlan(raw, funnel);
        if (!hasGtmPhases(workingPlan)) {
          return { error: 'draft_gtm_variants produced a plan with no phases' };
        }
        lastDraftPlan = workingPlan;
        budget.usdSpent += ESTIMATED_GTM_DRAFT_USD;
        budget.usdRemaining = Math.max(0, budget.usdRemaining - ESTIMATED_GTM_DRAFT_USD);
        return {
          ok: true,
          objective: workingPlan.objective,
          phases_90d: workingPlan.phases_90d?.map((p) => p.name),
          phases_6m: workingPlan.phases_6m?.map((p) => p.name)
        };
      }
    }),

    repair_gtm: tool({
      description: `Patch GTM to fix violations (max ${MAX_STRATEGY_REPAIRS}/run).`,
      inputSchema: z.object({ patch: z.record(z.string(), z.unknown()), reason: z.string() }),
      execute: async ({ patch, reason }) => {
        const gate = consumeRepairBudget(budget);
        if (!gate.ok) return { error: gate.error };
        const base = workingPlan ?? basePlan;
        if (!base) return { error: 'No working plan to repair' };
        workingPlan = finalizeGtmPlan(applyGtmPatch(base, patch), funnel);
        if (hasGtmPhases(workingPlan)) lastDraftPlan = workingPlan;
        const violations = checkGtmFeasibility(workingPlan, feasibilityCtx);
        lastViolations = violations;
        return { ok: violations.length === 0, reason, violations };
      }
    }),

    finish: tool({
      description: 'Complete with final GTM plan.',
      inputSchema: z.object({
        plan: z.record(z.string(), z.unknown()).optional(),
        notes: z.string(),
        citations: z.array(z.object({ uri: z.string(), title: z.string() })).optional()
      }),
      execute: async ({ plan, notes, citations: extra }) => {
        const raw = pickGtmPlan(plan, workingPlan, basePlan);
        if (!raw) return { error: 'No plan to finish' };
        const normalized = finalizeGtmPlan(raw, funnel);
        const violations = checkGtmFeasibility(normalized, feasibilityCtx);
        if (violations.length) {
          if (hasGtmPhases(normalized)) rememberGtmPlan(normalized);
          lastViolations = violations;
          return { error: 'Plan still has feasibility violations', violations };
        }
        if (extra?.length) citations.push(...extra);
        finished = { plan: normalized, notes: notes.trim() };
        return { ok: true };
      }
    })
  };

  const stallStop: StopCondition<typeof tools> = () => stallDetected(stallFingerprints, 5);
  const loopT0 = Date.now();
  const deadlineMs = opts.deadlineMs ?? 240_000;

  // Reassigned by withAgentFallback when the primary dies before any tool ran — the finally
  // below must bill the model that actually served the loop.
  let loopModel = agentModel();

  try {
    await withAgentFallback('gtm-strategy-agent', (chosen, markDirty) => {
      loopModel = chosen;
      return harnessGenerateText({
        brandId: opts.brandId,
        userId: opts.userId,
        agent: 'gtm',
        mode: opts.mode,
        model: loopModel.modelId,
        provider: loopModel.provider,
        surface: 'batch'
      }, {
        // Gemini 3.7 Flash by default, DeepSeek as fallback — see agentModel().
        model: loopModel.model,
        maxOutputTokens: maxOutputTokensFor(loopModel.provider),
        system,
        prompt: `${userPrompt}\n\nStart with read_brand_studio and read_strategy_report before any paid search.`,
        tools,
        stopWhen: [
          () => finished !== null,
          stepCountIs(MAX_GTM_AGENT_STEPS),
          stallStop,
          () => deadlineReached(loopT0, deadlineMs)
        ],
        temperature: 0.35,
        prepareStep: () => {
          const remainingSec = Math.max(0, Math.round((deadlineMs - (Date.now() - loopT0)) / 1000));
          const stepSystem = appendBudgetToSystem(system, budget, remainingSec);
          // Out of money or nearly out of time and we already have something to hand back → force
          // the close instead of letting the run die with a draft it never committed.
          if ((budget.usdRemaining <= 0 || remainingSec <= 30) && (workingPlan || lastDraftPlan)) {
            return { toolChoice: { type: 'tool' as const, toolName: 'finish' }, system: stepSystem };
          }
          return { system: stepSystem };
        },
        onStepFinish: ({ usage, toolCalls, toolResults, text }) => {
          addStrategyStepCost(budget, usage, loopModel);
          stallFingerprints.push(
            stepFingerprint(
              { o: workingPlan?.objective, s: budget.searchesLeft, d: budget.draftsLeft },
              toolCalls?.map((tc) => ({ toolName: tc.toolName, input: 'input' in tc ? tc.input : undefined }))
            )
          );
          stepNum += 1;
          const entry: AgentStepLog = {
            step: stepNum,
            toolCalls: toolCalls?.map((tc) => ({ name: tc.toolName, input: 'input' in tc ? tc.input : undefined })),
            toolResults: toolResults?.map((tr) => ({ name: tr.toolName, output: 'output' in tr ? tr.output : undefined })),
            text: text?.trim() || undefined
          };
          stepLog.push(entry);
          if (opts.verbose) {
            console.log(`\n[gtm-agent] step ${stepNum}`);
            for (const tc of entry.toolCalls ?? []) console.log(`  → ${tc.name}`);
          }
        }
      }, { before: [() => { markDirty(); }] });
    });

    if (!finished && hasGtmPhases(workingPlan ?? lastDraftPlan)) {
      const candidate = hasGtmPhases(workingPlan) ? workingPlan! : lastDraftPlan!;
      const violations = checkGtmFeasibility(candidate, feasibilityCtx);
      lastViolations = violations;
      if (violations.length === 0) {
        finished = { plan: candidate, notes: 'Auto-closed: draft passed feasibility.' };
      }
    }
  } catch (e) {
    loopOk = false;
    loopError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    logAiCall({
      label: 'gtm-strategy-agent',
      provider: loopModel.provider,
      model: loopModel.modelId,
      ms: Date.now() - loopT0,
      ok: loopOk,
      error: loopError,
      inputTokens: budget.tokensIn,
      outputTokens: budget.tokensOut,
      brandId: opts.brandId,
      userId: opts.userId,
      context: 'gtm-strategy-agent'
    });

    const resolved = resolveGtmAgentPlan(finished, workingPlan, lastDraftPlan);

    persistAgentRun({
      brandId: opts.brandId,
      userId: opts.userId,
      agent: 'gtm',
      mode: opts.mode,
      status: finished ? 'finished' : resolved ? 'fallback' : 'failed',
      finishedOk: !!finished || (resolved !== null && hasGtmPhases(resolved.plan)),
      notes: resolved?.notes,
      citations,
      steps: stepLog,
      violations: lastViolations.length ? lastViolations : undefined,
      costUsdEstimate: budget.usdSpent
    });
  }

  const resolved = resolveGtmAgentPlan(finished, workingPlan, lastDraftPlan);
  if (!resolved) {
    throw new Error('GTM agent finished without a plan');
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
