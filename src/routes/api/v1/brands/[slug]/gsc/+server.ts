import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import { loadGscSummary, syncGscMetrics } from '$lib/server/gsc';

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  return json(await loadGscSummary(createAdminClient(), brand.id));
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  try {
    const result = await syncGscMetrics(createAdminClient(), brand.id, { days: 3 });
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Sync failed' }, { status: 502 });
  }
};
