/** Load the Composio toolkit catalog and persist a brand's connections. */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  connectableCatalog,
  inferConnectorKind,
  listedForToolkit,
  normalizeToolkitSlug,
  parseToolkitsPayload,
  type ConnectorCatalogItem,
  type ConnectorKind,
  type ConnectStart
} from '$lib/composio-catalog';
import { providerForToolkit } from '$lib/knowledge-providers';
import { createDirectoryCache } from '$lib/server/composio-catalog-cache';
import {
  composioConfigured,
  composioErrorMessage,
  composioUserId,
  createConnectLink,
  listAuthConfigToolkits,
  deleteConnectedAccount,
  ensureAuthConfig,
  isActiveAccount,
  listComposioToolkits,
  listConnectedAccounts
} from '$lib/server/composio';
import {
  claimConnectionAfterConnect,
  disconnectSource,
  startConnectSession
} from '$lib/server/knowledge-sources';

/** How long an unfinished connect attempt stays on the page before it is cleaned up. */
const PENDING_TTL_MS = 30 * 60 * 1000;

const CONN_COLUMNS =
  'id, brand_id, toolkit_slug, connected_account_id, kind, status, display_name, last_error, created_at';

export type BrandConnectionRow = {
  id: string;
  brand_id: string;
  toolkit_slug: string;
  connected_account_id: string;
  kind: ConnectorKind;
  status: string;
  display_name: string | null;
  last_error: string | null;
  created_at: string;
};

/** Shared across requests on a warm instance; a cold start pays for one directory fetch. */
const toolkitDirectory = createDirectoryCache<ConnectorCatalogItem>();
/** Our own auth configs change when someone edits them in the dashboard — refresh often. */
const ownAuthConfigs = createDirectoryCache<string>({ ttlMs: 5 * 60 * 1000 });

export function invalidateToolkitDirectory(): void {
  toolkitDirectory.invalidate();
  ownAuthConfigs.invalidate();
}

/**
 * The catalog is whatever Composio answers — every toolkit, in full. There is no registry table
 * and no hardcoded fallback: if the call fails the page says so, because a short list of made-up
 * defaults reads as "these are the only integrations that exist", which is a lie.
 */
export async function loadConnectorCatalog(keepSlugs: string[] = []): Promise<{
  items: ConnectorCatalogItem[];
  error: string | null;
}> {
  if (!composioConfigured()) {
    return { items: [], error: 'Composio is not configured on this environment.' };
  }
  try {
    const [items, own] = await Promise.all([
      toolkitDirectory.get(async () => parseToolkitsPayload(await listComposioToolkits())),
      ownAuthConfigs.get(async () => [...(await listAuthConfigToolkits())]).catch((error) => { swallow('list auth configs', error); return []; })
    ]);
    // A toolkit Composio does not manage, and we have no credentials for, cannot be connected:
    // listing it only produces a 404 when the brand clicks Connect.
    return {
      items: connectableCatalog(items, new Set(own), new Set(keepSlugs)),
      error: null
    };
  } catch (e) {
    const error = composioErrorMessage(e);
    console.error('[composio-catalog] list toolkits', error);
    return { items: [], error };
  }
}

/**
 * The shape the CLI and MCP speak. Their vocabulary is pending|connected|revoked|error, while
 * the table stores active|pending|error|disconnected — this is the only place that maps them.
 */
export function serializeConnection(row: BrandConnectionRow) {
  return {
    id: row.id,
    provider: row.toolkit_slug,
    display_name: row.display_name || listedForToolkit(row.toolkit_slug).displayName,
    status:
      row.status === 'active'
        ? ('connected' as const)
        : row.status === 'disconnected'
          ? ('revoked' as const)
          : row.status === 'pending'
            ? ('pending' as const)
            : ('error' as const),
    last_error: row.last_error,
    connected_at: row.status === 'active' ? row.created_at : null,
    created_at: row.created_at
  };
}

export async function loadBrandConnections(
  supabase: SupabaseClient,
  brandId: string
): Promise<BrandConnectionRow[]> {
  const { data, error } = await supabase
    .from('brand_app_connections')
    .select(CONN_COLUMNS)
    .eq('brand_id', brandId)
    .neq('status', 'disconnected')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BrandConnectionRow[];
}

export async function upsertBrandConnection(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    userId: string | null;
    toolkitSlug: string;
    connectedAccountId: string;
    kind: ConnectorKind;
    status?: 'active' | 'pending' | 'error';
    displayName?: string | null;
    lastError?: string | null;
  }
): Promise<BrandConnectionRow> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('brand_app_connections')
    .select(CONN_COLUMNS)
    .eq('brand_id', opts.brandId)
    .eq('toolkit_slug', opts.toolkitSlug)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from('brand_app_connections')
      .update({
        connected_account_id: opts.connectedAccountId,
        kind: opts.kind,
        status: opts.status ?? 'active',
        last_error: opts.lastError ?? null,
        display_name: opts.displayName ?? existing.display_name,
        connected_by: opts.userId || undefined,
        updated_at: now
      })
      .eq('id', existing.id)
      .select(CONN_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to update connection');
    return data as BrandConnectionRow;
  }

  const { data, error } = await supabase
    .from('brand_app_connections')
    .insert({
      brand_id: opts.brandId,
      toolkit_slug: opts.toolkitSlug,
      connected_account_id: opts.connectedAccountId,
      kind: opts.kind,
      status: opts.status ?? 'active',
      display_name: opts.displayName ?? null,
      last_error: opts.lastError ?? null,
      connected_by: opts.userId,
      updated_at: now
    })
    .select(CONN_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to save connection');
  return data as BrandConnectionRow;
}

