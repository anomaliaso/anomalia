import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStudio } from '$lib/server/cli-queries';
import { listBrandMedia } from '$lib/server/brand-media';
import {
  activeGtmBrief,
  currentPhaseIndex,
  gtmForPrompt,
  gtmRowToPlan,
  loadActiveGtm,
  phasesForHorizon,
  type GtmPlan
} from '$lib/server/gtm';
import { loadEditorialPlans, planForPrompt, type EditorialPlan, type EditorialPlanLoadWhich } from '$lib/server/editorial-plan';
import { strategyBriefFromReport, type StrategyReport } from '$lib/server/research';
import { studioCompleteness } from '$lib/studio-completeness';
import {
  VISUAL_WINNERS_NO_DATA,
  visualInsightsBlock
} from '$lib/server/platform-hygiene';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const GTM_COLS = 'id, status, horizon, objective, phases, funnel, parent_id, changes_summary, source, created_at, activated_at';

function clip(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const t = String(text).trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function summarizeGtmPlan(plan: GtmPlan & { id?: string; status?: string }, tz: string) {
  const phases90d = phasesForHorizon(plan, '90d');
  const phases6m = phasesForHorizon(plan, '6m');
  const plan90d = { ...plan, phases: phases90d };
  const plan6m = { ...plan, phases: phases6m };
  const idx90 = currentPhaseIndex(plan90d, tz);
  const idx6m = currentPhaseIndex(plan6m, tz);
  return {
    id: plan.id,
    status: plan.status,
    objective: plan.objective,
    horizon: plan.horizon,
    current_phase_90d: idx90 != null ? phases90d[idx90]?.name : null,
    current_phase_6m: idx6m != null ? phases6m[idx6m]?.name : null,
    phases_90d_count: phases90d.length,
    phases_6m_count: phases6m.length,
    funnel: plan.funnel,
    plan_json: gtmForPrompt(plan)
  };
}

export type GtmLoadWhich = 'active' | 'proposed' | 'both';

export async function readGtmForAgent(
  supabase: SupabaseClient,
  brandId: string,
  tz: string,
  which: GtmLoadWhich = 'both'
) {
  const out: { active: ReturnType<typeof summarizeGtmPlan> | null; proposed: ReturnType<typeof summarizeGtmPlan> | null; current_phase_brief: string } = {
    active: null,
    proposed: null,
    current_phase_brief: ''
  };

  if (which === 'active' || which === 'both') {
    const active = await loadActiveGtm(supabase, brandId);
    if (active) out.active = summarizeGtmPlan(active, tz);
  }
  if (which === 'proposed' || which === 'both') {
    const { data: row } = await supabase
      .from('gtm_plans')
      .select(GTM_COLS)
      .eq('brand_id', brandId)
      .eq('status', 'proposed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (row) out.proposed = summarizeGtmPlan(gtmRowToPlan(row), tz);
  }

  out.current_phase_brief = await activeGtmBrief(supabase, brandId, tz).catch((error) => { swallow('load gtm brief', error); return ''; });
  return out;
}

export async function readEditorialPlanForAgent(
  supabase: SupabaseClient,
  brandId: string,
  which: EditorialPlanLoadWhich = 'both'
) {
  const plans = await loadEditorialPlans(supabase, brandId, which);
  const compact = (plan: EditorialPlan | null) =>
    plan
      ? {
          id: plan.id,
          status: plan.status,
          cadence: plan.cadence,
          strategy: clip(plan.strategy, 1200),
          voice: plan.voice,
          platform_mix: plan.platform_mix,
          gtm: plan.gtm,
          weeks: plan.weeks.map((w) => ({
            week: w.index + 1,
            theme: w.theme,
            focus: w.focus,
            content_mix: w.content_mix,
            status: w.status,
            brief: w.brief
          })),
          changes_summary: plan.changes_summary,
          full_json: planForPrompt(plan)
        }
      : null;

  return {
    active: compact(plans.active),
    proposed: compact(plans.proposed)
  };
}

export async function readBrandStudioForAgent(supabase: SupabaseClient, brandId: string) {
  const [studio, brandRes] = await Promise.all([
    getStudio(supabase, brandId),
    supabase.from('brands').select('content_prefs').eq('id', brandId).maybeSingle()
  ]);
  const kit = studio.kit as AnyRec | null;
  const prefs = (brandRes.data?.content_prefs ?? {}) as AnyRec;
  const completeness = studioCompleteness({
    products: studio.products.length,
    history: studio.history.length,
    documents: studio.documents.length,
    voice: !!kit?.ai_character,
    about: !!kit?.about,
    audience: !!kit?.target_audience,
    logo: Array.isArray(kit?.logos) && kit.logos.length > 0,
    colors: !!kit?.brand_colors
  });

  return {
    completeness,
    target_platforms: studio.targetPlatforms,
    language: studio.language,
    platform_instructions: studio.platformInstructions,
    voice_prefs: {
      mood: prefs.mood ?? null,
      tone: prefs.tone ?? null,
      goal: prefs.goal ?? null,
      frequency: prefs.frequency ?? null,
      voice_mode: prefs.voiceMode ?? null,
      voice_framework: prefs.voiceFramework ?? null,
      avoid: Array.isArray(prefs.avoid) ? prefs.avoid.slice(0, 20) : [],
      voice_examples: Array.isArray(prefs.voiceExamples) ? prefs.voiceExamples.slice(0, 8) : [],
      platform_hashtags: prefs.platformHashtags ?? {}
    },
    kit: kit
      ? {
          category: kit.category,
          site_type: kit.site_type,
          about: kit.about,
          target_audience: kit.target_audience,
          brand_style: kit.brand_style,
          brand_colors: kit.brand_colors,
          theme_color: kit.theme_color,
          fonts: kit.fonts,
          logos: kit.logos,
          favicon_url: kit.favicon_url,
          images: kit.images,
          ai_character: kit.ai_character,
          ai_context: clip(kit.ai_context as string, 6000),
          ai_context_updated_at: kit.ai_context_updated_at,
          content_pillars: kit.content_pillars,
          visual_style: clip(kit.visual_style as string, 8000),
          visual_style_locked: kit.visual_style_locked === true
        }
      : null,
    products: studio.products.map((p: AnyRec) => ({
      id: p.id,
      title: p.title,
      pricing: p.pricing,
      featured: p.featured,
      imageCount: Array.isArray(p.images) ? p.images.length : 0
    })),
    people: studio.people,
    competitors: studio.competitors.map((c: AnyRec) => ({
      name: c.name,
      website: c.website,
      kind: c.kind,
      rationale: c.rationale
    }))
  };
}

export async function readKnowledgeForAgent(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { kind?: 'note' | 'document' | 'image'; limit?: number; query?: string }
) {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 60);

  if (opts?.query?.trim()) {
    const { searchKnowledge } = await import('$lib/server/knowledge');
    const hits = await searchKnowledge(supabase, brandId, opts.query, { limit: Math.min(limit, 12) });
    return { mode: 'search' as const, results: hits, count: hits.length };
  }

  let query = supabase
    .from('brand_documents')
    .select('id, kind, title, summary, status, chunk_count, file_name, mime_type, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts?.kind) query = query.eq('kind', opts.kind);

  const { data } = await query;
  return {
    mode: 'list' as const,
    documents: (data ?? []).map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      file_name: d.file_name,
      mime_type: d.mime_type,
      created_at: d.created_at,
      status: d.status,
      chunk_count: d.chunk_count,
      summary: clip(d.summary, 400)
    })),
    count: data?.length ?? 0,
    hint: 'Pass query= to retrieve chunk passages via FTS.'
  };
}

