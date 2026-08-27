import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { disconnectIntegration } from '$lib/server/composio-catalog';

// DELETE: revoke one connection (id from GET /connections).
export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const { data: row } = await supabase
    .from('brand_app_connections')
    .select('id, toolkit_slug')
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (!row) return json({ error: 'Connection not found' }, { status: 404 });

  try {
    await disconnectIntegration({
      supabase,
      brandId: brand.id,
      toolkitSlug: String(row.toolkit_slug)
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
