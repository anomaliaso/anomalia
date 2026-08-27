import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { createAdminClient } from '$lib/server/supabase-admin';
import { genaiClient } from '$lib/server/brand-context';
import { plannerProfile, planEvidence } from '$lib/server/planner-inputs';
import { proposeGtmDual, gtmPhaseBrief, type GtmPlan } from '$lib/server/gtm';
import { proposePlan, cadenceAllowed } from '$lib/server/editorial-plan';
import { localeLanguageName } from '$lib/i18n/locale';

// ── DEV-ONLY strategy lab ──────────────────────────────────────────────────
// Runs the agent's real generation path for ONE brand ONCE, WITHOUT persisting
// anything: GTM roadmap (proposeGtmDual) → editorial plan / weekly content
// calendar (proposePlan), fed by the same profile + evidence the production
// flow uses. Meant to be hit N times by scripts/run-strategy-lab.mjs so the
// output can be inspected for prompt/harness tuning.
//
// GET /api/v1/brands/<slug>/strategy-lab?locale=it
// No auth (localhost dev only). Delete this route when done tuning.

export const GET: RequestHandler = async ({ params, url }) => {
  if (!dev) return json({ error: 'strategy-lab is dev-only' }, { status: 403 });

  const locale = url.searchParams.get('locale') || 'it';
  const t0 = Date.now();
  const supabase = createAdminClient();

  const { data: brand, error: brandErr } = await supabase
    .from('brands')
    .select('id, name, slug, plan, timezone, target_platforms')
    .eq('slug', params.slug)
    .maybeSingle();
  if (brandErr || !brand) return json({ error: 'Brand not found' }, { status: 404 });

  try {
    const ai = genaiClient();

    // Inputs — identical shape to the production propose paths.
    const [profile, evidence] = await Promise.all([
      plannerProfile(supabase, { id: brand.id, name: brand.name }),
      planEvidence(supabase, brand.id)
    ]);
    const platforms = Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [];
    const outputLanguage = localeLanguageName(locale);
    const zeroToOne = evidence.historyCount < 10;

    // 1) STRATEGY — GTM roadmap (dual horizon, best-of-N internally).
    const tGtm = Date.now();
    const gtm: GtmPlan = await proposeGtmDual(ai, profile, {
      platforms,
      outputLanguage,
      benchmark: evidence.benchmark,
      topPosts: evidence.topPosts,
      zeroToOne
    });
    const gtmMs = Date.now() - tGtm;

    // Feed the fresh GTM's tactical (90d) phase-1 brief into the plan, exactly like
    // the real flow feeds the ACTIVE gtm brief — keeps strategy → calendar coherent.
    const gtm90d = { ...gtm, phases: gtm.phases_90d ?? gtm.phases };
    const gtmBrief = gtmPhaseBrief(gtm90d, 0);

    // 2) EDITORIAL PLAN — strategy statement + voice + platform mix + weekly content calendar.
    const tPlan = Date.now();
    const plan = await proposePlan(ai, profile, {
      platforms,
      allowedCadences: cadenceAllowed(brand.plan),
      outputLanguage,
      strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
      benchmark: evidence.benchmark,
      topPosts: evidence.topPosts,
      zeroToOne,
      supabase,
      brandId: brand.id,
      planTier: brand.plan,
      timezone: brand.timezone
    });
    const planMs = Date.now() - tPlan;

    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      brand: { slug: brand.slug, name: brand.name, plan: brand.plan, platforms },
      inputs: {
        outputLanguage,
        zeroToOne,
        historyCount: evidence.historyCount,
        hasBenchmark: !!evidence.benchmark,
        topPostsCount: evidence.topPosts?.length ?? 0,
        strategyBriefChars: (evidence.strategyBrief ?? '').length
      },
      timingsMs: { gtm: gtmMs, plan: planMs, total: Date.now() - t0 },
      gtm: { objective: gtm.objective, phases_90d: gtm.phases_90d, phases_6m: gtm.phases_6m },
      plan
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.stack ?? e.message : e) }, { status: 500 });
  }
};