export async function readRubricsForAgent(
  supabase: SupabaseClient,
  brandId: string,
  which: 'approved' | 'proposed' | 'both' = 'approved'
) {
  const { loadApprovedRubrics, loadProposedRubrics } = await import('$lib/server/rubrics');
  const [approved, proposed] = await Promise.all([
    which === 'approved' || which === 'both' ? loadApprovedRubrics(supabase, brandId) : Promise.resolve([]),
    which === 'proposed' || which === 'both' ? loadProposedRubrics(supabase, brandId) : Promise.resolve([])
  ]);
  const compact = (r: import('$lib/server/rubrics').Rubric) => ({
    id: r.id,
    name: r.name,
    format: r.format,
    promise: clip(r.promise, 400),
    strategic_role: clip(r.strategic_role, 200),
    cadence: r.cadence,
    differentiation: clip(r.differentiation, 200),
    art_direction: clip(r.art_direction ?? '', 400),
    status: r.status
  });
  return {
    approved: approved.map(compact),
    proposed: proposed.map(compact),
    count: approved.length + proposed.length,
    note:
      approved.length > 0
        ? 'When approved rubrics exist, editorial plan content_mix and weekly seeds must use these series names for consistency.'
        : 'No approved rubrics yet — content types may be free-form.'
  };
}

