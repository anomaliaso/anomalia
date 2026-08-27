import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient, strategyBriefFromReport, type Benchmark, type StrategyReport } from '$lib/server/research';
import { rankRecentWinners } from '$lib/server/scheduler';
import { withBrandContext } from '$lib/server/ai-log';
import {
  proposeGtmDual,
  proposeGtm,
  redirectGtmDual,
  reviewPhase,
  phasePerformanceDigest,
  activateGtm,
  gtmRowToPlan,
  currentPhaseIndex,
  phaseStatus,
  phasesForHorizon,
  needs90dRefresh,
  stampPhases,
  HORIZONS
} from '$lib/server/gtm';
import { ensureBrandHistory } from '$lib/server/scrapecreators';
import { localeLanguageName } from '$lib/i18n/locale';
import { studioCompleteness } from '$lib/studio-completeness';
import { clampFunnelSpec, stampFunnelGoals } from '$lib/server/funnel';
import { cachedBrandPage } from '$lib/server/page-cache';

// The GTM page: the brand's growth roadmap. Anomalia proposes a phased plan over a chosen horizon;
// the user approves or redirects it conversationally; the active phase steers all content
// production (via activeGtmBrief); at phase end the real KPIs are compared with the targets and
// Anomalia proposes a course correction — always propose → approve, never silent autonomy.

// propose/redirect/review each carry one Gemini call (~20-40s) on the legacy path. With
// GTM_AGENT_ENABLED the agent loop runs instead and is far slower, so this sits at the platform
// ceiling and the agent carries its own 240s deadline — it must hand back a plan before the
// function is killed, because a killed function also skips the legacy fallback.
export const config = { maxDuration: 300 };

type BrandRow = { id: string; name: string; slug: string; plan: string | null; timezone: string; target_platforms: unknown };

async function requireBrand(supabase: SupabaseClient, slug: string): Promise<BrandRow> {
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug, plan, timezone, target_platforms')
    .eq('slug', slug)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');
  return brand as BrandRow;
}

// requireBrand + withBrandContext in one call — use in every action/load that touches AI.
async function withBrand<T>(supabase: SupabaseClient, slug: string, fn: (brand: BrandRow) => Promise<T>): Promise<T> {
  const brand = await requireBrand(supabase, slug);
  return withBrandContext(brand.id, () => fn(brand));
}

async function plannerProfile(supabase: SupabaseClient, brand: BrandRow) {
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('category, about, target_audience, ai_context, site_type, content_pillars')
    .eq('brand_id', brand.id)
    .maybeSingle();
  return {
    name: brand.name,
    category: kit?.category ?? '',
    about: kit?.about ?? '',
    target_audience: kit?.target_audience ?? '',
    ai_context: kit?.ai_context ?? '',
    site_type: kit?.site_type ?? 'generic',
    content_pillars: kit?.content_pillars ?? []
  };
}

// Materializes the brand's organic history from its declared handles FIRST (cache-first,
// near-free) — a brand with thriving socials but an unmaterialized history must never be
// judged "0→1" by the roadmap.
async function planEvidence(supabase: SupabaseClient, brandId: string) {
  await ensureBrandHistory(supabase, brandId);
  const [{ data: strategy }, { data: history }] = await Promise.all([
    supabase.from('brand_strategy').select('report, benchmark').eq('brand_id', brandId).maybeSingle(),
    supabase.from('social_post_history').select('content, platform, metrics, published_at').eq('brand_id', brandId).limit(200)
  ]);
  const report = (strategy?.report as StrategyReport | null) ?? null;
  return {
    strategyBrief: report ? strategyBriefFromReport(report) : '',
    benchmark: (strategy?.benchmark as Benchmark | null) ?? null,
    topPosts: rankRecentWinners(history ?? []),
    historyCount: (history ?? []).length
  };
}

const GTM_COLS = 'id, status, horizon, objective, phases, parent_id, revision_feedback, reply, changes_summary, source, created_at, activated_at';

function platformsOf(brand: BrandRow): string[] {
  return Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [];
}

