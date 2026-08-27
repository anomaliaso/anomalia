import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { proposeFirstPlan } from '$lib/server/planner-inputs';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  try {
    const result = await proposeFirstPlan(supabase, brand, null);
    return json({ ok: true, plan_id: result.id });
  } catch (e) {
    return json({ error: `Propose failed: ${String(e)}` }, { status: 500 });
  }
};
