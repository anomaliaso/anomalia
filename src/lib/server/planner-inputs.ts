import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient, strategyBriefFromReport, type Benchmark, type StrategyReport } from '$lib/server/research';
import { rankRecentWinners } from '$lib/server/scheduler';
import { ensureBrandHistory } from '$lib/server/scrapecreators';
import { attachBrandPages } from '$lib/server/content-library';
import { proposePlan, cadenceAllowed, saveProposedPlan } from '$lib/server/editorial-plan';
import { activeGtmBrief } from '$lib/server/gtm';
import { loadApprovedRubrics } from '$lib/server/rubrics';
import { localeLanguageName } from '$lib/i18n/locale';
import { analyzePostHistory } from '$lib/server/post-history-insights';

/**
 * Catalogue depth the planner gets. Enough to allocate a month of rows across real offerings
 * without turning the prompt into a product feed.
 */
const PLANNER_PRODUCT_MAX = 25;

// Shared inputs for the editorial-plan engine (propose/revise/replan) assembled from STORED data —
// no website refetch. Extracted from the strategy page so the /plan blank-slate can propose a
// brand's FIRST plan too (that flow was orphaned: only the de-linked /strategy page could run it).

/**
 * The planner-shaped profile for the plan-engine LLM calls.
 *
 * It used to read seven fields of the kit — category, about, audience, ai_context, visual_style,
 * site_type, pillars — and nothing else. So the thing that decides what a brand posts for the next
 * four weeks did not know the brand's voice, its palette, its catalogue, its faces or who it
 * competes with; meanwhile a SECOND function of the same name in `chat/async-jobs.ts` was reading
 * thirteen. Same name, two answers, and the planner had the poorer one.
 *
 * This is now the only one. `products` / `people` / `competitors` ride along because the plan
 * allocates rows to real offerings and real faces — a plan that cannot name either writes "post
 * about the product".
 */
export async function plannerProfile(
  supabase: SupabaseClient,
  brand: { id: string; name: string },
  opts: { pages?: boolean } = {}
) {
  const [{ data: kit }, { data: brandRow }, { data: products }, { data: people }, { data: competitors }] =
    await Promise.all([
      supabase
        .from('brand_kit')
        .select(
          'category, about, target_audience, brand_style, ai_context, visual_style, graphic_style, site_type, content_pillars, brand_colors, fonts, logos, theme_color, favicon_url, images, ai_character'
        )
        .eq('brand_id', brand.id)
        .maybeSingle(),
      supabase.from('brands').select('content_prefs, target_platforms').eq('id', brand.id).maybeSingle(),
      supabase
        .from('products')
        .select('id, title, description, kind, pricing, url, images, featured')
        .eq('brand_id', brand.id)
        .order('featured', { ascending: false })
        .limit(PLANNER_PRODUCT_MAX),
      supabase.from('people').select('id, name, role, kind, description').eq('brand_id', brand.id),
      supabase.from('competitors').select('name, website, kind, rationale').eq('brand_id', brand.id)
    ]);
  const prefs = (brandRow?.content_prefs ?? {}) as Record<string, unknown>;
  const profile = {
    name: brand.name,
    category: kit?.category ?? '',
    about: kit?.about ?? '',
    target_audience: kit?.target_audience ?? '',
    brand_style: kit?.brand_style ?? '',
    ai_context: kit?.ai_context ?? '',
    visual_style: kit?.visual_style ?? '',
    graphic_style: kit?.graphic_style ?? null,
    site_type: kit?.site_type ?? 'generic',
    content_pillars: kit?.content_pillars ?? [],
    brand_colors: kit?.brand_colors ?? [],
    fonts: kit?.fonts ?? [],
    logos: kit?.logos ?? [],
    theme_color: kit?.theme_color ?? null,
    favicon_url: kit?.favicon_url ?? null,
    images: kit?.images ?? [],
    ai_character: kit?.ai_character ?? {},
    language: (typeof prefs.language === 'string' ? prefs.language : '') || '',
    target_platforms: Array.isArray(brandRow?.target_platforms) ? (brandRow.target_platforms as string[]) : [],
    studio_products: products ?? [],
    studio_people: people ?? [],
    studio_competitors: competitors ?? []
  };
  // Linkable site pages (content library) so the editorial plan can deliberately allocate
  // link-driving content rows tied to the brand's real pages/topics. Skipped by the produce path,
  // which has no use for them and should not pay for the query.
  if (opts.pages !== false) await attachBrandPages(profile, supabase, brand.id).catch(swallow('attach brand pages'));
  return profile;
}

