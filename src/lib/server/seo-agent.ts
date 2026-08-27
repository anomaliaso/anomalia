import { swallow } from '$lib/server/swallow';
import { maxOutputTokensFor } from '$lib/server/ai-output-limits';
import { tool, stepCountIs, hasToolCall, type StopCondition } from 'ai';
import { harnessGenerateText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { logAiCall, withBrandContext } from '$lib/server/ai-log';
import { persistAgentRun } from '$lib/server/agent-runs';
import {
  agentModel,
  withAgentFallback,
  appendBudgetToSystem,
  createStrategyBudget,
  addStrategyStepCost,
  stallDetected,
  stepFingerprint,
  deadlineReached,
  fetchUsdBudget,
  type StrategyBudget
} from '$lib/server/strategy-agent';
import { createDataForSeoTools } from '$lib/server/dataforseo-tools';
import { buildSeoMetrics } from '$lib/server/seo-metrics';
import type { SeoEvaluation, SeoInitiative, SeoInitiativeType, SeoPlan } from '$lib/server/seo-advisor';

// ── SEO review agent ──────────────────────────────────────────────────────────
// Multi-step tool loop (same shape as strategy / week-planner agents). Reviews the latest
// audit + live DataForSEO metrics, then finishes with a grounded SEO plan. Replaces the
// one-shot bestVariant path in generateSeoPlan when enabled.

export const MAX_SEO_AGENT_STEPS = 28;
export const MAX_SEO_DFS_CALLS = 14;
const STALL_STEP_THRESHOLD = 5;
const ESTIMATED_STEP_USD = 0.02;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type SeoAgentMode = 'plan' | 'review' | 'more';

export type SeoAgentOpts = {
  supabase: SupabaseClient;
  brand: AnyRec;
  mode?: SeoAgentMode;
  /** Steering hint when mode === 'more'. */
  guidance?: string;
  /** How many new initiatives when mode === 'more'. */
  count?: number;
  deadlineMs?: number;
  verbose?: boolean;
};

export type SeoAgentResult = SeoPlan & { notes: string; costUsd: number };

/** Opt-out: SEO_AGENT_ENABLED=false falls back to the legacy one-shot plan generator. */
export function seoAgentEnabled(): boolean {
  return env.SEO_AGENT_ENABLED !== 'false';
}

const INITIATIVE_TYPES = [
  'blog',
  'landing_page',
  'free_tool',
  'comparison',
  'glossary',
  'programmatic'
] as const satisfies readonly SeoInitiativeType[];

function auditDigest(audit: AnyRec | null): string {
  if (!audit) return '(no site audit yet — call read_latest_audit after suggesting a fresh run, or proceed with DataForSEO only)';
  const t = (audit.tech ?? {}) as AnyRec;
  const c = (t.content ?? {}) as AnyRec;
  const issues = Array.isArray(t.issues) ? t.issues.map((i: AnyRec) => i.title).slice(0, 8).join('; ') : '';
  const gaps = Array.isArray(audit.citations)
    ? audit.citations.filter((x: AnyRec) => !x.brandMentioned).map((x: AnyRec) => x.prompt).slice(0, 5)
    : [];
  return [
    `Technical score: ${audit.tech_score ?? 'n/a'}/100. Issues: ${issues || 'none'}.`,
    c.wordCount != null ? `Homepage words: ${c.wordCount}, H1s: ${c.h1Count ?? '?'}, text ratio: ${c.textRatio ?? '?'}%.` : '',
    `AI share-of-voice: ${audit.share_of_voice ?? 0}%.`,
    gaps.length ? `AI citation gaps: ${gaps.join(' | ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeInitiatives(raw: unknown[]): SeoInitiative[] {
  const out: SeoInitiative[] = [];
  for (const item of raw ?? []) {
    const i = item as AnyRec;
    if (!(INITIATIVE_TYPES as readonly string[]).includes(i.type) || !i.title || !i.targetQuery) continue;
    out.push({
      id: randomUUID(),
      type: i.type as SeoInitiativeType,
      title: String(i.title).slice(0, 200),
      targetQuery: String(i.targetQuery).slice(0, 200),
      rationale: String(i.rationale ?? '').slice(0, 800),
      effort: (['low', 'medium', 'high'].includes(i.effort) ? i.effort : 'medium') as SeoInitiative['effort'],
      impact: (['low', 'medium', 'high'].includes(i.impact) ? i.impact : 'medium') as SeoInitiative['impact'],
      examples: Array.isArray(i.examples) ? i.examples.map(String).slice(0, 3) : []
    });
  }
  return out;
}

async function loadProfile(admin: SupabaseClient, brand: AnyRec) {
  const [{ data: kit }, { data: products }, { data: competitors }] = await Promise.all([
    admin.from('brand_kit').select('source_url, about, category, target_audience, ai_context').eq('brand_id', brand.id).maybeSingle(),
    admin.from('products').select('title').eq('brand_id', brand.id).limit(12),
    admin.from('competitors').select('name, website').eq('brand_id', brand.id).limit(8)
  ]);
  return {
    profile: {
      name: brand.name,
      about: kit?.about ?? '',
      category: kit?.category ?? '',
      target_audience: kit?.target_audience ?? '',
      ai_context: kit?.ai_context ?? '',
      products: (products ?? []).map((p) => p.title).filter(Boolean),
      competitors: (competitors ?? []).map((c) => ({ name: c.name, website: c.website })).filter((c) => c.name)
    },
    siteUrl: String(kit?.source_url || brand.website || '').trim(),
    language: (brand.content_prefs?.language as string) || 'Italian'
  };
}

export async function runSeoAgent(opts: SeoAgentOpts): Promise<SeoAgentResult | null> {
  return withBrandContext(String(opts.brand.id), () => runSeoAgentInner(opts));
}

async function runSeoAgentInner(opts: SeoAgentOpts): Promise<SeoAgentResult | null> {
  const mode: SeoAgentMode = opts.mode ?? 'plan';
  const admin = opts.supabase;
  const { profile, siteUrl, language } = await loadProfile(admin, opts.brand);
  const deadlineMs = opts.deadlineMs ?? 160_000;
  const t0 = Date.now();

  const [{ data: auditRows }, { data: existingPlan }] = await Promise.all([
    admin
      .from('brand_geo_audits')
      .select('tech_score, tech, share_of_voice, citations, search, backlinks, created_at')
      .eq('brand_id', opts.brand.id)
      .order('created_at', { ascending: false })
      .limit(8),
    admin
      .from('brand_seo_plans')
      .select('id, grade, evaluation, initiatives, created_at')
      .eq('brand_id', opts.brand.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const latestAudit = (auditRows ?? []).find((r) => r.tech != null) ?? auditRows?.[0] ?? null;
  const metrics = buildSeoMetrics(auditRows ?? []);
  const existingInits = (existingPlan?.initiatives as SeoInitiative[]) ?? [];

  const usdBudget = Math.min(await fetchUsdBudget(String(opts.brand.id)), 3);
  const budget: StrategyBudget = createStrategyBudget({
    searches: MAX_SEO_DFS_CALLS,
    drafts: 2,
    repairs: 2,
    usdRemaining: usdBudget
  });
  const usdStart = budget.usdRemaining;

  // Boxed so assignments inside tool execute() aren't erased by TS control-flow narrowing.
  const state: {
    finished: SeoAgentResult | null;
    gscRead: boolean;
    gscReady: boolean;
    ownedQueries: string[];
  } = { finished: null, gscRead: false, gscReady: false, ownedQueries: [] };
  const stallFingerprints: string[] = [];
  let stepNum = 0;

  const dfsTools = createDataForSeoTools({
    defaultUrl: siteUrl,
    language,
    maxCalls: MAX_SEO_DFS_CALLS,
    allowHistory: true
  });

  let gscBlock = '';
  try {
    const { isGscInAgentEnabled } = await import('$lib/server/feature-flags');
    if (isGscInAgentEnabled()) {
      const { loadGscReady, formatGscPromptBlock } = await import('$lib/server/gsc');
      const { ready, summary } = await loadGscReady(admin, String(opts.brand.id));
      state.gscReady = ready && summary.configured && summary.connected;
      state.ownedQueries = summary.topQueries.map((q) => q.query);
      gscBlock = formatGscPromptBlock(summary);
      if (state.gscReady) {
        if (!gscBlock) {
          gscBlock = `OWNED SEARCH: property ${summary.siteUrl ?? 'n/a'} synced ${summary.syncedAt ?? 'n/a'} (${summary.clicks28d} clicks / ${summary.impressions28d} impressions).`;
        }
        gscBlock += `\nGSC_STATUS: ready — you MUST call read_gsc_summary before finish. At least ~40% of initiative targetQuery values should come from owned queries (or explicitly justify gaps in notes).`;
      } else if (summary.configured && !summary.connected) {
        gscBlock =
          'GSC_STATUS: configured but not connected — proceed with DataForSEO/estimates; do not invent GSC numbers.';
      } else if (summary.configured && summary.connected && !ready) {
        gscBlock = `GSC_STATUS: connected but not ready (stale sync or empty metrics). Property: ${summary.siteUrl ?? 'n/a'}. Prefer DataForSEO; call read_gsc_summary if useful.`;
      }
    }
  } catch (error) { swallow('load gsc summary', error); }

  const baseSystem = `You are Anomalia's SEO review agent — a multi-step specialist that researches with DataForSEO tools, then finishes with a concrete growth plan.

Brand: ${profile.name}
About: ${String(profile.about).slice(0, 400)}
Category: ${profile.category}. Audience: ${profile.target_audience}
Products: ${(profile.products as string[]).join(', ') || 'n/a'}
Site: ${siteUrl || 'n/a'}
Competitors on file: ${(profile.competitors as Array<{ name: string; website?: string }>)
    .map((c) => `${c.name}${c.website ? ` (${c.website})` : ''}`)
    .join('; ') || 'n/a'}
Language for ALL prose: ${language}

Latest stored audit snapshot:
${auditDigest(latestAudit)}

Cached SEO metrics (from audits / nested history — verify with tools when stale or missing):
- Domain rating: ${metrics.domainRating ?? 'n/a'}
- Est. monthly traffic: ${metrics.traffic ?? 'n/a'}
- Organic keywords: ${metrics.organicKeywords ?? 'n/a'}
- New keywords (latest month): ${metrics.keywordsNew ?? 'n/a'}
- Referring domains: ${metrics.referringDomains ?? 'n/a'}
${gscBlock ? `\n${gscBlock}\n` : ''}
MODE: ${mode}
${mode === 'more' ? `User direction: ${opts.guidance || '(none)'}\nAlready proposed (do NOT repeat):\n${existingInits.map((i) => `- [${i.type}] ${i.title} → ${i.targetQuery}`).join('\n') || '(none)'}` : ''}
${mode === 'review' ? 'This is a periodic review. Update the evaluation from fresh DataForSEO evidence and replace initiatives with a sharper, current set.' : ''}

Workflow:
1. read_latest_audit + read_seo_metrics (free, local).
2. If GSC_STATUS is ready: call read_gsc_summary (free) before finish and prefer owned queries for targetQuery.
3. Use DataForSEO tools (dfs_*) to ground real volumes, SERPs, gaps, and backlink authority. Prefer the brand site; check 1–2 competitors when useful.
4. Optionally dfs_traffic_history / dfs_backlink_history once if trends matter.
5. Call finish with evaluation + initiatives grounded in the numbers you actually fetched. Never invent volumes or competitor ranks.

Initiative types: ${INITIATIVE_TYPES.join(', ')}.
${mode === 'more' ? `Propose ${opts.count ?? 4} NEW initiatives only.` : 'Propose 5–8 initiatives, highest impact/effort first.'}`;

  const tools = {
    ...dfsTools,

    read_latest_audit: tool({
      description: 'Read the latest stored SEO/GEO audit (tech score, issues, content, AI citation gaps). Free — no DataForSEO cost.',
      inputSchema: z.object({}),
      execute: async () => ({
        audited_at: latestAudit?.created_at ?? null,
        digest: auditDigest(latestAudit),
        tech_score: latestAudit?.tech_score ?? null,
        share_of_voice: latestAudit?.share_of_voice ?? null
      })
    }),

    read_seo_metrics: tool({
      description: 'Read derived SEO metrics + trend points from stored audits (domain rating, traffic, new keywords, backlinks). Free.',
      inputSchema: z.object({}),
      execute: async () => ({
        domainRating: metrics.domainRating,
        traffic: metrics.traffic,
        organicKeywords: metrics.organicKeywords,
        keywordsTop10: metrics.keywordsTop10,
        keywordsNew: metrics.keywordsNew,
        keywordsLost: metrics.keywordsLost,
        referringDomains: metrics.referringDomains,
        backlinks: metrics.backlinks,
        spamScore: metrics.spamScore,
        newTopKeywords: metrics.newTopKeywords,
        trend: metrics.trend.slice(-12)
      })
    }),

    read_gsc_summary: tool({
      description:
        'Read Google Search Console owned search (28d clicks/impressions, top queries/pages). Free. Required before finish when GSC_STATUS is ready.',
      inputSchema: z.object({}),
      execute: async () => {
        const { loadGscSummary, formatGscPromptBlock, gscReadyFromSummary } = await import('$lib/server/gsc');
        const summary = await loadGscSummary(admin, String(opts.brand.id));
        state.gscRead = true;
        state.gscReady = gscReadyFromSummary(summary) && summary.configured && summary.connected;
        state.ownedQueries = summary.topQueries.map((q) => q.query);
        return {
          ready: state.gscReady,
          connected: summary.connected,
          siteUrl: summary.siteUrl,
          syncedAt: summary.syncedAt,
          clicks28d: summary.clicks28d,
          impressions28d: summary.impressions28d,
          topQueries: summary.topQueries.slice(0, 20),
          topPages: summary.topPages.slice(0, 10),
          promptBlock: formatGscPromptBlock(summary) || null
        };
      }
    }),

    read_existing_plan: tool({
      description: 'Read the current SEO plan (grade + initiatives) if one exists.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!existingPlan) return { error: 'No SEO plan yet' };
        return {
          grade: existingPlan.grade,
          evaluation: existingPlan.evaluation,
          initiatives: existingInits.map((i) => ({
            id: i.id,
            type: i.type,
            title: i.title,
            targetQuery: i.targetQuery,
            effort: i.effort,
            impact: i.impact
          })),
          created_at: existingPlan.created_at
        };
      }
    }),

    finish: tool({
      description: 'Commit the SEO evaluation and initiatives. Call when research is sufficient.',
      inputSchema: z.object({
        notes: z.string().describe('Short note on what DataForSEO / GSC evidence drove the plan.'),
        evaluation: z.object({
          grade: z.string(),
          summary: z.string(),
          strengths: z.array(z.string()),
          weaknesses: z.array(z.string())
        }),
        initiatives: z
          .array(
            z.object({
              type: z.enum(INITIATIVE_TYPES),
              title: z.string(),
              targetQuery: z.string(),
              rationale: z.string(),
              effort: z.enum(['low', 'medium', 'high']),
              impact: z.enum(['low', 'medium', 'high']),
              examples: z.array(z.string()).optional()
            })
          )
          .min(1)
          .max(10)
      }),
      execute: async ({ notes, evaluation, initiatives }) => {
        if (state.gscReady && !state.gscRead) {
          return { error: 'GSC is ready — call read_gsc_summary before finish.' };
        }
        const normalized = normalizeInitiatives(initiatives);
        if (!normalized.length) return { error: 'No valid initiatives' };

        let notesOut = notes.trim();
        if (state.gscReady && state.ownedQueries.length) {
          const { ownedQueryCoverage } = await import('$lib/server/gsc');
          const cov = ownedQueryCoverage(
            normalized.map((i) => i.targetQuery),
            state.ownedQueries
          );
          notesOut = `${notesOut}\n[GSC coverage ${Math.round(cov.ratio * 100)}% owned queries${cov.ratio < 0.4 ? ' — below 40% target; review priorities' : ''}.]`.trim();
        }

        const evalNorm: SeoEvaluation = {
          grade: String(evaluation.grade ?? '').slice(0, 8),
          summary: String(evaluation.summary ?? '').slice(0, 1200),
          strengths: (evaluation.strengths ?? []).map(String).slice(0, 6),
          weaknesses: (evaluation.weaknesses ?? []).map(String).slice(0, 6)
        };
        state.finished = {
          evaluation: evalNorm,
          initiatives: normalized,
          notes: notesOut,
          costUsd: Math.max(0, usdStart - budget.usdRemaining)
        };
        return { ok: true, initiatives: normalized.length, grade: evalNorm.grade };
      }
    })
  };

  const stallStop: StopCondition<typeof tools> = () => stallDetected(stallFingerprints, STALL_STEP_THRESHOLD);
  // Reassigned by withAgentFallback when the primary dies before any tool ran — everything
  // billed below must name the model that actually served the loop.
  let loopModel = agentModel();
  let loopOk = true;
  let loopError: string | undefined;

  try {
    await withAgentFallback('seoAgent', (chosen, markDirty) => {
      loopModel = chosen;
      return harnessGenerateText({
        brandId: String(opts.brand.id),
        agent: 'seo',
        mode,
        model: loopModel.modelId,
        provider: loopModel.provider,
        surface: 'batch'
      }, {
        model: loopModel.model,
        maxOutputTokens: maxOutputTokensFor(loopModel.provider),
        system: baseSystem,
        prompt:
          mode === 'more'
            ? `Research with DataForSEO, then finish with ${opts.count ?? 4} NEW initiatives distinct from the existing plan.`
            : `Review this brand's SEO with DataForSEO tools, then finish with an updated evaluation and prioritized initiatives.`,
        tools,
        stopWhen: [hasToolCall('finish'), stepCountIs(MAX_SEO_AGENT_STEPS), stallStop, () => deadlineReached(t0, deadlineMs)],
        temperature: 0.35,
        prepareStep: () => {
          const remainingSec = Math.max(0, Math.round((deadlineMs - (Date.now() - t0)) / 1000));
          const stepSystem = appendBudgetToSystem(baseSystem, budget, remainingSec);
          if (budget.usdRemaining <= 0 && state.finished) {
            return { toolChoice: { type: 'tool' as const, toolName: 'finish' }, system: stepSystem };
          }
          return { system: stepSystem };
        },
        onStepFinish: ({ usage, toolCalls, toolResults, text }) => {
          addStrategyStepCost(budget, usage, loopModel);
          // Approximate DFS spend so the USD cap bites before runaway history calls.
          const dfsCalls = (toolCalls ?? []).filter((tc) => String(tc.toolName).startsWith('dfs_')).length;
          if (dfsCalls) budget.usdRemaining = Math.max(0, budget.usdRemaining - dfsCalls * ESTIMATED_STEP_USD);
          stallFingerprints.push(
            stepFingerprint(
              { mode, s: budget.searchesLeft, u: budget.usdRemaining },
              toolCalls?.map((tc) => ({ toolName: tc.toolName, input: 'input' in tc ? tc.input : undefined }))
            )
          );
          stepNum += 1;
          if (opts.verbose) {
            console.log(
              `[seo-agent] step ${stepNum}`,
              toolCalls?.map((tc) => tc.toolName).join(',') || text?.slice(0, 80)
            );
          }
          void toolResults;
        }
      }, { before: [() => { markDirty(); }] });
    });
  } catch (e) {
    loopOk = false;
    loopError = e instanceof Error ? e.message : String(e);
  }

  const finished = state.finished;
  const costUsd = Math.max(0, usdStart - budget.usdRemaining);
  logAiCall({
    label: 'seoAgent',
    provider: loopModel.provider,
    model: loopModel.modelId,
    ms: Date.now() - t0,
    ok: loopOk && !!finished,
    error: loopError,
    flatCostUsd: costUsd || undefined
  });

  persistAgentRun({
    brandId: String(opts.brand.id),
    agent: 'seo',
    mode,
    status: finished ? 'finished' : 'failed',
    finishedOk: !!finished,
    notes: finished?.notes,
    costUsdEstimate: costUsd
  });

  if (!finished) return null;

  // Persist like the legacy generator.
  if (mode === 'more' && existingPlan?.id) {
    await admin
      .from('brand_seo_plans')
      .update({ initiatives: [...existingInits, ...finished.initiatives] })
      .eq('id', existingPlan.id);
    return { ...finished, initiatives: finished.initiatives };
  }

  await admin.from('brand_seo_plans').insert({
    brand_id: opts.brand.id,
    grade: finished.evaluation.grade ?? null,
    evaluation: finished.evaluation,
    initiatives: finished.initiatives
  });

  return finished;
}