export async function markBrandConnectionError(
  supabase: SupabaseClient,
  opts: { brandId: string; toolkitSlug: string; error: string }
): Promise<void> {
  await supabase
    .from('brand_app_connections')
    .update({
      status: 'error',
      last_error: opts.error.slice(0, 1000),
      updated_at: new Date().toISOString()
    })
    .eq('brand_id', opts.brandId)
    .eq('toolkit_slug', opts.toolkitSlug);
}

/**
 * Start a connect flow. Composio returns a hosted Connect Link the user opens; the connection
 * only becomes usable once they finish there, which `claimIntegrationConnection` checks.
 */
export async function startIntegrationConnectSession(opts: {
  supabase: SupabaseClient;
  brandId: string;
  brandSlug: string;
  userId: string;
  userEmail?: string | null;
  toolkitSlug: string;
  callbackUrl?: string | null;
}): Promise<ConnectStart> {
  if (!composioConfigured()) throw new Error('Composio is not configured');
  const toolkitSlug = normalizeToolkitSlug(opts.toolkitSlug);
  if (!toolkitSlug) throw new Error('Missing toolkit slug');
  const knowledge = providerForToolkit(toolkitSlug);
  const rows = await loadBrandConnections(opts.supabase, opts.brandId).catch((error) => { swallow('load brand connections', error); return []; });

  let started: ConnectStart;
  if (knowledge) {
    started = await startConnectSession({ ...opts, provider: knowledge });
  } else {
    const authConfig = await ensureAuthConfig(toolkitSlug);
    const link = await createConnectLink({
      authConfigId: authConfig.id,
      userId: composioUserId(opts.brandId),
      callbackUrl: opts.callbackUrl ?? null
    });
    started = {
      authorizationUrl: link.redirectUrl,
      connectedAccountId: link.connectedAccountId,
      expiresAt: link.expiresAt
    };
  }

  // Leave a pending row behind — it is what the browser and the CLI poll while the user is on
  // Composio's consent page — but never overwrite a connection that already works: this call
  // mints a fresh connected account, and if the user abandons the new consent screen, the row
  // would be left pointing at an account nobody authorized. The claim re-reads the live account
  // anyway, so the pending id is never needed.
  const existing = rows.find((row) => row.toolkit_slug === toolkitSlug);
  if (existing?.status !== 'active') {
    await upsertBrandConnection(opts.supabase, {
      brandId: opts.brandId,
      userId: opts.userId,
      toolkitSlug,
      connectedAccountId: started.connectedAccountId,
      kind: inferConnectorKind(toolkitSlug),
      status: 'pending',
      lastError: null,
      displayName: listedForToolkit(toolkitSlug).displayName
    });
  }
  return started;
}

/**
 * Confirm the connection against Composio and flip the row to active. Idempotent and safe to
 * poll: the OAuth callback lands in the user's browser, never on our server.
 */
export async function claimIntegrationConnection(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  toolkitSlug: string;
}): Promise<{ connected: boolean; status: string }> {
  const toolkitSlug = normalizeToolkitSlug(opts.toolkitSlug);
  if (!toolkitSlug) throw new Error('Missing toolkit slug');
  const account = await findActiveAccount(opts.brandId, toolkitSlug);
  const knowledge = providerForToolkit(toolkitSlug);
  if (!account) {
    return { connected: false, status: 'pending' };
  }
  if (knowledge) {
    await claimConnectionAfterConnect({
      supabase: opts.supabase,
      brandId: opts.brandId,
      userId: opts.userId,
      provider: knowledge,
      connectedAccountId: account.id
    });
  }
  const kind = inferConnectorKind(toolkitSlug);
  await upsertBrandConnection(opts.supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    toolkitSlug,
    connectedAccountId: account.id,
    kind,
    status: 'active',
    displayName: listedForToolkit(toolkitSlug).displayName
  });
  return { connected: true, status: 'active' };
}

/** The live account for this brand + toolkit, or null while the user is still authorizing. */
export async function findActiveAccount(
  brandId: string,
  toolkitSlug: string
): Promise<{ id: string; status: string } | null> {
  const accounts = await listConnectedAccounts({
    userId: composioUserId(brandId),
    toolkitSlugs: [toolkitSlug]
  });
  const active = accounts.find((a) => isActiveAccount(a.status));
  return active ? { id: active.id, status: active.status } : null;
}

/**
 * The accounts this brand has live at Composio, by toolkit slug.
 *
 * `ok` is not decoration: an empty list because the call failed and an empty list because nothing
 * is connected mean opposite things to the reconciler, and only one of them may touch a row.
 */