// How complete the Studio is, with the same scoring the Studio banner uses — the roadmap is
// only as sharp as the data it reads, so the page says so honestly. Head-count queries keep
// this near-free.
async function studioPct(supabase: SupabaseClient, brandId: string): Promise<number> {
  const [{ data: kit }, products, history, documents] = await Promise.all([
    supabase
      .from('brand_kit')
      .select('about, target_audience, brand_style, ai_character, brand_colors, logos')
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('social_post_history').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('brand_documents').select('id', { count: 'exact', head: true }).eq('brand_id', brandId)
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const character = (kit?.ai_character ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasLogo = ((kit?.logos ?? []) as any[]).some((l) => l?.url && l?.type !== 'og-image');
  return studioCompleteness({
    products: products.count ?? 0,
    history: history.count ?? 0,
    documents: documents.count ?? 0,
    voice: !!(character.tone || character.speaking_style || kit?.brand_style),
    about: !!kit?.about,
    audience: !!kit?.target_audience,
    logo: hasLogo,
    colors: Array.isArray(kit?.brand_colors) && kit.brand_colors.length > 0
  }).pct;
}

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [{ data: activeRow }, { data: proposedRows }, { data: histRows }, studio] = await Promise.all([
      supabase.from('gtm_plans').select(GTM_COLS).eq('brand_id', brand.id).eq('status', 'active').maybeSingle(),
      supabase
        .from('gtm_plans')
        .select(GTM_COLS)
        .eq('brand_id', brand.id)
        .eq('status', 'proposed')
        .order('created_at', { ascending: false })
        .limit(1),
      // Past, superseded roadmaps — the "Storico strategie" trail (read-only).
      supabase
        .from('gtm_plans')
        .select(GTM_COLS)
        .eq('brand_id', brand.id)
        .eq('status', 'superseded')
        .order('activated_at', { ascending: false })
        .limit(20),
      studioPct(supabase, brand.id)
    ]);

    const active = activeRow ? gtmRowToPlan(activeRow) : null;
    const proposed = proposedRows?.[0] ? gtmRowToPlan(proposedRows[0]) : null;
    const history = (histRows ?? []).map((r) => ({
      ...gtmRowToPlan(r),
      activated_at: (r.activated_at as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      changes_summary: (r.changes_summary as string[] | null) ?? null
    }));
    // Default view: 6-month horizon (the strategic view).
    const activePhases6m = active ? phasesForHorizon(active, '6m') : [];
    const plan6m = active ? { ...active, phases: activePhases6m } : null;
    const phaseIdx = plan6m ? currentPhaseIndex(plan6m, brand.timezone) : null;

    return {
      gtm: active,
      proposed,
      history,
      proposedFeedback: (proposedRows?.[0]?.revision_feedback as string | null) ?? null,
      proposedSource: (proposedRows?.[0]?.source as string | null) ?? null,
      currentPhase: phaseIdx,
      // done/now/next per phase, derived from the stamped dates (brand timezone). Default: 6m view.
      phaseStatuses: plan6m ? activePhases6m.map((p) => phaseStatus(p, brand.timezone)) : [],
      // End-of-phase review is offered when at least one phase is done and the plan hasn't lapsed
      // entirely unreviewed — the panel appears only then, never permanently (brief §5.7).
      reviewablePhase: plan6m
        ? ([...activePhases6m].reverse().find((p) => phaseStatus(p, brand.timezone) === 'done')?.index ?? null)
        : null,
      horizons: [...HORIZONS],
      // When the 90d plan has expired but 6m is still active → prompt to refresh the 90d plan.
      needs90dRefresh: active ? needs90dRefresh(active, brand.timezone) : false,
      // "The plan reads from the Studio" — surfaced so the page can say how sharp the data is.
      studioPct: studio
    };
  });
};

export const actions: Actions = {
  // Propose a dual-horizon roadmap (90d + 6m) in a single generation.
  propose: async ({ request, params, locals: { supabase, locale } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const objective = String(data.get('objective') ?? '').trim();
      try {
        const [profile, evidence] = await Promise.all([plannerProfile(supabase, brand), planEvidence(supabase, brand.id)]);
        const plan = await proposeGtmDual(genaiClient(), profile, {
          objective,
          platforms: platformsOf(brand),
          outputLanguage: localeLanguageName(locale),
          benchmark: evidence.benchmark,
          topPosts: evidence.topPosts,
          zeroToOne: evidence.historyCount < 10,
          supabase,
          brandId: brand.id,
          timezone: brand.timezone
        });
        await supabase.from('gtm_plans').update({ status: 'rejected' }).eq('brand_id', brand.id).eq('status', 'proposed');
        const dualPhases = { horizon_90d: plan.phases_90d ?? [], horizon_6m: plan.phases_6m ?? plan.phases };
        const { error: err } = await supabase.from('gtm_plans').insert({
          brand_id: brand.id,
          status: 'proposed',
          horizon: '6m',
          objective: plan.objective || null,
          phases: dualPhases,
          funnel: plan.funnel ?? null,
          source: 'manual'
        });
        if (err) return fail(500, { error: err.message });
        return { proposedNew: true };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'propose_failed' });
      }
    });
  },

  // Conversational redirect: recalculates BOTH horizons (90d + 6m) coherently.
  redirect: async ({ request, params, locals: { supabase, locale } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const feedback = String(data.get('feedback') ?? '').trim();
      const phaseRaw = Number(data.get('phase') ?? -1);
      const phaseIndex = Number.isInteger(phaseRaw) && phaseRaw >= 0 ? phaseRaw : null;
      if (!feedback) return fail(400, { error: 'feedback_required' });

      const { data: row } = await supabase.from('gtm_plans').select(GTM_COLS).eq('id', planId).eq('brand_id', brand.id).maybeSingle();
      if (!row) return fail(404, { error: 'plan_not_found' });
      const current = gtmRowToPlan(row);

      try {
        const [profile, evidence] = await Promise.all([plannerProfile(supabase, brand), planEvidence(supabase, brand.id)]);
        const revised = await redirectGtmDual(genaiClient(), current, feedback, phaseIndex, profile, {
          platforms: platformsOf(brand),
          outputLanguage: localeLanguageName(locale),
          benchmark: evidence.benchmark,
          topPosts: evidence.topPosts,
          supabase,
          brandId: brand.id,
          timezone: brand.timezone
        });
        await supabase.from('gtm_plans').update({ status: 'rejected' }).eq('brand_id', brand.id).eq('status', 'proposed');
        const dualPhases = { horizon_90d: revised.phases_90d ?? [], horizon_6m: revised.phases_6m ?? revised.phases };
        const { error: err } = await supabase.from('gtm_plans').insert({
          brand_id: brand.id,
          status: 'proposed',
          horizon: '6m',
          objective: revised.objective || current.objective || null,
          phases: dualPhases,
          funnel: revised.funnel ?? current.funnel ?? null,
          parent_id: current.id,
          revision_feedback: feedback,
          reply: revised.reply ?? null,
          changes_summary: revised.changes_summary ?? [],
          source: 'revision'
        });
        if (err) return fail(500, { error: err.message });
        return { redirected: true };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'redirect_failed' });
      }
    });
  },

  // Approve a proposal → it becomes the active roadmap.
  approve: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const ok = await activateGtm(supabase, brand.id, planId, brand.timezone);
      if (!ok) return fail(404, { error: 'plan_not_found' });
      return { approved: true };
    });
  },

  discard: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const { error: err } = await supabase
        .from('gtm_plans')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', planId)
        .eq('brand_id', brand.id)
        .eq('status', 'proposed');
      if (err) return fail(500, { error: err.message });
      return { discarded: true };
    });
  },

  deleteVersion: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const id = String((await request.formData()).get('id') ?? '');
      if (!id) return fail(400, { error: 'missing_id' });
      const { error: err } = await supabase.from('gtm_plans').delete().eq('id', id).eq('brand_id', brand.id);
      if (err) return fail(500, { error: err.message });
      return { deleted: true };
    });
  },

  // End-of-phase review: compare real KPIs with the phase's targets.
  review: async ({ request, params, locals: { supabase, locale } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const phaseIndex = Number(data.get('phase') ?? -1);

      const { data: row } = await supabase.from('gtm_plans').select(GTM_COLS).eq('id', planId).eq('brand_id', brand.id).eq('status', 'active').maybeSingle();
      if (!row) return fail(404, { error: 'plan_not_found' });
      const plan = gtmRowToPlan(row);
      const phases6m = phasesForHorizon(plan, '6m');
      const phase = phases6m[phaseIndex];
      if (!phase) return fail(400, { error: 'invalid_phase' });

      try {
        const [profile, { data: posts }, { data: history }] = await Promise.all([
          plannerProfile(supabase, brand),
          supabase.from('posts').select('platform, published_at').eq('brand_id', brand.id).not('published_at', 'is', null).limit(500),
          supabase.from('social_post_history').select('platform, metrics, published_at').eq('brand_id', brand.id).limit(500)
        ]);
        const digest = phasePerformanceDigest(posts ?? [], history ?? [], phase);
        const planForReview = { ...plan, phases: phases6m };
        const review = await reviewPhase(genaiClient(), planForReview, phaseIndex, digest, profile, localeLanguageName(locale));

        if (review.verdict === 'adjust' && review.plan) {
          const mergedPhases = review.plan.phases.map((p, i) => ({ ...p, start_date: phases6m[i]?.start_date ?? p.start_date, end_date: phases6m[i]?.end_date ?? p.end_date }));
          await supabase.from('gtm_plans').update({ status: 'rejected' }).eq('brand_id', brand.id).eq('status', 'proposed');
          const dualPhases = { horizon_90d: plan.phases_90d ?? [], horizon_6m: mergedPhases };
          await supabase.from('gtm_plans').insert({
            brand_id: brand.id,
            status: 'proposed',
            horizon: '6m',
            objective: plan.objective || null,
            phases: dualPhases,
            funnel: plan.funnel ?? null,
            parent_id: plan.id,
            reply: review.message,
            changes_summary: review.changes_summary,
            source: 'phase_review'
          });
        }
        return { reviewed: true, verdict: review.verdict, message: review.message };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'review_failed' });
      }
    });
  },

  // Regenerate the 90-day plan aligned with the current 6-month phase.
  refresh90d: async ({ request, params, locals: { supabase, locale } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');

      const { data: row } = await supabase.from('gtm_plans').select(GTM_COLS).eq('id', planId).eq('brand_id', brand.id).eq('status', 'active').maybeSingle();
      if (!row) return fail(404, { error: 'plan_not_found' });
      const current = gtmRowToPlan(row);

      const phases6m = phasesForHorizon(current, '6m');
      const plan6m = { ...current, phases: phases6m };
      const current6mIdx = currentPhaseIndex(plan6m, brand.timezone);
      const current6mPhase = current6mIdx != null ? phases6m[current6mIdx] : null;

      try {
        const [profile, evidence] = await Promise.all([plannerProfile(supabase, brand), planEvidence(supabase, brand.id)]);
        const contextualObjective = [
          current.objective,
          current6mPhase
            ? `The current 6-month phase is "${current6mPhase.name}" (objective: ${current6mPhase.objective}). The new 90-day plan must align with and advance this phase.`
            : ''
        ].filter(Boolean).join(' — ');

        const new90d = await proposeGtm(genaiClient(), profile, {
          horizon: '90d',
          objective: contextualObjective,
          platforms: platformsOf(brand),
          outputLanguage: localeLanguageName(locale),
          benchmark: evidence.benchmark,
          topPosts: evidence.topPosts,
          zeroToOne: evidence.historyCount < 10
        });

        const stamped90d = stampPhases(new90d.phases, brand.timezone);
        const updatedPhases = { horizon_90d: stamped90d, horizon_6m: phases6m };
        await supabase
          .from('gtm_plans')
          .update({ phases: updatedPhases, updated_at: new Date().toISOString() })
          .eq('id', planId);
        return { refreshed90d: true };
      } catch (e) {
        return fail(500, { error: e instanceof Error ? e.message : 'refresh90d_failed' });
      }
    });
  },

  // Edit the funnel ASSUMPTIONS on the active plan — the explicit, client-owned source of truth
  // for every numeric target. The new spec is clamped in code (RATE_BOUNDS), then the phase goals
  // are DETERMINISTICALLY re-stamped from it (no LLM): the edited assumptions immediately ripple
  // through every number. Percentages come from the form as whole numbers (2 = 2%).
  updateFunnel: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const data = await request.formData();
      const planId = String(data.get('plan_id') ?? '');
      const pct = (k: string) => Number(data.get(k) ?? '') / 100;
      const spec = clampFunnelSpec({
        final: { metric: String(data.get('final_metric') ?? '').trim(), value: Number(data.get('final_value') ?? '') },
        rates: {
          reach_to_click: pct('reach_to_click_pct'),
          click_to_signup: pct('click_to_signup_pct'),
          signup_to_active: pct('signup_to_active_pct')
        }
      });
      if (!spec) return fail(400, { error: 'invalid_funnel' });

      const { data: row } = await supabase.from('gtm_plans').select(GTM_COLS).eq('id', planId).eq('brand_id', brand.id).eq('status', 'active').maybeSingle();
      if (!row) return fail(404, { error: 'plan_not_found' });
      const current = gtmRowToPlan(row);

      // Re-stamp BOTH horizons from the edited spec — code owns the numbers.
      const phases90d = stampFunnelGoals(phasesForHorizon(current, '90d'), spec);
      const phases6m = stampFunnelGoals(phasesForHorizon(current, '6m'), spec);
      const { error: err } = await supabase
        .from('gtm_plans')
        .update({ funnel: spec, phases: { horizon_90d: phases90d, horizon_6m: phases6m }, updated_at: new Date().toISOString() })
        .eq('id', planId)
        .eq('brand_id', brand.id);
      if (err) return fail(500, { error: err.message });
      return { funnelUpdated: true };
    });
  }
};
