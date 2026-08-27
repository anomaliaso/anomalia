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
  const { objective, phase_index, phase_name, phase_objective, platform_weights, pillars } = body;

  const { data: gtm } = await supabase
    .from('gtm_plans').select('*')
    .eq('brand_id', brand.id).eq('status', 'active').maybeSingle();

  if (!gtm) return json({ error: 'No active GTM plan' }, { status: 404 });

  const updates: Record<string, unknown> = {};
  if (objective !== undefined) updates.objective = objective;

  // Update specific phase
  if (phase_index !== undefined) {
    const phases = [...(gtm.phases as unknown[])] as Record<string, unknown>[];
    if (phase_index >= 0 && phase_index < phases.length) {
      if (phase_name !== undefined) phases[phase_index].name = phase_name;
      if (phase_objective !== undefined) phases[phase_index].objective = phase_objective;
      if (platform_weights !== undefined) phases[phase_index].platform_weights = platform_weights;
      if (pillars !== undefined) phases[phase_index].pillars = pillars;
      updates.phases = phases;
    }
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from('gtm_plans').update(updates).eq('id', gtm.id);

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true });
};
