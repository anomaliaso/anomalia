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

  const { week_index, brief, products } = await request.json();
  if (week_index === undefined) return json({ error: 'week_index is required' }, { status: 400 });

  // Load active plan
  const { data: plan } = await supabase
    .from('editorial_plans').select('*')
    .eq('brand_id', brand.id).eq('status', 'active').maybeSingle();

  if (!plan) return json({ error: 'No active editorial plan' }, { status: 404 });

  const weeks = [...(plan.weeks as unknown[])] as Record<string, unknown>[];
  if (week_index < 0 || week_index >= weeks.length) {
    return json({ error: 'Invalid week_index' }, { status: 400 });
  }

  weeks[week_index].brief = brief ?? null;
  if (products !== undefined) {
    weeks[week_index].products = Array.isArray(products) ? products : null;
  }

  const { error: updateError } = await supabase
    .from('editorial_plans')
    .update({ weeks })
    .eq('id', plan.id);

  if (updateError) return json({ error: updateError.message }, { status: 500 });
  return json({ ok: true });
};
