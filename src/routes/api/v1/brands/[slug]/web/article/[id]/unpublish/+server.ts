import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';

// POST — take the article back to draft. Costs nothing: write scope is enough.
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  // brand_articles is SELECT-only under RLS — status changes go through the admin client.
  const { error: updateError } = await createAdminClient()
    .from('brand_articles')
    .update({ status: 'draft', published_at: null })
    .eq('id', params.id)
    .eq('brand_id', brand.id);
  if (updateError) return json({ error: updateError.message }, { status: 500 });

  return json({ ok: true, status: 'draft' });
};
