import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canEnter } from '$lib/server/access';
import { strategyBriefFromReport, type Benchmark, type StrategyReport } from '$lib/server/research';
import { rankRecentWinners } from '$lib/server/scheduler';
import { proposeGtm, activateGtm, gtmRowToPlan, activeGtmBrief } from '$lib/server/gtm';
import {
  deriveOperationalStrategy,
  rulesToInstructions,
  type PlatformRule,
  type VoiceFramework
} from '$lib/server/operational-strategy';
import { loadActivePlan, currentWeekIndex, weekStrategyBrief, postsForWeek } from '$lib/server/editorial-plan';
import { planWeekStrategy, type ContentPrefs, type PastWinner } from '$lib/server/content-preview';
import { ensureBrandHistory } from '$lib/server/scrapecreators';
import { localeLanguageName } from '$lib/i18n/locale';
import { withBrandContext } from '$lib/server/ai-log';

// POST-PAYMENT AUTOMATIC SETUP. As soon as a brand activates, a blocking dialog walks the owner
// through Anomalia building the full strategy stack on its own:
//   step 'gtm'   → a default 6-MONTH growth roadmap, generated AND activated (the dialog shows it;
//                  the user can always redirect it later on /gtm — propose→approve still rules
//                  every future change, this is the starting proposal made live).
//   step 'voice' → the operational strategy DERIVED from the Studio (voice framework + platform
//                  rules), so /voice 'Auto' shows real values instead of empty fields.
//   step 'week'  → the week-1 editorial rows: the onboarding posts already produced count toward
//                  the week's budget; Anomalia drafts the REMAINING rows for review on /plan.
//   step 'finish'→ stamps setup_completed_at; the dialog never shows again.
// Every step is IDEMPOTENT (skips what already exists) so closing the browser and coming back
// resumes cleanly from brands.setup_step.

export const config = { maxDuration: 300 };

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  timezone: string;
  target_platforms: unknown;
  content_prefs: unknown;
  setup_step: number;
};

async function loadBrand(supabase: SupabaseClient, slug: string): Promise<BrandRow | null> {
  const { data } = await supabase
    .from('brands')
    .select('id, name, slug, plan, timezone, target_platforms, content_prefs, setup_step')
    .eq('slug', slug)
    .maybeSingle();
  return (data as BrandRow | null) ?? null;
}

async function bumpStep(supabase: SupabaseClient, brandId: string, step: number) {
  await supabase.from('brands').update({ setup_step: step }).eq('id', brandId).lt('setup_step', step);
}

const gtmSummary = (plan: { objective?: string | null; horizon?: string; phases: unknown[] }) => ({
  objective: plan.objective ?? '',
  horizon: plan.horizon ?? '6m',
  phases: (plan.phases as Record<string, unknown>[]).map((p) => ({
    name: p.name,
    objective: p.objective,
    duration_weeks: p.duration_weeks,
    platform_weights: p.platform_weights,
    pillars: p.pillars
  }))
});

