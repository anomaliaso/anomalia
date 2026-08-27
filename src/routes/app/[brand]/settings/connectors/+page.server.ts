import { swallow } from '$lib/server/swallow';
import { error, fail } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actions, PageServerLoad } from './$types';
import { isKnowledgeProvider } from '$lib/knowledge-providers';
import { createAdminClient } from '$lib/server/supabase-admin';
import { gscConfigured, loadGscSummary } from '$lib/server/gsc';
import {
  kickSourceWork,
  knowledgeConnectorsEnabled,
  listGithubReposForBrand,
  listNotionPagesForBrand,
  loadKnowledgeSources,
  requestSourceSync,
  saveDriveFolders,
  saveGithubRepos,
  saveNotionPages
} from '$lib/server/knowledge-sources';
import {
  loadBrandWebhook,
  newWebhookSecret,
  validateWebhookUrl,
  WEBHOOK_COLUMNS
} from '$lib/server/brand-webhooks';
import { loadBrandTriggers, syncBrandTriggers } from '$lib/server/brand-triggers';
import {
  disconnectIntegration,
  loadBrandConnections,
  loadConnectorCatalog,
  reconcileBrandConnections
} from '$lib/server/composio-catalog';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand, flags } = await parent();
  // FEATURE_CONNECTORS=false hides the nav entry — the route has to 404 too, or the URL still works.
  if (flags?.connectors === false) throw error(404, 'Not found');
  const admin = createAdminClient();
  // The rows are a mirror of Composio: reconcile before reading so a connection made elsewhere
  // (CLI, another browser) or revoked at the provider shows its real state on this page.
  await reconcileBrandConnections(admin, brand.id).catch((error) => { swallow('reconcile connections', error); return undefined; });
  const connections = await loadBrandConnections(supabase, brand.id).catch((error) => { swallow('load brand connections', error); return []; });
  const [webhook, triggers] = await Promise.all([
    loadBrandWebhook(supabase, brand.id).catch((error) => { swallow('load brand webhook', error); return null; }),
    loadBrandTriggers(supabase, brand.id).catch((error) => { swallow('load brand triggers', error); return []; })
  ]);
  const [sources, gsc, catalog] = await Promise.all([
    loadKnowledgeSources(supabase, brand.id).catch((error) => { swallow('load knowledge sources', error); return []; }),
    loadGscSummary(admin, brand.id).catch((error) => { swallow('load gsc summary', error); return null; }),
    // Whatever this brand already connected stays listed, connectable-by-default or not.
    loadConnectorCatalog(connections.map((c) => c.toolkit_slug))
  ]);
  const githubConnected = sources.some((s) => s.provider === 'github');
  const notionConnected = sources.some((s) => s.provider === 'notion');
  const [githubList, notionList] = await Promise.all([
    githubConnected ? listGithubReposForBrand(supabase, brand.id) : { repos: [], error: null },
    notionConnected ? listNotionPagesForBrand(supabase, brand.id) : { pages: [], error: null }
  ]);
  return {
    sources,
    connections,
    // The secret is never re-served: it is shown once, at creation, in the action result.
    webhook: webhook
      ? {
          url: webhook.url,
          status: webhook.status,
          failure_count: webhook.failure_count,
          last_delivery_at: webhook.last_delivery_at,
          last_error: webhook.last_error
        }
      : null,
    triggers: triggers.map((t) => ({ trigger: t.trigger_slug, config: t.config })),
    catalog: catalog.items,
    catalogError: catalog.error,
    connectorsConfigured: knowledgeConnectorsEnabled(),
    githubRepos: githubList.repos,
    githubReposError: githubList.error,
    notionPages: notionList.pages,
    notionPagesError: notionList.error,
    gsc: {
      configured: gsc?.configured ?? gscConfigured(),
      connected: gsc?.connected ?? false,
      siteUrl: gsc?.siteUrl ?? null
    }
  };
};

