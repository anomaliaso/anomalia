import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';

// DELETE — remove the article. Costs nothing: write scope is enough.
export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  // brand_articles is SELECT-only under RLS — deletes go through the admin client.
  const { error: deleteError } = await createAdminClient()
    .from('brand_articles')
    .delete()
    .eq('id', params.id)
    .eq('brand_id', brand.id);
  if (deleteError) return json({ error: deleteError.message }, { status: 500 });

  return json({ ok: true });
};
