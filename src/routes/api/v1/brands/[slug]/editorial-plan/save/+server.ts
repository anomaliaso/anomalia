import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { cadenceAllowed, normalizePlan, saveProposedPlan } from '$lib/server/editorial-plan';
import { appOrigin } from '$lib/server/app-url';
import { SAVE_PLAN, statusForFailure } from '@anomalia/api-contracts';

export const POST: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = SAVE_PLAN.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(
      { error: 'invalid_input', details: parsed.error.issues },
      { status: statusForFailure(SAVE_PLAN, 'invalid_input') }
    );
  }

  const plan = normalizePlan(parsed.data, cadenceAllowed(brand.plan));
  const saved = await saveProposedPlan(supabase, brand.id, plan);
  if (!saved.ok) {
    return json({ error: saved.error, details: saved.message }, { status: statusForFailure(SAVE_PLAN, saved.error) });
  }

  return json({
    ok: true,
    plan_id: saved.id,
    status: 'proposed',
    weeks: plan.weeks.length,
    review_url: `${appOrigin(url)}/app/${brand.slug}/editorial`
  });
};
