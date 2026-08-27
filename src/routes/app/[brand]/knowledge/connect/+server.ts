import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { knowledgeConnectorsEnabled, kickSourceWork } from '$lib/server/knowledge-sources';
import {
  claimIntegrationConnection,
  startIntegrationConnectSession
} from '$lib/server/composio-catalog';

export const POST: RequestHandler = async ({ request, params, locals, url }) => {
  if (!knowledgeConnectorsEnabled()) {
    return json({ error: 'Knowledge connectors are not configured' }, { status: 503 });
  }
  const { supabase, safeGetSession } = locals;
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Not authenticated' }, { status: 401 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, slug')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  let body: { action?: string; toolkit?: string; integration?: string; provider?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const toolkitSlug = String(body.toolkit ?? body.integration ?? body.provider ?? '').trim();
  if (!toolkitSlug) {
    return json({ error: 'Unknown integration' }, { status: 400 });
  }

  try {
    if (body.action === 'session') {
      const started = await startIntegrationConnectSession({
        supabase,
        brandId: brand.id,
        brandSlug: brand.slug,
        userId: user.id,
        userEmail: user.email ?? null,
        toolkitSlug,
        // Composio sends the browser here once the user consents; the page then claims.
        callbackUrl: `${url.origin}/app/${brand.slug}/settings/connectors`
      });
      return json({
        ok: true,
        authorizationUrl: started.authorizationUrl,
        connectedAccountId: started.connectedAccountId
      });
    }
    if (body.action === 'claim') {
      const claimed = await claimIntegrationConnection({
        supabase,
        brandId: brand.id,
        userId: user.id,
        toolkitSlug
      });
      if (claimed.connected) {
        void kickSourceWork(url.origin);
        const { syncBrandTriggers } = await import('$lib/server/brand-triggers');
        await syncBrandTriggers(supabase, brand.id).catch((error) => { swallow('sync brand triggers', error); return undefined; });
      }
      return json({ ok: claimed.connected, status: claimed.status });
    }
    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
};
