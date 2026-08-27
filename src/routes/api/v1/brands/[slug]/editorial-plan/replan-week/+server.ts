import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { genaiClient } from '$lib/server/brand-context';
import { cadenceAllowed, loadActivePlan, replanWeek } from '$lib/server/editorial-plan';
import { localeLanguageName } from '$lib/i18n/locale';
import { plannerProfile, planEvidence } from '$lib/server/planner-inputs';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const { week_index, brief } = await request.json();
  if (week_index === undefined) return json({ error: 'week_index is required' }, { status: 400 });
  if (!brief) return json({ error: 'brief is required' }, { status: 400 });

  try {
    const plan = await loadActivePlan(supabase, brand.id);
    if (!plan?.id) return json({ error: 'no active editorial plan' }, { status: 404 });
    if (!plan.weeks[week_index]) return json({ error: 'invalid week_index' }, { status: 400 });

    const [profile, evidence] = await Promise.all([
      plannerProfile(supabase, brand),
      planEvidence(supabase, brand.id)
    ]);

    const week = await replanWeek(genaiClient(), plan, week_index, brief, profile, localeLanguageName(null), {
      platforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
      allowedCadences: cadenceAllowed(brand.plan),
      benchmark: evidence.benchmark,
      topPosts: evidence.topPosts,
      supabase,
      brandId: brand.id,
      planTier: brand.plan
    });

    const weeks = plan.weeks.map((w, i) => (i === week_index ? week : w));
    const { error: updateErr } = await supabase
      .from('editorial_plans')
      .update({ weeks, updated_at: new Date().toISOString() })
      .eq('id', plan.id)
      .eq('brand_id', brand.id);
    if (updateErr) return json({ error: updateErr.message }, { status: 500 });

    return json({ ok: true, week: week_index });
  } catch (e) {
    return json({ error: `Replan failed: ${String(e)}` }, { status: 500 });
  }
};
