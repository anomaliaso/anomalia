import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import {
  claimIntegrationConnection,
  loadBrandConnections,
  serializeConnection
} from '$lib/server/composio-catalog';
import { kickSourceWork } from '$lib/server/knowledge-sources';

/**
 * POST: check whether the user finished authorizing, and flip the row when they did.
 * Idempotent and safe to poll — the OAuth callback lands in the user's browser, not here.
 */
export const POST: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey, user } = await authenticate(request);
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
    const claimed = await claimIntegrationConnection({
      supabase,
      brandId: brand.id,
      userId: user.id,
      toolkitSlug: String(row.toolkit_slug)
    });
    if (claimed.connected) void kickSourceWork(url.origin);
  } catch (error) { swallow('claim integration connection', error); }
  const rows = await loadBrandConnections(supabase, brand.id).catch((error) => { swallow('load brand connections', error); return []; });
  const fresh = rows.find((r) => r.id === params.id);
  if (!fresh) return json({ error: 'Connection not found' }, { status: 404 });
  return json({ connection: serializeConnection(fresh) });
};