// Everything the propose/revise prompts need from research + history: the stored strategy
// report (brief + benchmark) and the brand's recent winners. Materializes the brand's organic
// history from its declared handles FIRST (cache-first, near-free) — a brand with thriving
// socials but an unmaterialized history must never be judged "0→1".
export async function planEvidence(supabase: SupabaseClient, brandId: string) {
  await ensureBrandHistory(supabase, brandId);
  const [{ data: strategy }, { data: history }] = await Promise.all([
    supabase.from('brand_strategy').select('report, benchmark').eq('brand_id', brandId).maybeSingle(),
    // `media_type` rides along for free on a query we were already making — it is the FORMAT axis
    // of the hook coverage map, and without it "this angle in a format we have never tried" cannot
    // be computed at all.
    supabase
      .from('social_post_history')
      .select('content, platform, metrics, published_at, media_type')
      .eq('brand_id', brandId)
      .eq('source', 'zernio')
      .limit(200)
  ]);
  const report = (strategy?.report as StrategyReport | null) ?? null;
  const insights = analyzePostHistory(
    (history ?? []).map((h) => ({
      content: h.content,
      mediaType: (h as { media_type?: string | null }).media_type,
      publishedAt: h.published_at,
      metrics: h.metrics as { likes?: number | null; comments?: number | null; engagementRate?: number | null } | null
    }))
  );
  return {
    strategyBrief: report ? strategyBriefFromReport(report) : '',
    benchmark: (strategy?.benchmark as Benchmark | null) ?? null,
    topPosts: rankRecentWinners(history ?? []),
    historyCount: (history ?? []).length,
    /** Which openings this brand has tried, and which have actually won. */
    hooks: insights.hooks,
    /** Which angles have earned real production spend — see `production-ladder.ts`. */
    ladder: {
      proven: insights.hooks.proven,
      tried: insights.hooks.used,
      coldStart: insights.hooks.used.length === 0
    }
  };
}

type ProposeBrand = {
  id: string;
  name: string;
  plan: string | null;
  timezone: string;
  target_platforms: unknown;
};

// Propose a brand's first (or replacement) 4-week editorial plan from everything already stored,
// persist it as 'proposed' (superseding any prior pending proposal) and return its id. The caller
// decides what happens next: the strategy page leaves it for review, the /plan blank-slate
// activates it immediately (the click IS the approval there). Throws on LLM/insert failure.
export async function proposeFirstPlan(
  supabase: SupabaseClient,
  brand: ProposeBrand,
  locale: string | null | undefined
): Promise<{ id: string }> {
  const [profile, evidence, gtmBrief, rubrics] = await Promise.all([
    plannerProfile(supabase, brand),
    planEvidence(supabase, brand.id),
    activeGtmBrief(supabase, brand.id, brand.timezone).catch((error) => { swallow('load gtm brief', error); return ''; }),
    loadApprovedRubrics(supabase, brand.id).catch((error) => { swallow('load approved rubrics', error); return []; })
  ]);
  const proposal = await proposePlan(genaiClient(), profile, {
    platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
    allowedCadences: cadenceAllowed(brand.plan),
    outputLanguage: localeLanguageName(locale),
    strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
    benchmark: evidence.benchmark,
    topPosts: evidence.topPosts,
    zeroToOne: evidence.historyCount < 10,
    rubrics,
    supabase,
    brandId: brand.id,
    planTier: brand.plan,
    timezone: brand.timezone
  });
  const saved = await saveProposedPlan(supabase, brand.id, proposal);
  if (!saved.ok) throw new Error(saved.message);
  return { id: saved.id };
}
