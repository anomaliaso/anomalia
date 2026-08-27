import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { searchCatalog } from '$lib/composio-catalog';
import { loadConnectorCatalog } from '$lib/server/composio-catalog';

// GET: apps this brand can connect, each flagged as already connected.
export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const [{ items, error: catalogError }, { data: rows }] = await Promise.all([
    loadConnectorCatalog(),
    supabase
      .from('brand_app_connections')
      .select('toolkit_slug, status')
      .eq('brand_id', brand.id)
      .eq('status', 'active')
  ]);
  const connected = new Set((rows ?? []).map((r) => String(r.toolkit_slug)));
  const query = url.searchParams.get('query') ?? '';
  const visible = searchCatalog(items, query);
  return json({
    error: catalogError,
    apps: visible.map((item) => ({
      provider: item.toolkitSlug,
      name: item.displayName,
      logo: item.logo,
      connected: connected.has(item.toolkitSlug),
      managed_auth: item.managedAuth,
      category: item.kind === 'app' ? 'knowledge' : 'tools'
    }))
  });
};
