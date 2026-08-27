import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json();
  const { voice, cadence, platform_mix, week_index, week_theme, week_brief } = body;

  // Load active plan
  const { data: plan } = await supabase
    .from('editorial_plans').select('*')
    .eq('brand_id', brand.id).eq('status', 'active').maybeSingle();

  if (!plan) return json({ error: 'No active editorial plan' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (voice !== undefined) updates.voice = voice;
  if (cadence !== undefined) updates.cadence = cadence;
  if (platform_mix !== undefined) updates.platform_mix = platform_mix;

  // Update specific week
  if (week_index !== undefined) {
    const weeks = [...(plan.weeks as unknown[])] as Record<string, unknown>[];
    if (week_index >= 0 && week_index < weeks.length) {
      if (week_theme !== undefined) weeks[week_index].theme = week_theme;
      if (week_brief !== undefined) weeks[week_index].brief = week_brief;
      updates.weeks = weeks;
    }
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('editorial_plans').update(updates).eq('id', plan.id);

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true });
};
