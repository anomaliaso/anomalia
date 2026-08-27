import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { normalizeToolkitSlug } from '$lib/composio-catalog';
import {
  loadBrandConnections,
  reconcileBrandConnections,
  serializeConnection,
  startIntegrationConnectSession
} from '$lib/server/composio-catalog';
import { knowledgeConnectorsEnabled } from '$lib/server/knowledge-sources';

// GET: apps connected to this brand (social accounts live elsewhere; these are tool connections).
export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  // Composio is the source of truth: reconcile before answering so the CLI never shows a
  // connection that was revoked at the provider, or misses one made in the browser.
  await reconcileBrandConnections(supabase, brand.id).catch((error) => { swallow('reconcile connections', error); return undefined; });
  const rows = await loadBrandConnections(supabase, brand.id).catch((error) => { swallow('load brand connections', error); return []; });
  return json({ connections: rows.map(serializeConnection) });
};

// POST: start connecting an app. Returns the URL the user opens; poll /complete afterwards.
export const POST: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey, user } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;
  if (!knowledgeConnectorsEnabled()) {
    return json({ error: 'Connectors are not configured on this environment' }, { status: 503 });
  }

  let body: { provider?: string; toolkit?: string; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const toolkitSlug = normalizeToolkitSlug(String(body.toolkit ?? body.provider ?? ''));
  if (!toolkitSlug) return json({ error: 'Missing provider' }, { status: 400 });

  try {
    const started = await startIntegrationConnectSession({
      supabase,
      brandId: brand.id,
      brandSlug: brand.slug,
      userId: user.id,
      userEmail: user.email ?? null,
      toolkitSlug,
      callbackUrl: `${url.origin}/app/${brand.slug}/settings/connectors`
    });
    const rows = await loadBrandConnections(supabase, brand.id).catch((error) => { swallow('load brand connections', error); return []; });
    const row = rows.find((r) => r.toolkit_slug === toolkitSlug);
    return json({
      connection_id: row?.id ?? started.connectedAccountId,
      authorization_url: started.authorizationUrl
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
