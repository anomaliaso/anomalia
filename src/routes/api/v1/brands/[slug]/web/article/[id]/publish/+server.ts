import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';

// POST — put the article live. Costs nothing: write scope is enough, no plan or credits gate.
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  // brand_articles is SELECT-only under RLS — status changes go through the admin client.
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from('brand_articles')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('brand_id', brand.id);
  if (updateError) return json({ error: updateError.message }, { status: 500 });

  // Instant indexing on manual publish: IndexNow + Exa, fire-and-forget.
  const { data: article } = await admin
    .from('brand_articles')
    .select('slug')
    .eq('id', params.id)
    .maybeSingle();
  if (article?.slug) {
    const { notifyIndexers } = await import('$lib/server/indexing');
    void notifyIndexers(admin, brand.id, [article.slug]).catch(swallow('notify indexers'));
  }

  return json({ ok: true, status: 'published' });
};