async function brandIdForSlug(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const { data } = await supabase.from('brands').select('id').eq('slug', slug).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export const actions: Actions = {
  disconnectSource: async ({ request, params, locals: { supabase } }) => {
    const brandId = await brandIdForSlug(supabase, params.brand);
    if (!brandId) return fail(404, { error: 'Brand not found' });
    const form = await request.formData();
    const toolkitSlug = String(form.get('integration') ?? form.get('provider') ?? '').trim();
    if (!toolkitSlug) return fail(400, { error: 'Unknown integration' });
    try {
      await disconnectIntegration({ supabase, brandId, toolkitSlug });
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : String(e) });
    }
    return { disconnected: true };
  },

  saveWebhook: async ({ request, params, locals: { supabase }, locals }) => {
    const brandId = await brandIdForSlug(supabase, params.brand);
    if (!brandId) return fail(404, { error: 'Brand not found' });
    const { user } = await locals.safeGetSession();
    const form = await request.formData();
    const validated = validateWebhookUrl(String(form.get('url') ?? ''));
    if (!validated.ok) return fail(400, { error: validated.error });

    const existing = await loadBrandWebhook(supabase, brandId).catch((error) => { swallow('load brand webhook', error); return null; });
    const rotate = form.get('rotate') === 'on';
    const secret = existing && !rotate ? null : newWebhookSecret();
    const now = new Date().toISOString();
    const { error: writeError } = existing
      ? await supabase
          .from('brand_webhooks')
          .update({
            url: validated.url,
            status: 'active',
            failure_count: 0,
            last_error: null,
            ...(secret ? { secret } : {}),
            updated_at: now
          })
          .eq('id', existing.id)
          .select(WEBHOOK_COLUMNS)
          .single()
      : await supabase
          .from('brand_webhooks')
          .insert({
            brand_id: brandId,
            url: validated.url,
            secret,
            created_by: user?.id ?? null,
            updated_at: now
          })
          .select(WEBHOOK_COLUMNS)
          .single();
    if (writeError) return fail(400, { error: writeError.message });

    await syncBrandTriggers(supabase, brandId).catch((error) => { swallow('sync brand triggers', error); return undefined; });
    // Shown once, right here: we cannot serve it again.
    return { webhookSaved: true, secret };
  },

  deleteWebhook: async ({ params, locals: { supabase } }) => {
    const brandId = await brandIdForSlug(supabase, params.brand);
    if (!brandId) return fail(404, { error: 'Brand not found' });
    await supabase.from('brand_webhooks').delete().eq('brand_id', brandId);
    await syncBrandTriggers(supabase, brandId).catch((error) => { swallow('sync brand triggers', error); return undefined; });
    return { webhookRemoved: true };
  },

  syncSource: async ({ request, params, locals: { supabase }, url }) => {
    const brandId = await brandIdForSlug(supabase, params.brand);
    if (!brandId) return fail(404, { error: 'Brand not found' });
    const provider = String((await request.formData()).get('provider') ?? '');
    if (!isKnowledgeProvider(provider)) return fail(400, { error: 'Unknown provider' });
    try {
      await requestSourceSync(supabase, brandId, provider);
      void kickSourceWork(url.origin);
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : String(e) });
    }
    return { queued: true };
  },

  saveGithubRepos: async ({ request, params, locals: { supabase }, url }) => {
    const brandId = await brandIdForSlug(supabase, params.brand);
    if (!brandId) return fail(404, { error: 'Brand not found' });
    const repos = (await request.formData()).getAll('repos').map(String);
    try {
      await saveGithubRepos(supabase, brandId, repos);
      // The repos a brand watches are exactly the triggers it should have.
      const { syncBrandTriggers } = await import('$lib/server/brand-triggers');
      await syncBrandTriggers(supabase, brandId).catch((error) => { swallow('sync brand triggers', error); return undefined; });
      void kickSourceWork(url.origin);
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : String(e) });
    }
    return { saved: true };
  },

  saveDriveFolders: async ({ request, params, locals: { supabase }, url }) => {
    const brandId = await brandIdForSlug(supabase, params.brand);
    if (!brandId) return fail(404, { error: 'Brand not found' });
    const folders = (await request.formData()).getAll('folders').map(String);
    try {
      await saveDriveFolders(supabase, brandId, folders);
      void kickSourceWork(url.origin);
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : String(e) });
    }
    return { saved: true };
  },

  saveNotionPages: async ({ request, params, locals: { supabase }, url }) => {
    const brandId = await brandIdForSlug(supabase, params.brand);
    if (!brandId) return fail(404, { error: 'Brand not found' });
    const pages = (await request.formData()).getAll('pages').map(String);
    try {
      await saveNotionPages(supabase, brandId, pages);
      void kickSourceWork(url.origin);
    } catch (e) {
      return fail(400, { error: e instanceof Error ? e.message : String(e) });
    }
    return { saved: true };
  }
};