export async function readMediaForAgent(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { query?: string; kind?: 'image' | 'video'; status?: 'pending' | 'ready' | 'failed'; limit?: number }
) {
  const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 50);
  let items = await listBrandMedia(supabase, brandId, {
    limit,
    status: opts?.status,
    query: opts?.query
  });
  if (opts?.kind) items = items.filter((m) => m.kind === opts.kind);

  return {
    media: items.map((m) => ({
      id: m.id,
      kind: m.kind,
      title: m.title,
      description: m.description,
      tags: m.tags ?? [],
      subjects: m.subjects ?? [],
      colors: m.colors ?? [],
      mood: m.mood,
      media_kind: m.media_kind,
      suggested_use: m.suggested_use,
      when_to_use: m.when_to_use,
      how_to_use: m.how_to_use,
      where_to_use: m.where_to_use,
      width: m.width,
      height: m.height,
      catalog_status: m.catalog_status,
      times_used: m.times_used ?? 0,
      last_used_at: m.last_used_at ?? null
    })),
    count: items.length,
    hint: 'Prefer unused or least-recently-used assets when several fit (times_used / last_used_at).'
  };
}

export type LeadsLoadStatus = 'suggested' | 'done' | 'dismissed' | 'all';

function platformFromLeadUrl(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes('reddit.com')) return 'reddit';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'x';
  return null;
}

/** Online conversations (Reddit/Threads/X) with AI-drafted comment/DM suggestions — the /leads page. */
export async function readLeadsForAgent(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { status?: LeadsLoadStatus; limit?: number }
) {
  const limit = Math.min(Math.max(opts?.limit ?? 25, 1), 80);
  const status = opts?.status ?? 'all';
  let query = supabase
    .from('brand_news_items')
    .select('id, title, url, source_name, snippet, status, relevance, suggestion, dm_draft, dm_target, created_at')
    .eq('brand_id', brandId)
    .not('suggestion', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status === 'all') {
    query = query.in('status', ['suggested', 'done', 'dismissed']);
  } else {
    query = query.eq('status', status);
  }

  const { data } = await query;
  const leads = (data ?? []).map((l) => ({
    id: l.id,
    platform: platformFromLeadUrl(String(l.url ?? '')),
    title: l.title,
    url: l.url,
    source: l.source_name,
    /** What people are discussing in the thread — use for editorial angles and objections. */
    discussion: clip(l.snippet, 1400),
    status: l.status,
    relevance: l.relevance,
    drafted_comment: clip(l.suggestion, 700),
    drafted_dm: clip(l.dm_draft, 500),
    dm_target: l.dm_target,
    created_at: l.created_at
  }));

  return {
    leads,
    count: leads.length,
    open_count: leads.filter((l) => l.status === 'suggested').length,
    note:
      leads.length > 0
        ? 'Real online threads where the product/category is being discussed. Mine objections, questions and language for editorial plans and weekly content — align posts with what the audience is actually asking.'
        : 'No leads stored yet — Radar has not surfaced comment opportunities with drafted replies for this brand.'
  };
}

