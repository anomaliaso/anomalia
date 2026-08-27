import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { genaiClient } from '$lib/server/brand-context';
import { cadenceAllowed, loadActivePlan, revisePlan } from '$lib/server/editorial-plan';
import { activeGtmBrief } from '$lib/server/gtm';
import { localeLanguageName } from '$lib/i18n/locale';
import { plannerProfile, planEvidence } from '$lib/server/planner-inputs';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const { feedback } = await request.json();
  if (!feedback) return json({ error: 'feedback is required' }, { status: 400 });

  try {
    const current = await loadActivePlan(supabase, brand.id);
    if (!current) return json({ error: 'no active editorial plan' }, { status: 404 });

    const [profile, evidence, gtmBrief] = await Promise.all([
      plannerProfile(supabase, brand),
      planEvidence(supabase, brand.id),
      activeGtmBrief(supabase, brand.id, brand.timezone).catch((error) => { swallow('load gtm brief', error); return ''; })
    ]);

    const revised = await revisePlan(genaiClient(), current, feedback, profile, {
      platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
      allowedCadences: cadenceAllowed(brand.plan),
      outputLanguage: localeLanguageName(null),
      strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
      benchmark: evidence.benchmark,
      topPosts: evidence.topPosts,
      supabase,
      brandId: brand.id,
      planTier: brand.plan,
      timezone: brand.timezone
    });

    await supabase.from('editorial_plans').update({ status: 'rejected' }).eq('brand_id', brand.id).eq('status', 'proposed');
    const { data: row, error: insertErr } = await supabase
      .from('editorial_plans')
      .insert({
        brand_id: brand.id,
        status: 'proposed',
        strategy: revised.strategy || null,
        voice: revised.voice,
        cadence: revised.cadence,
        platform_mix: revised.platform_mix,
        gtm: revised.gtm,
        weeks: revised.weeks,
        changes_summary: revised.changes_summary ?? null,
        source: 'manual'
      })
      .select('id')
      .single();
    if (insertErr) return json({ error: insertErr.message }, { status: 500 });

    return json({ ok: true, plan_id: row?.id, plan: revised });
  } catch (e) {
    return json({ error: `Revise failed: ${String(e)}` }, { status: 500 });
  }
};