export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession, locale } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return json({ error: 'unauthorized' }, { status: 401 });
  if (!(await canEnter(supabase))) return json({ error: 'forbidden' }, { status: 403 });

  const brand = await loadBrand(supabase, params.brand);
  if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

  return withBrandContext(brand.id, async () => {
  const body = await request.json().catch(() => ({}));
  const step = String(body?.step ?? '');
  const platforms = Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [];
  const outputLanguage = localeLanguageName(locale);

  // ---- STEP 1: default 6-month GTM roadmap, generated and made active ----
  if (step === 'gtm') {
    const { data: existing } = await supabase
      .from('gtm_plans')
      .select('id, status, horizon, objective, phases')
      .eq('brand_id', brand.id)
      .eq('status', 'active')
      .maybeSingle();
    if (existing) {
      await bumpStep(supabase, brand.id, 1);
      return json({ skipped: true, gtm: gtmSummary(gtmRowToPlan(existing)) });
    }

    // Materialize social history first — an established brand must never be judged 0→1.
    await ensureBrandHistory(supabase, brand.id);
    const [{ data: kit }, { data: strategy }, { data: history }] = await Promise.all([
      supabase
        .from('brand_kit')
        .select('category, about, target_audience, ai_context, site_type, content_pillars')
        .eq('brand_id', brand.id)
        .maybeSingle(),
      supabase.from('brand_strategy').select('report, benchmark').eq('brand_id', brand.id).maybeSingle(),
      supabase.from('social_post_history').select('content, platform, metrics, published_at').eq('brand_id', brand.id).limit(200)
    ]);
    const report = (strategy?.report as StrategyReport | null) ?? null;
    const profile = {
      name: brand.name,
      category: kit?.category ?? '',
      about: kit?.about ?? '',
      target_audience: kit?.target_audience ?? '',
      ai_context: [kit?.ai_context ?? '', report ? strategyBriefFromReport(report) : ''].filter(Boolean).join('\n\n'),
      site_type: kit?.site_type ?? 'generic',
      content_pillars: kit?.content_pillars ?? []
    };

    const plan = await proposeGtm(profile, {
      horizon: '6m',
      objective: '',
      platforms,
      outputLanguage,
      benchmark: (strategy?.benchmark as Benchmark | null) ?? null,
      topPosts: rankRecentWinners(history ?? []),
      zeroToOne: (history ?? []).length < 10
    });

    // Clear any stale proposal first — the setup's roadmap goes live, so an older pending
    // "Rotta proposta" must not linger on /gtm next to the freshly activated plan.
    await supabase.from('gtm_plans').update({ status: 'rejected' }).eq('brand_id', brand.id).eq('status', 'proposed');
    const { data: inserted, error: insErr } = await supabase
      .from('gtm_plans')
      .insert({
        brand_id: brand.id,
        status: 'proposed',
        horizon: plan.horizon,
        objective: plan.objective || null,
        phases: plan.phases,
        funnel: plan.funnel ?? null,
        source: 'manual'
      })
      .select('id')
      .single();
    if (insErr || !inserted) return json({ error: insErr?.message ?? 'gtm_insert_failed' }, { status: 500 });
    await activateGtm(supabase, brand.id, inserted.id as string, brand.timezone);
    await bumpStep(supabase, brand.id, 1);
    return json({ gtm: gtmSummary(plan) });
  }

  // ---- STEP 2: operational strategy derived from the Studio (visible 'Auto') ----
  if (step === 'voice') {
    const prefs = ((brand.content_prefs as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    const existingVf = prefs.voiceFramework as VoiceFramework | undefined;
    if (existingVf?.purpose) {
      await bumpStep(supabase, brand.id, 2);
      return json({ skipped: true, voice: existingVf, rules: (prefs.platformRules as Record<string, PlatformRule>) ?? {} });
    }

    const { data: kit } = await supabase
      .from('brand_kit')
      .select('category, about, target_audience, ai_context')
      .eq('brand_id', brand.id)
      .maybeSingle();
    const { voiceFramework, platformRules } = await deriveOperationalStrategy(
      { name: brand.name, category: kit?.category ?? '', about: kit?.about ?? '', target_audience: kit?.target_audience ?? '', ai_context: kit?.ai_context ?? '' },
      platforms,
      outputLanguage
    );

    const { error: upErr } = await supabase
      .from('brands')
      .update({
        content_prefs: {
          ...prefs,
          voiceMode: 'auto',
          voiceFramework,
          platformRules,
          platformInstructions: { ...((prefs.platformInstructions as Record<string, string>) ?? {}), ...rulesToInstructions(platformRules) }
        }
      })
      .eq('id', brand.id);
    if (upErr) return json({ error: upErr.message }, { status: 500 });
    await bumpStep(supabase, brand.id, 2);
    return json({ voice: voiceFramework, rules: platformRules });
  }

  // ---- STEP 3: week-1 editorial rows (onboarding posts + the remaining planned ones) ----
  if (step === 'week') {
    const editorialPlan = await loadActivePlan(supabase, brand.id);
    if (!editorialPlan) {
      // Edge: activation without an onboarding plan (legacy path) — the dialog points to /strategy.
      await bumpStep(supabase, brand.id, 3);
      return json({ noPlan: true });
    }
    const weekIdx = currentWeekIndex(editorialPlan, brand.timezone) ?? 0;

    // Idempotent: an existing draft is THE week plan — just show it.
    const { data: draftRows } = await supabase
      .from('content_plans')
      .select('id, seeds')
      .eq('brand_id', brand.id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1);
    if (draftRows?.[0]?.seeds) {
      await bumpStep(supabase, brand.id, 3);
      const seeds = (draftRows[0].seeds as { seeds?: unknown[] })?.seeds ?? [];
      return json({ existing: true, week: weekIdx, rows: seeds, produced: 0 });
    }

    // Posts already produced for this editorial week (the 3 onboarding previews) count toward
    // the week's approved budget; Anomalia only drafts the remainder.
    const { data: weekPlans } = await supabase
      .from('content_plans')
      .select('id')
      .eq('brand_id', brand.id)
      .eq('editorial_plan_id', editorialPlan.id ?? '')
      .eq('editorial_week', weekIdx);
    const planIds = (weekPlans ?? []).map((p) => p.id);
    let produced: { caption: string | null; platform: string | null }[] = [];
    if (planIds.length) {
      const { data: posts } = await supabase.from('posts').select('caption, platform').in('plan_id', planIds).limit(30);
      produced = posts ?? [];
    }
    const desired = Math.max(0, postsForWeek(editorialPlan, weekIdx) - produced.length);
    if (desired === 0) {
      await bumpStep(supabase, brand.id, 3);
      return json({ week: weekIdx, rows: [], produced: produced.length });
    }

    // Same profile assembly as the manual generate endpoint (stored data only, no re-analysis).
    const [{ data: kit }, { data: products }, { data: history }] = await Promise.all([
      supabase
        .from('brand_kit')
        .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style')
        .eq('brand_id', brand.id)
        .maybeSingle(),
      supabase.from('products').select('title, description, pricing, images').eq('brand_id', brand.id).order('created_at', { ascending: true }).limit(12),
      supabase.from('social_post_history').select('content, platform, metrics').eq('brand_id', brand.id).limit(200)
    ]);
    const profile = {
      name: brand.name,
      category: kit?.category ?? '',
      about: kit?.about ?? '',
      target_audience: kit?.target_audience ?? '',
      brand_colors: kit?.brand_colors ?? [],
      ai_character: kit?.ai_character ?? {},
      ai_context: kit?.ai_context ?? '',
      visual_style: kit?.visual_style ?? '',
      products: (products ?? []).map((p) => ({ name: p.title, description: p.description, pricing: p.pricing, images: p.images }))
    };
    const topPosts: PastWinner[] = [...(history ?? [])]
      .sort((a, b) => ((b.metrics as PastWinner['metrics'])?.engagementRate ?? 0) - ((a.metrics as PastWinner['metrics'])?.engagementRate ?? 0))
      .slice(0, 8);

    const prefs = (brand.content_prefs as ContentPrefs) ?? {};
    const gtmBrief = await activeGtmBrief(supabase, brand.id, brand.timezone);
    const alreadyPlanned = produced.length
      ? `\nALREADY PUBLISHED/QUEUED THIS WEEK (do NOT duplicate their angles): ${produced
          .map((p) => `[${p.platform}] ${(p.caption ?? '').slice(0, 90)}`)
          .join(' · ')}`
      : '';
    const strategyBrief = [gtmBrief, weekStrategyBrief(editorialPlan, weekIdx) + alreadyPlanned].filter(Boolean).join('\n\n');

    const strategy = await planWeekStrategy(profile, { platforms, prefs, maxVideos: 1, topPosts, strategyBrief }, desired);
    // 'manual_trigger' source: the tick's draft-age clause only auto-produces 'scheduled_cron'
    // drafts — this one waits for the user's approval on /plan, as the dialog explains.
    const { error: draftErr } = await supabase.from('content_plans').insert({
      brand_id: brand.id,
      title: `Setup · settimana ${weekIdx + 1}`,
      source: 'manual_trigger',
      status: 'draft',
      seeds: strategy,
      editorial_plan_id: editorialPlan.id ?? null,
      editorial_week: weekIdx
    });
    if (draftErr) return json({ error: draftErr.message }, { status: 500 });
    await bumpStep(supabase, brand.id, 3);
    return json({ week: weekIdx, rows: strategy.seeds, theme: strategy.theme, produced: produced.length });
  }

  // ---- STEP 4: done ----
  if (step === 'finish') {
    await supabase
      .from('brands')
      .update({ setup_completed_at: new Date().toISOString(), setup_step: 4 })
      .eq('id', brand.id);
    return json({ done: true });
  }

  return json({ error: 'unknown_step' }, { status: 400 });
  });
};