export async function listConnectedToolkits(
  brandId: string
): Promise<{ ok: boolean; accounts: Map<string, string> }> {
  if (!composioConfigured()) return { ok: false, accounts: new Map() };
  try {
    const accounts = await listConnectedAccounts({ userId: composioUserId(brandId) });
    const live = new Map<string, string>();
    for (const account of accounts) {
      if (isActiveAccount(account.status) && !live.has(account.toolkitSlug)) {
        live.set(account.toolkitSlug, account.id);
      }
    }
    return { ok: true, accounts: live };
  } catch (e) {
    console.error('[composio-catalog] list connected accounts', composioErrorMessage(e));
    return { ok: false, accounts: new Map() };
  }
}

export async function disconnectIntegration(opts: {
  supabase: SupabaseClient;
  brandId: string;
  toolkitSlug: string;
}): Promise<void> {
  const toolkitSlug = normalizeToolkitSlug(opts.toolkitSlug);
  if (!toolkitSlug) return;
  const knowledge = providerForToolkit(toolkitSlug);
  const { data } = await opts.supabase
    .from('brand_app_connections')
    .select('id, connected_account_id')
    .eq('brand_id', opts.brandId)
    .eq('toolkit_slug', toolkitSlug)
    .maybeSingle();
  if (data?.connected_account_id) {
    await deleteConnectedAccount(data.connected_account_id as string).catch((e) =>
      console.error('[composio-catalog] delete connected account', composioErrorMessage(e))
    );
    await opts.supabase
      .from('brand_app_connections')
      .update({
        status: 'disconnected',
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', data.id);
  }
  // A knowledge toolkit also owns a brand_knowledge_sources row and its ingested documents.
  if (knowledge) await disconnectSource(opts.supabase, opts.brandId, knowledge);
  // Triggers outlive nothing: an instance still firing for a dropped connection would relay
  // events the brand no longer has any right to receive.
  const { deleteTriggersForToolkit } = await import('$lib/server/brand-triggers');
  await deleteTriggersForToolkit(opts.supabase, opts.brandId, toolkitSlug).catch((e) =>
    console.error('[composio-catalog] delete triggers', composioErrorMessage(e))
  );
}

/**
 * Reconcile the rows against Composio. The DB is a mirror: an account revoked at the provider,
 * or connected from another surface (CLI, another browser), must not leave a stale row behind.
 */
export async function reconcileBrandConnections(
  supabase: SupabaseClient,
  brandId: string
): Promise<void> {
  const rows = await loadBrandConnections(supabase, brandId).catch((error) => { swallow('load brand connections', error); return []; });
  if (!rows.length) return;
  // A failed or unconfigured listing is not "everything was revoked": leave the rows untouched
  // rather than marking healthy connections as broken because Composio was unreachable.
  const listing = await listConnectedToolkits(brandId);
  if (!listing.ok) return;
  const now = Date.now();
  for (const row of rows) {
    const liveAccountId = listing.accounts.get(row.toolkit_slug);
    const isLive = Boolean(liveAccountId);
    if (isLive && (row.status !== 'active' || row.connected_account_id !== liveAccountId)) {
      // Opening the connect flow mints a NEW connected account every time, so a second attempt
      // leaves the row pointing at the abandoned one. Marking the row active without correcting
      // the id is how tool calls ended up executing against an account nobody ever authorized.
      await supabase
        .from('brand_app_connections')
        .update({
          status: 'active',
          connected_account_id: liveAccountId,
          last_error: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', row.id);
      const knowledge = providerForToolkit(row.toolkit_slug);
      if (knowledge) {
        await claimConnectionAfterConnect({
          supabase,
          brandId,
          userId: null,
          provider: knowledge,
          connectedAccountId: liveAccountId as string
        }).catch((e) => console.error('[composio-catalog] revive source', composioErrorMessage(e)));
      }
    } else if (!isLive && row.status === 'pending') {
      // Opening the Connect Link and walking away leaves a pending row behind. Give the user
      // time to finish in the other tab, then drop it — an abandoned attempt is not a connection.
      const age = now - new Date(row.created_at).getTime();
      if (age > PENDING_TTL_MS) {
        await supabase
          .from('brand_app_connections')
          .update({ status: 'disconnected', last_error: null, updated_at: new Date().toISOString() })
          .eq('id', row.id);
      }
    } else if (!isLive && row.status === 'active') {
      await markBrandConnectionError(supabase, {
        brandId,
        toolkitSlug: row.toolkit_slug,
        error: 'Connection is no longer active at the provider — reconnect it.'
      });
      const knowledge = providerForToolkit(row.toolkit_slug);
      if (knowledge) {
        // Its ingest source cannot outlive the connection it reads through.
        await supabase
          .from('brand_knowledge_sources')
          .update({
            status: 'error',
            last_error: 'Connection is no longer active at the provider — reconnect it.',
            updated_at: new Date().toISOString()
          })
          .eq('brand_id', brandId)
          .eq('provider', knowledge)
          .neq('status', 'disconnected');
      }
    }
  }
}