/** Compact block for system-prompt preload (grow/publish hubs). */
export function leadsBriefForPrompt(
  rows: Array<{
    title?: string | null;
    url?: string | null;
    snippet?: string | null;
    status?: string | null;
    relevance?: string | null;
    source_name?: string | null;
  }>
): string {
  if (!rows.length) return '';
  const lines = rows.map((l) => {
    const plat = platformFromLeadUrl(String(l.url ?? '')) ?? 'web';
    const title = String(l.title ?? '').trim() || '(untitled thread)';
    const discuss = clip(l.snippet, 220);
    const rel = l.relevance ? ` [${l.relevance}]` : '';
    return `- [${plat}${rel}] ${title}${discuss ? ` — ${discuss}` : ''}`;
  });
  return `LEADS (online conversations — what people discuss about the product/category):\n${lines.join('\n')}`;
}

export async function readStrategyReportForAgent(supabase: SupabaseClient, brandId: string) {
  const { data } = await supabase.from('brand_strategy').select('report, positioning, benchmark').eq('brand_id', brandId).maybeSingle();
  const report = (data?.report as StrategyReport | null) ?? null;
  return {
    positioning: clip(data?.positioning as string, 2000),
    strategy_brief: report ? strategyBriefFromReport(report) : '',
    report: report
      ? {
          summary: clip(report.summary, 2000),
          competitive_landscape: clip(report.competitiveLandscape, 2000),
          white_space: report.whiteSpace?.slice(0, 8),
          differentiators: report.differentiators?.slice(0, 8),
          threats: report.threats?.slice(0, 8),
          recommended_angles: report.recommendedAngles?.slice(0, 8),
          platform_guidance: report.platformGuidance?.slice(0, 6)
        }
      : null,
    has_benchmark: !!data?.benchmark
  };
}

/**
 * VISUAL WINNERS for prompt preload: last N windows of brand_visual_insights (own published posts)
 * with n ≥ 3 and a POSITIVE delta (buckets below the brand mean are persisted but are not
 * winners). Returns a prompt-ready block ordered by delta, or '' when there is no data —
 * never invents winners.
 */
export async function readVisualInsightsForAgent(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { limit?: number }
): Promise<string> {
  const limit = Math.min(Math.max(opts?.limit ?? 8, 1), 30);
  try {
    const { data } = await supabase
      .from('brand_visual_insights')
      .select('window_start, dimension, value, n, er_avg, delta')
      .eq('brand_id', brandId)
      .gte('n', 3)
      .gt('delta', 0)
      .order('window_start', { ascending: false })
      .limit(400);
    const rows = (data ?? []) as Array<{
      window_start: string;
      dimension: string;
      value: string;
      n: number;
      er_avg: number | null;
      delta: number | null;
    }>;
    if (!rows.length) return '';
    // One analysis run per window_start — keep only the `limit` most recent windows.
    const kept = new Set<string>();
    for (const r of rows) {
      const w = String(r.window_start ?? '');
      if (!w || kept.has(w)) continue;
      kept.add(w);
      if (kept.size >= limit) break;
    }
    const block = visualInsightsBlock(rows.filter((r) => kept.has(String(r.window_start))), { limit });
    return block === VISUAL_WINNERS_NO_DATA ? '' : block;
  } catch (e) {
    console.warn('[visual-insights] readVisualInsightsForAgent failed:', e instanceof Error ? e.message : e);
    return '';
  }
}

