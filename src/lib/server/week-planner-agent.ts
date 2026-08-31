import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import { tool, stepCountIs, type StopCondition } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { logAiCall, withBrandContext } from '$lib/server/ai-log';
import { persistAgentRun } from '$lib/server/agent-runs';
import { loadActivePlan } from '$lib/server/editorial-plan';
import type { WeeklyStrategy, PostSeed } from '$lib/server/content-preview';
import { draftWeekSeeds } from '$lib/server/content-preview';
import {
  checkRubricsAndBatchFeasibility,
  loadBatchFeasibilityContext
} from '$lib/server/rubrics-feasibility';
import {
  addStrategyStepCost,
  createStrategyBudget,
  consumeDraftBudget,
  consumeRepairBudget,
  fetchUsdBudget,
  stallDetected,
  stepFingerprint,
  deadlineReached,
  appendBudgetToSystem,
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
import { analyzePostHistory, historyInsightsDigest } from '$lib/server/post-history-insights';
import { budgetBrief } from '$lib/server/content-cost';
import { disruptiveBriefSection } from '$lib/disruptive';
import { STORY_FAILURE_MODES } from '$lib/server/content-preview/seed-model';
import { createDisruptiveIdeaTools } from '$lib/server/disruptive-ideas';
import { benchmarkDigest, type Benchmark } from '$lib/server/research';
import type { ContentPrefs, PastWinner } from '$lib/server/content-preview';
import type { Rubric } from '$lib/server/rubrics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;
type BrandProfile = AnyRec;

// I tool dell'agente prendevano i seed come `z.record(z.string(), z.unknown())`, cioè senza forma.
// Senza una forma descritta il modello ripiega sulla più semplice, e le battute tornavano stringhe:
// riquadri senza voce, che il gate classificava come guida e lasciava passare senza fonte. Il resto
// del seed resta libero — qui serve descrivere SOLO ciò che si stava perdendo.
const BEAT = z.object({
  shows: z.string().describe("L'azione: cosa succede in questo riquadro."),
  who: z.string().describe('CHI è nell\'inquadratura, dove sta ciascuno e cosa fa la sua faccia. Il generatore disegna solo chi nomini e inventa il resto.'),
  thinks: z.string().describe('La voce di dentro, prima persona, sei parole al massimo. Vuota solo su una guida.'),
  says: z
    .object({ speaker: z.string().describe('Chi parla, come compare in "who": la coda del balloon punta a lui.'), line: z.string() })
    .optional()
    .describe('Il parlato e chi lo dice. Assente quando nessuno apre bocca.')
});
const SEED = z.object({ beats: z.array(BEAT).optional() }).catchall(z.unknown());

export const MAX_WEEK_PLANNER_STEPS = 40;
export const MAX_WEEK_PLANNER_DRAFTS = 4;
export const MAX_WEEK_PLANNER_REPAIRS = 8;
const ESTIMATED_DRAFT_USD = 0.06;
// Il planner ha sempre letto solo dentro il brand, quindi ogni fatto procedurale che entrava in una
// battuta — il nome di un modulo, la dicitura a schermo, cosa serve davvero a uno sportello — era
// inventato, e la regola sulla specificità lo faceva sembrare pure verificabile. Il tetto è piccolo
// di proposito: qui si VERIFICA quello che si sta per affermare, non ci si documenta da zero.
export const MAX_WEEK_PLANNER_RESEARCH = 30;
const ESTIMATED_RESEARCH_USD = 0.008;

export type WeekPlannerAgentOpts = {
  supabase: SupabaseClient;
  userId?: string;
  brandId: string;
  profile: BrandProfile;
  platforms: string[];
  count: number;
  weekIndex?: number;
  prefs?: ContentPrefs;
  maxVideos?: number;
  maxCarousels?: number;
  topPosts?: PastWinner[];
  strategyBrief?: string;
  competitorThumbUrls?: string[];
  marketBrief?: string;
  calendarHooks?: string;
  rubrics?: Rubric[];
  timezone?: string;
  verbose?: boolean;
  // Wall-clock budget — see GtmStrategyAgentOpts.deadlineMs.
  deadlineMs?: number;
};

export type WeekPlannerAgentResult = {
  strategy: WeeklyStrategy;
  notes: string;
  costUsd: number;
};

/** Opt-out: WEEK_PLANNER_AGENT_ENABLED=false falls back to legacy planStrategy. Default ON. */
export function weekPlannerAgentEnabled(): boolean {
  return env.WEEK_PLANNER_AGENT_ENABLED !== 'false';
}

function seedFingerprint(seeds: PostSeed[] | null, budget: StrategyBudget): string {
  return JSON.stringify({
    n: seeds?.length ?? 0,
    r0: seeds?.[0]?.rubric,
    d: budget.draftsLeft
  });
}

/**
 * I seed che il modello RIMANDA, fusi su quelli che ha in mano.
 *
 * I tool dell'agente prendono un oggetto libero e il modello lo riscrive per intero: quello che
 * nessuno gli ha descritto lo lascia indietro. Descritto `beats`, ha restituito seed senza angolo,
 * pillar, giorno e ora — righe di piano vuote. Duplicare qui tutto lo schema del seed sarebbe una
 * seconda definizione che diverge dalla prima al primo campo aggiunto: si fonde invece di
 * sostituire, così ciò che il modello dice vince e ciò che tace resta quello che era.
 */
export function mergeSeeds(drafted: AnyRec[], sent: AnyRec[]): AnyRec[] {
  return sent.map((patch, i) => ({ ...(drafted[i] ?? {}), ...(patch ?? {}) }));
}

function normalizeSeeds(raw: unknown[]): PostSeed[] {
  return (raw ?? []).map((s) => s as PostSeed);
}

export async function runWeekPlannerAgent(opts: WeekPlannerAgentOpts): Promise<WeekPlannerAgentResult> {
  return withBrandContext(opts.brandId, () => runWeekPlannerAgentInner(opts));
}

async function runWeekPlannerAgentInner(opts: WeekPlannerAgentOpts): Promise<WeekPlannerAgentResult> {
  const usdBudget = await fetchUsdBudget(opts.brandId);
  // Il budget del brand in crediti, l'unità del listino. Serve a due cose diverse: il brief con cui
  // l'agente SCEGLIE il mix, e il gate che rifiuta un batch che non si potrebbe produrre.
  const creditBudget = Number.isFinite(usdBudget) ? Math.max(0, Math.round(usdBudget * 100)) : undefined;
  const budget = createStrategyBudget({ drafts: MAX_WEEK_PLANNER_DRAFTS, repairs: MAX_WEEK_PLANNER_REPAIRS, usdRemaining: usdBudget });

  const [editorialPlan, batchCtx] = await Promise.all([
    loadActivePlan(opts.supabase, opts.brandId),
    loadBatchFeasibilityContext(opts.supabase, opts.brandId, {
      expectedSeedCount: opts.count,
      selectedPlatforms: opts.platforms,
      weekIndex: opts.weekIndex,
      rubrics: opts.rubrics
    })
  ]);

  if (opts.weekIndex != null && editorialPlan) {
    batchCtx.weekMix = editorialPlan.weeks?.[opts.weekIndex]?.content_mix ?? batchCtx.weekMix;
  }
  if (!batchCtx.rubrics.length && opts.rubrics?.length) {
    batchCtx.rubrics = opts.rubrics;
  }

  const { loadKnownSubreddits, knownSubredditsBlock } = await import('$lib/server/platform-hygiene');
  const knownSubreddits = opts.platforms.some((p) => String(p).toLowerCase() === 'reddit')
    ? await loadKnownSubreddits(opts.supabase, opts.brandId)
    : [];

  let working: WeeklyStrategy | null = null;
  let finished: { strategy: WeeklyStrategy; notes: string } | null = null;
  const stallFingerprints: string[] = [];
  let researchesUsed = 0;
  // Le pagine che la ricerca ha DAVVERO restituito. Il gate le confronta con la fonte dichiarata:
  // è l'unica cosa che distingue una citazione da una citazione inventata.
  const researchedUrls = new Set<string>();
  const stepLog: import('$lib/server/agent-runs').AgentStepLog[] = [];
  let stepNum = 0;
  const t0 = Date.now();

  const rubricNames =
    batchCtx.rubrics.length > 0
      ? batchCtx.rubrics.map((r) => r.name).join(', ')
      : 'none — free-form pillars allowed';

  const system = `You are a week planner agent. Produce ${opts.count} post SEEDS for one editorial week.

Workflow:
1. read_* tools are FREE — start with read_rubrics, read_leads, read_editorial_plan, read_brand_studio, read_media, read_post_history as needed.
2. draft_seeds (max ${MAX_WEEK_PLANNER_DRAFTS}/run) generates seeds from your brief.
3. check_batch_feasibility before finish — repair_seeds or draft again if violations remain.
4. When approved rubrics exist (${rubricNames}), every seed MUST carry rubric = exact series name and match the week's content_mix counts, and it inherits that series' art_direction verbatim.
5. Every CAROUSEL seed carries "beats": one concrete beat per slide, in order, as many as slide_count — the story, decided here. check_batch_feasibility rejects a carousel without them; repair_seeds writes them.
6. research (max ${MAX_WEEK_PLANNER_RESEARCH}/run, it costs) — NOTHING here reaches the open web except this tool, so any date, form name, legal wording or on-screen message a seed asserts is invented unless you checked it. Check before you assert; if you cannot check it, write the beat without the detail rather than with a plausible one. A wrong specific is worse than a vague one.
7. finish with the final seeds array.

NARRATIVE EPISODES — THE PROTOCOL, NOT OPTIONAL. You do not already understand this brand's subject, and what you assume about it is the most predictable thing you could write. Before ANY beat of a narrative episode:
  a. SEARCH how people describe these situations IN THEIR OWN WORDS — forum threads, first-person posts, comments, interviews. Search for the ACCOUNT, not for an explanation of the topic: "quali problemi ci sono con X" returns a guide and you will end up retelling a guide. Ask the way the person would have written it — "mi è successo che", "sono andato a", "non me l'hanno dato perché" — and read what comes back looking for one incident with a place, a day and a person in it.
  b. CHOOSE ONE concrete situation that actually turned up. Not a composite, not an average of several: one.
  c. GO DEEP ON THAT ONE — what happens, in what order, who says what, which document or screen or desk is involved, and what it costs the person. Keep asking until you could answer a follow-up about it.
  d. Only then write the beats, and put the situation and its source in "sourced_from".
Found nothing usable? Say so in "sourced_from" and keep the episode general. An invented life told confidently is the worst thing this system can publish.

Week index: ${opts.weekIndex != null ? opts.weekIndex + 1 : 'unspecified'}.
Platforms: ${opts.platforms.join(', ')}.

${disruptiveBriefSection()}
${STORY_FAILURE_MODES}
${budgetBrief(creditBudget)}

Una settimana di sette post corretti è una settimana invisibile: fra i seed cercane uno costruito su una leva di contrasto, e se escono tutti prudenti e intercambiabili la settimana non è buona per quanto sia corretta. Chiama read_disruptive_ideas prima di inventarne uno nuovo: se il banco ne ha una che regge su questa settimana, girala e poi chiamaci sopra mark_idea_used, sennò resta "da fare" per sempre. E se pensando questa settimana te ne viene una nuova che passa i tre test, salvala con save_disruptive_idea anche se non entra in questi sette post — non perché ce ne voglia una, ma perché lì sopravvive.`;

  const userPrompt = `Plan ${opts.count} post seeds for this week.

EDITORIAL BRIEF (verify and enrich with read_* tools):
${opts.strategyBrief ?? '(no brief — read editorial plan and GTM)'}
${opts.marketBrief ? `\n${opts.marketBrief}` : ''}
${knownSubreddits.length ? `\n${knownSubredditsBlock(knownSubreddits)}` : ''}`;

  const planPreviewOpts = {
    platforms: opts.platforms,
    prefs: opts.prefs,
    maxVideos: opts.maxVideos,
    maxCarousels: opts.maxCarousels,
    topPosts: opts.topPosts,
    strategyBrief: opts.strategyBrief,
    competitorThumbUrls: opts.competitorThumbUrls,
    marketBrief: opts.marketBrief,
    calendarHooks: opts.calendarHooks,
    rubrics: batchCtx.rubrics,
    supabase: opts.supabase,
    brandId: opts.brandId,
    knownSubreddits
  };

  const tools = {
    // Il banco idee del brand: si legge prima di inventare, ci si salva dentro l'idea laterale.
    ...createDisruptiveIdeaTools({
      supabase: opts.supabase,
      brandId: opts.brandId,
      surface: 'week-planner',
      agent: 'publish'
    }),
    read_brand_studio: tool({
      description: 'Brand kit, voice, products, people (free).',
      inputSchema: z.object({}),
      execute: async () => readBrandStudioForAgent(opts.supabase, opts.brandId)
    }),
    read_rubrics: tool({
      description: 'Approved recurring content series — authoritative for seed rubric fields (free).',
      inputSchema: z.object({ which: z.enum(['approved', 'proposed', 'both']).optional() }),
      execute: async ({ which }) => readRubricsForAgent(opts.supabase, opts.brandId, which ?? 'approved')
    }),
    read_gtm: tool({
      description: 'Active GTM plan and current phase (free).',
      inputSchema: z.object({ which: z.enum(['active', 'proposed', 'both']).optional() }),
      execute: async ({ which }) =>
        readGtmForAgent(opts.supabase, opts.brandId, opts.timezone ?? 'Europe/Rome', which ?? 'active')
    }),
    read_editorial_plan: tool({
      description: 'Active/proposed editorial plan with weekly content_mix (free).',
      inputSchema: z.object({ which: z.enum(['active', 'proposed', 'both']).optional() }),
      execute: async ({ which }) => readEditorialPlanForAgent(opts.supabase, opts.brandId, which ?? 'active')
    }),
    read_knowledge: tool({
      description: 'Brand documents and notes (free).',
      inputSchema: z.object({
        kind: z.enum(['note', 'document', 'image']).optional(),
        limit: z.number().int().min(1).max(40).optional()
      }),
      execute: async (input) => readKnowledgeForAgent(opts.supabase, opts.brandId, input)
    }),
    read_media: tool({
      description: 'Brand media library for media_id assignment (free).',
      inputSchema: z.object({
        query: z.string().optional(),
        kind: z.enum(['image', 'video']).optional(),
        limit: z.number().int().min(1).max(40).optional()
      }),
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
        const { data: strategy } = await opts.supabase
          .from('brand_strategy')
          .select('benchmark')
          .eq('brand_id', opts.brandId)
          .maybeSingle();
        const benchmark = (strategy?.benchmark as Benchmark | null) ?? null;
        return { digest: benchmark ? benchmarkDigest(benchmark) : 'No benchmark stored.' };
      }
    }),
    read_strategy_report: tool({
      description: 'Strategy research report summary (free).',
      inputSchema: z.object({}),
      execute: async () => readStrategyReportForAgent(opts.supabase, opts.brandId)
    }),

    research: tool({
      description:
        `Search and read the open web (max ${MAX_WEEK_PLANNER_RESEARCH}/run, costs money). TWO uses: (1) find how people describe a situation in their OWN words, then go deeper on the single situation you pick; (2) verify a specific a seed is about to assert — the real name of a form, the wording that actually appears on a screen, what a procedure actually requires, a date. Returns an answer with its sources.`,
      inputSchema: z.object({
        question: z.string().describe('One precise question, in the brand\'s language. Not a topic — a question with a checkable answer.')
      }),
      execute: async ({ question }) => {
        if (researchesUsed >= MAX_WEEK_PLANNER_RESEARCH) {
          return { error: `Research budget spent (${MAX_WEEK_PLANNER_RESEARCH}/run). Write only what the brand's material or an answer you already got supports.` };
        }
        if (budget.usdRemaining < ESTIMATED_RESEARCH_USD) return { error: 'USD budget too low for research' };
        researchesUsed += 1;
        budget.usdSpent += ESTIMATED_RESEARCH_USD;
        budget.usdRemaining = Math.max(0, budget.usdRemaining - ESTIMATED_RESEARCH_USD);
        const { groundedText } = await import('$lib/server/research');
        const { text, citations } = await groundedText(null as never, question, undefined, { brandId: opts.brandId });
        for (const c of citations) {
          if (c.uri) researchedUrls.add(c.uri);
        }
        return { answer: text, sources: citations.map((c) => ({ title: c.title, url: c.uri })) };
      }
    }),

    read_leads: tool({
      description:
        'Online conversations with drafted replies — what the audience discusses about the product (free).',
      inputSchema: z.object({
        status: z.enum(['suggested', 'done', 'dismissed', 'all']).optional(),
        limit: z.number().int().min(1).max(50).optional()
      }),
      execute: async ({ status, limit }) => readLeadsForAgent(opts.supabase, opts.brandId, { status, limit })
    }),

    check_batch_feasibility: tool({
      description: 'Deterministic check: seed count, platforms, assets, rubrics vs week mix (free).',
      inputSchema: z.object({ seeds: z.array(SEED) }),
      execute: async ({ seeds }) => {
        const normalized = normalizeSeeds(mergeSeeds(working?.seeds ?? [], seeds));
        const violations = checkRubricsAndBatchFeasibility(normalized, { ...batchCtx, researchedUrls, creditBudget });
        if (normalized.length) {
          working = {
            theme: working?.theme ?? '',
            rationale: working?.rationale ?? '',
            doDont: working?.doDont ?? '',
            seeds: normalized
          };
        }
        lastViolations = violations;
        return { ok: violations.length === 0, violations };
      }
    }),

    draft_seeds: tool({
      description: `Generate post seeds from your brief (max ${MAX_WEEK_PLANNER_DRAFTS}/run).`,
      inputSchema: z.object({ brief: z.string() }),
      execute: async ({ brief }) => {
        const gate = consumeDraftBudget(budget);
        if (!gate.ok) return { error: gate.error };
        if (budget.usdRemaining < ESTIMATED_DRAFT_USD) return { error: 'USD budget too low for draft_seeds' };
        const strategy = await draftWeekSeeds(opts.profile, planPreviewOpts, opts.count, brief);
        working = strategy;
        budget.usdSpent += ESTIMATED_DRAFT_USD;
        budget.usdRemaining = Math.max(0, budget.usdRemaining - ESTIMATED_DRAFT_USD);
        return {
          ok: true,
          theme: strategy.theme,
          seed_count: strategy.seeds.length,
          rubrics_used: strategy.seeds.map((s) => s.rubric).filter(Boolean)
        };
      }
    }),

    repair_seeds: tool({
      description: `Patch seeds to fix feasibility violations (max ${MAX_WEEK_PLANNER_REPAIRS}/run).`,
      inputSchema: z.object({
        seeds: z.array(SEED),
        reason: z.string()
      }),
      execute: async ({ seeds, reason }) => {
        const gate = consumeRepairBudget(budget);
        if (!gate.ok) return { error: gate.error };
        const normalized = normalizeSeeds(mergeSeeds(working?.seeds ?? [], seeds));
        working = {
          theme: working?.theme ?? '',
          rationale: working?.rationale ?? '',
          doDont: working?.doDont ?? '',
          seeds: normalized
        };
        const violations = checkRubricsAndBatchFeasibility(normalized, { ...batchCtx, researchedUrls, creditBudget });
        lastViolations = violations;
        return { ok: violations.length === 0, reason, violations };
      }
    }),

    finish: tool({
      description: 'Complete with final weekly strategy.',
      inputSchema: z.object({
        theme: z.string().optional(),
        rationale: z.string().optional(),
        do_dont: z.string().optional(),
        seeds: z.array(SEED).optional(),
        notes: z.string()
      }),
      execute: async ({ theme, rationale, do_dont, seeds, notes }) => {
        const finalSeeds = normalizeSeeds(
          seeds?.length ? mergeSeeds(working?.seeds ?? [], seeds) : (working?.seeds ?? [])
        );
        const strategy: WeeklyStrategy = {
          theme: theme ?? working?.theme ?? '',
          rationale: rationale ?? working?.rationale ?? '',
          doDont: do_dont ?? working?.doDont ?? '',
          seeds: finalSeeds
        };
        if (!finalSeeds.length) return { error: 'No seeds to finish' };
        const violations = checkRubricsAndBatchFeasibility(finalSeeds, { ...batchCtx, researchedUrls, creditBudget });
        if (violations.length) {
          if (finalSeeds.length) working = strategy;
          lastViolations = violations;
          return { error: 'Seeds still have feasibility violations', violations };
        }
        finished = { strategy, notes: notes.trim() };
        return { ok: true };
      }
    })
  };

  const stallStop: StopCondition<typeof tools> = () => stallDetected(stallFingerprints, 4);
  const loopT0 = Date.now();
  const deadlineMs = opts.deadlineMs ?? 200_000;
  let loopOk = true;
  let loopError: string | undefined;
  let lastViolations: string[] = [];

  // Reassigned by withAgentFallback when the primary dies before any tool ran — the finally
  // below must bill the model that actually served the loop, not the one we started with.
  let loopModel = agentModel();

  try {
    await withAgentFallback('week-planner-agent', (chosen, markDirty) => {
      loopModel = chosen;
      return harnessGenerateText({
        brandId: opts.brandId,
        userId: opts.userId,
        agent: 'week_planner',
        mode: String(opts.weekIndex ?? 0),
        model: loopModel.modelId,
        provider: loopModel.provider,
        surface: 'batch'
      }, {
        // Gemini 3.7 Flash by default, DeepSeek as fallback — see agentModel().
        model: loopModel.model,
        maxOutputTokens: maxOutputTokensFor(loopModel.provider),
        system,
        prompt: `${userPrompt}\n\nStart with read_rubrics and read_editorial_plan before drafting.`,
        tools,
        stopWhen: [
          () => finished !== null,
          stepCountIs(MAX_WEEK_PLANNER_STEPS),
          stallStop,
          () => deadlineReached(loopT0, deadlineMs)
        ],
        temperature: 0.35,
        prepareStep: () => {
          const remainingSec = Math.max(0, Math.round((deadlineMs - (Date.now() - loopT0)) / 1000));
          const stepSystem = appendBudgetToSystem(system, budget, remainingSec);
          if ((budget.usdRemaining <= 0 || remainingSec <= 30) && working) {
            return { toolChoice: { type: 'tool' as const, toolName: 'finish' }, system: stepSystem };
          }
          return { system: stepSystem };
        },
        onStepFinish: ({ usage, toolCalls, toolResults, text }) => {
          addStrategyStepCost(budget, usage, loopModel);
          stallFingerprints.push(
            stepFingerprint(
              seedFingerprint(working?.seeds ?? null, budget),
              toolCalls?.map((tc) => ({ toolName: tc.toolName, input: 'input' in tc ? tc.input : undefined }))
            )
          );
          stepNum += 1;
          stepLog.push({
            step: stepNum,
            toolCalls: toolCalls?.map((tc) => ({ name: tc.toolName, input: 'input' in tc ? tc.input : undefined })),
            toolResults: toolResults?.map((tr) => ({ name: tr.toolName, output: 'output' in tr ? tr.output : undefined })),
            text: text?.trim() || undefined
          });
          if (opts.verbose) {
            console.log('\n[week-planner-agent] step');
            for (const tc of toolCalls ?? []) {
              console.log(`  → ${tc.toolName}`, JSON.stringify('input' in tc ? tc.input : {}, null, 2).slice(0, 1200));
            }
            for (const tr of toolResults ?? []) {
              console.log(`  ← ${tr.toolName}`, JSON.stringify('output' in tr ? tr.output : {}, null, 2).slice(0, 2000));
            }
            if (text?.trim()) console.log(`  · ${text.trim().slice(0, 300)}`);
          }
        }
      }, { before: [() => { markDirty(); }] });
    });

    if (!finished && working?.seeds?.length) {
      const violations = checkRubricsAndBatchFeasibility(working.seeds, { ...batchCtx, researchedUrls, creditBudget });
      lastViolations = violations;
      if (violations.length === 0) {
        finished = { strategy: working, notes: 'Auto-closed: seeds passed feasibility.' };
      }
    }
  } catch (e) {
    loopOk = false;
    loopError = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    logAiCall({
      label: 'week-planner-agent',
      provider: loopModel.provider,
      model: loopModel.modelId,
      ms: Date.now() - loopT0,
      ok: loopOk,
      error: loopError,
      inputTokens: budget.tokensIn,
      outputTokens: budget.tokensOut,
      brandId: opts.brandId,
      userId: opts.userId,
      context: 'week-planner-agent'
    });

    const resolvedPreview =
      finished ??
      (working?.seeds?.length
        ? { strategy: working, notes: 'Agent ended without finish; using last draft.' }
        : null);
    persistAgentRun({
      brandId: opts.brandId,
      userId: opts.userId,
      agent: 'week_planner',
      mode: `week_${opts.weekIndex ?? 'unknown'}`,
      status: finished ? 'finished' : resolvedPreview ? 'fallback' : 'failed',
      finishedOk: !!finished,
      notes: resolvedPreview?.notes,
      steps: stepLog.length ? stepLog : undefined,
      violations: lastViolations.length ? lastViolations : undefined,
      costUsdEstimate: budget.usdSpent
    });
  }

  const resolved =
    finished ??
    (working?.seeds?.length
      ? { strategy: working, notes: 'Agent ended without finish; using last draft.' }
      : null);
  if (!resolved) {
    throw new Error('Week planner agent finished without seeds');
  }

  return {
    strategy: resolved.strategy,
    notes: resolved.notes,
    costUsd: budget.usdSpent
  };
}
