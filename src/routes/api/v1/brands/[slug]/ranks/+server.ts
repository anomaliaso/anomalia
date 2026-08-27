import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import { loadRankBoard, ensureTrackedSet, checkBrandBatch } from '$lib/server/rank-tracker';

export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  return json({ keywords: await loadRankBoard(createAdminClient(), brand.id) });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient();
  const { data: full } = await admin
    .from('brands')
    .select('id, name, website, plan, content_prefs')
    .eq('id', brand.id)
    .maybeSingle();
  if (!full) return json({ error: 'Brand not found' }, { status: 404 });
  if (Array.isArray(body.keywords) && body.keywords.length) {
    await ensureTrackedSet(admin, full, { keywords: body.keywords.map(String), source: 'manual' });
  }
  if (body.check) {
    const result = await checkBrandBatch(admin, full);
    return json({ ok: true, ...result });
  }
  return json({ keywords: await loadRankBoard(admin, brand.id) });
};
