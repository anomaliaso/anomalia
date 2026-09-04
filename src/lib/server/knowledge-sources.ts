/**
 * Knowledge sources: persist Composio connections and ingest provider files into brand_documents.
 *
 * Composio holds the credentials; we only store the connected account id and call the provider
 * APIs through the proxy, so no OAuth token is ever read, stored, or logged here.
 */
import { swallow } from '$lib/server/swallow';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import {
  SOURCE_TYPE_BY_PROVIDER,
  toolkitForProvider,
  type KnowledgeProvider
} from '$lib/knowledge-providers';
import type { ConnectStart } from '$lib/composio-catalog';
import { countBrandDocuments, docLimitForPlan, kickKnowledgeWork } from '$lib/server/knowledge';
import {
  composioConfigured,
  composioUserId,
  createConnectLink,
  deleteConnectedAccount,
  ensureAuthConfig,
  isActiveAccount,
  listConnectedAccounts
} from '$lib/server/composio';
import { parseDriveAboutUser, type DriveFile } from '$lib/server/knowledge-connectors/drive';
import { parseNotionUser } from '$lib/server/knowledge-connectors/notion';
import {
  driveFileToMarkdown,
  notionPageMarkdown,
  NOTION_VERSION,
  providerAuth,
  providerGetJson,
  type ProviderAuth
} from '$lib/server/knowledge-connectors/provider-fetch';
import { parseGithubRepoSelection } from '$lib/github-repos';
import { parseDriveFolderFormValues, parseDriveFileFormValues, splitPickedDriveItems, driveBrandScope, type DriveFolderOption, type DriveFileOption } from '$lib/drive-folders';
import { parseNotionPageFormValues, parseNotionPageSelection, type NotionPageOption } from '$lib/notion-pages';
import { connectorNeedsScope, connectorScopeSyncError } from '$lib/knowledge-scope';
import {
  decodeGithubFileContent,
  GITHUB_HEADERS,
  githubFileExternalId,
  githubRepoFromExternalId,
  githubConnectionLabel,
  listGithubRepos,
  type GithubRepo
} from '$lib/server/knowledge-connectors/github';
import { expandDriveFolderIds, listDriveFilesByIds, listDriveFilesInFolders } from '$lib/server/knowledge-connectors/drive-scope';
import { collectNotionScopedPages, listNotionPickerItems } from '$lib/server/knowledge-connectors/notion-scope';
import {
  GMAIL_LIST_QUERY,
  extractGmailText,
  formatGmailMarkdown,
  gmailHeader,
  parseGmailMessageList,
  parseGmailProfile
} from '$lib/server/knowledge-connectors/gmail';

export const SOURCE_SYNC_CAPS = {
  'google-drive': 40,
  notion: 40,
  github: 20,
  'google-mail': 25
} as const;

const STALL_MS = 15 * 60 * 1000;
const RESYNC_MS = 6 * 60 * 60 * 1000;

const SOURCE_COLUMNS =
  'id, brand_id, provider, connected_account_id, toolkit_slug, status, display_name, last_sync_at, last_error, docs_ingested, created_at, settings';

export type KnowledgeSourceRow = {
  id: string;
  brand_id: string;
  provider: KnowledgeProvider;
  connected_account_id: string;
  toolkit_slug: string;
  status: string;
  display_name: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  docs_ingested: number;
  created_at: string;
  settings: Record<string, unknown> | null;
};

export function knowledgeConnectorsEnabled(): boolean {
  return composioConfigured();
}

export async function loadKnowledgeSources(
  supabase: SupabaseClient,
  brandId: string
): Promise<KnowledgeSourceRow[]> {
  const { data, error } = await supabase
    .from('brand_knowledge_sources')
    .select(SOURCE_COLUMNS)
    .eq('brand_id', brandId)
    .neq('status', 'disconnected')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as KnowledgeSourceRow[];
}

export async function startConnectSession(opts: {
  supabase: SupabaseClient;
  brandId: string;
  brandSlug: string;
  userId: string;
  userEmail?: string | null;
  provider: KnowledgeProvider;
  callbackUrl?: string | null;
}): Promise<ConnectStart> {
  if (!composioConfigured()) throw new Error('Composio is not configured');
  const toolkit = toolkitForProvider(opts.provider);
  const authConfig = await ensureAuthConfig(toolkit);
  const link = await createConnectLink({
    authConfigId: authConfig.id,
    userId: composioUserId(opts.brandId),
    callbackUrl: opts.callbackUrl ?? null
  });
  return {
    authorizationUrl: link.redirectUrl,
    connectedAccountId: link.connectedAccountId,
    expiresAt: link.expiresAt
  };
}

/** The live Composio account for this brand + provider, or null while the user is authorizing. */
export async function findActiveProviderAccount(
  brandId: string,
  provider: KnowledgeProvider
): Promise<string | null> {
  const toolkit = toolkitForProvider(provider);
  const accounts = await listConnectedAccounts({
    userId: composioUserId(brandId),
    toolkitSlugs: [toolkit]
  });
  return accounts.find((a) => isActiveAccount(a.status))?.id ?? null;
}

export async function claimConnectionAfterConnect(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string | null;
  provider: KnowledgeProvider;
  connectedAccountId?: string | null;
}): Promise<KnowledgeSourceRow> {
  const connectedAccountId =
    opts.connectedAccountId?.trim() || (await findActiveProviderAccount(opts.brandId, opts.provider));
  if (!connectedAccountId) {
    throw new Error('Not authorized yet — finish the connect flow in the browser, then try again.');
  }
  return upsertSource(opts.supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    provider: opts.provider,
    connectedAccountId,
    toolkitSlug: toolkitForProvider(opts.provider)
  });
}

async function upsertSource(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    userId: string | null;
    provider: KnowledgeProvider;
    connectedAccountId: string;
    toolkitSlug?: string;
  }
): Promise<KnowledgeSourceRow> {
  const toolkitSlug = opts.toolkitSlug || toolkitForProvider(opts.provider);
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('brand_knowledge_sources')
    .select('*')
    .eq('brand_id', opts.brandId)
    .eq('provider', opts.provider)
    .maybeSingle();

  const scopedReady = !connectorNeedsScope(opts.provider, existing?.settings);
  const nextStatus = scopedReady ? 'pending_sync' : 'active';

  if (existing?.id) {
    const { data, error } = await supabase
      .from('brand_knowledge_sources')
      .update({
        connected_account_id: opts.connectedAccountId,
        toolkit_slug: toolkitSlug,
        status: nextStatus,
        last_error: null,
        connected_by: opts.userId || existing.connected_by,
        updated_at: now
      })
      .eq('id', existing.id)
      .select(SOURCE_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to update source');
    return data as KnowledgeSourceRow;
  }

  const { data, error } = await supabase
    .from('brand_knowledge_sources')
    .insert({
      brand_id: opts.brandId,
      provider: opts.provider,
      connected_account_id: opts.connectedAccountId,
      toolkit_slug: toolkitSlug,
      status: nextStatus,
      connected_by: opts.userId,
      updated_at: now
    })
    .select(SOURCE_COLUMNS)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Failed to save source');
  return data as KnowledgeSourceRow;
}

export async function disconnectSource(
  supabase: SupabaseClient,
  brandId: string,
  provider: KnowledgeProvider
): Promise<void> {
  const { data } = await supabase
    .from('brand_knowledge_sources')
    .select('id, connected_account_id')
    .eq('brand_id', brandId)
    .eq('provider', provider)
    .maybeSingle();
  if (!data) return;
  await deleteConnectedAccount(data.connected_account_id as string).catch((e) =>
    console.error('[knowledge-sources] composio delete', e)
  );
  await supabase
    .from('brand_knowledge_sources')
    .update({
      status: 'disconnected',
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', data.id);
}

export async function requestSourceSync(
  supabase: SupabaseClient,
  brandId: string,
  provider: KnowledgeProvider
): Promise<void> {
  const { data: row } = await supabase
    .from('brand_knowledge_sources')
    .select('id, settings')
    .eq('brand_id', brandId)
    .eq('provider', provider)
    .neq('status', 'disconnected')
    .maybeSingle();
  if (!row) throw new Error('Source not connected');
  if (connectorNeedsScope(provider, row.settings)) {
    throw new Error(connectorScopeSyncError(provider) || 'Pick a workspace area for this brand before syncing.');
  }
  const { data } = await supabase
    .from('brand_knowledge_sources')
    .update({
      status: 'pending_sync',
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', row.id)
    .select('id')
    .maybeSingle();
  if (!data) throw new Error('Source not connected');
}

export async function saveGithubRepos(
  supabase: SupabaseClient,
  brandId: string,
  repos: string[]
): Promise<string[]> {
  const selected = parseGithubRepoSelection({ repos });
  if (selected.length === 0) {
    throw new Error('Pick at least one GitHub repository for this brand.');
  }
  const { data } = await supabase
    .from('brand_knowledge_sources')
    .select('id, settings')
    .eq('brand_id', brandId)
    .eq('provider', 'github')
    .neq('status', 'disconnected')
    .maybeSingle();
  if (!data) throw new Error('GitHub is not connected');
  const prev =
    data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};
  const { error } = await supabase
    .from('brand_knowledge_sources')
    .update({
      settings: { ...prev, repos: selected },
      status: 'pending_sync',
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', data.id);
  if (error) throw new Error(error.message);
  return selected;
}

async function patchSourceSettings(
  supabase: SupabaseClient,
  brandId: string,
  provider: KnowledgeProvider,
  patch: Record<string, unknown>
): Promise<void> {
  const { data } = await supabase
    .from('brand_knowledge_sources')
    .select('id, settings')
    .eq('brand_id', brandId)
    .eq('provider', provider)
    .neq('status', 'disconnected')
    .maybeSingle();
  if (!data) throw new Error(`${provider} is not connected`);
  const prev =
    data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};
  const { error } = await supabase
    .from('brand_knowledge_sources')
    .update({
      settings: { ...prev, ...patch },
      status: 'pending_sync',
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', data.id);
  if (error) throw new Error(error.message);
}

export async function saveDriveFolders(
  supabase: SupabaseClient,
  brandId: string,
  folders: string[]
): Promise<DriveFolderOption[]> {
  const selected = parseDriveFolderFormValues(folders);
  if (selected.length === 0) {
    throw new Error('Pick at least one Drive folder for this brand.');
  }
  await patchSourceSettings(supabase, brandId, 'google-drive', { folders: selected });
  return selected;
}

export async function saveDriveSelection(
  supabase: SupabaseClient,
  brandId: string,
  items: string[]
): Promise<{ files: DriveFileOption[]; folders: DriveFolderOption[] }> {
  const picked = parseDriveFileFormValues(items);
  if (picked.length === 0) {
    throw new Error('Pick at least one Drive file for this brand.');
  }
  const split = splitPickedDriveItems(picked);
  if (!split.files.length && !split.folders.length) {
    throw new Error('Pick at least one Drive file for this brand.');
  }
  await patchSourceSettings(supabase, brandId, 'google-drive', {
    files: split.files,
    folders: split.folders
  });
  return split;
}

export async function saveNotionPages(
  supabase: SupabaseClient,
  brandId: string,
  pages: string[]
): Promise<NotionPageOption[]> {
  const selected = parseNotionPageFormValues(pages);
  if (selected.length === 0) {
    throw new Error('Pick at least one Notion page for this brand.');
  }
  await patchSourceSettings(supabase, brandId, 'notion', { pages: selected });
  return selected;
}

export async function listNotionPagesForBrand(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ pages: NotionPageOption[]; error: string | null }> {
  const { data } = await supabase
    .from('brand_knowledge_sources')
    .select('connected_account_id')
    .eq('brand_id', brandId)
    .eq('provider', 'notion')
    .neq('status', 'disconnected')
    .maybeSingle();
  if (!data?.connected_account_id) return { pages: [], error: null };
  try {
    const auth = providerAuth(data.connected_account_id as string, toolkitForProvider('notion'));
    return { pages: await listNotionPickerItems(auth), error: null };
  } catch (e) {
    return { pages: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listGithubReposForBrand(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ repos: GithubRepo[]; error: string | null }> {
  const { data } = await supabase
    .from('brand_knowledge_sources')
    .select('connected_account_id, toolkit_slug, status')
    .eq('brand_id', brandId)
    .eq('provider', 'github')
    .neq('status', 'disconnected')
    .maybeSingle();
  if (!data?.connected_account_id) return { repos: [], error: null };
  try {
    const auth = providerAuth(
      data.connected_account_id as string,
      String(data.toolkit_slug ?? toolkitForProvider('github'))
    );
    return { repos: await listGithubRepos(auth), error: null };
  } catch (e) {
    return { repos: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function kickSourceWork(origin: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
  else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
  await fetch(`${origin}/api/v1/knowledge/sources/work`, { method: 'POST', headers }).catch(swallow('fetch failed'));
}

export async function claimPendingSources(supabase: SupabaseClient, limit = 1): Promise<string[]> {
  const stallIso = new Date(Date.now() - STALL_MS).toISOString();
  await supabase
    .from('brand_knowledge_sources')
    .update({ status: 'pending_sync', sync_started_at: null })
    .eq('status', 'syncing')
    .lt('sync_started_at', stallIso);

  const dueBefore = new Date(Date.now() - RESYNC_MS).toISOString();
  const { data: candidates } = await supabase
    .from('brand_knowledge_sources')
    .select('id, status, last_sync_at, provider, settings')
    .in('status', ['pending_sync', 'active', 'error'])
    .order('updated_at', { ascending: true })
    .limit(20);

  const pick = (candidates ?? []).filter((row) => {
    if (connectorNeedsScope(row.provider as KnowledgeProvider, row.settings)) return false;
    if (row.status === 'pending_sync' || row.status === 'error') return true;
    if (!row.last_sync_at) return true;
    return row.last_sync_at < dueBefore;
  }).slice(0, limit);

  const ids: string[] = [];
  for (const row of pick) {
    const { data: claimed } = await supabase
      .from('brand_knowledge_sources')
      .update({
        status: 'syncing',
        sync_started_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id)
      .in('status', ['pending_sync', 'active', 'error'])
      .select('id')
      .maybeSingle();
    if (claimed?.id) ids.push(claimed.id as string);
  }
  return ids;
}

export async function syncKnowledgeSource(
  supabase: SupabaseClient,
  sourceId: string,
  origin?: string
): Promise<{ ingested: number; unchanged: number; skipped: number }> {
  const { data: source, error } = await supabase
    .from('brand_knowledge_sources')
    .select('*')
    .eq('id', sourceId)
    .maybeSingle();
  if (error || !source) throw new Error(error?.message ?? 'Source not found');

  const provider = source.provider as KnowledgeProvider;
  const brandId = source.brand_id as string;
  const { data: brand } = await supabase.from('brands').select('id, plan').eq('id', brandId).maybeSingle();
  const plan = (brand?.plan as string | null) ?? null;

  try {
    const auth = providerAuth(
      String(source.connected_account_id ?? ''),
      String(source.toolkit_slug ?? toolkitForProvider(provider))
    );
    if (!auth.connectedAccountId) throw new Error('Source has no connection — reconnect it.');
    const result = await runProviderSync(supabase, {
      sourceId,
      brandId,
      provider,
      auth,
      plan,
      cap: SOURCE_SYNC_CAPS[provider],
      settings: source.settings
    });

    await supabase
      .from('brand_knowledge_sources')
      .update({
        status: 'active',
        last_sync_at: new Date().toISOString(),
        last_error: null,
        docs_ingested: result.ingested + result.unchanged,
        display_name: result.displayName ?? source.display_name,
        sync_started_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', sourceId);

    if (origin && result.ingested > 0) void kickKnowledgeWork(origin);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from('brand_knowledge_sources')
      .update({
        status: 'error',
        last_error: msg.slice(0, 1000),
        sync_started_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', sourceId);
    throw e;
  }
}

type SyncResult = {
  ingested: number;
  unchanged: number;
  skipped: number;
  displayName: string | null;
};

async function runProviderSync(
  supabase: SupabaseClient,
  ctx: {
    sourceId: string;
    brandId: string;
    provider: KnowledgeProvider;
    auth: ProviderAuth;
    plan: string | null;
    cap: number;
    settings?: unknown;
  }
): Promise<SyncResult> {
  switch (ctx.provider) {
    case 'google-drive':
      return syncDrive(supabase, ctx);
    case 'notion':
      return syncNotion(supabase, ctx);
    case 'github':
      return syncGithub(supabase, ctx);
    case 'google-mail':
      return syncGmail(supabase, ctx);
  }
}

async function upsertConnectorDocument(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    sourceId: string;
    provider: KnowledgeProvider;
    externalId: string;
    title: string;
    markdown: string;
    sourceUrl?: string | null;
    mimeType?: string | null;
    plan: string | null;
  }
): Promise<'inserted' | 'updated' | 'unchanged' | 'limit'> {
  const markdown = opts.markdown.trim();
  if (!markdown) return 'unchanged';
  const sha = createHash('sha256').update(markdown).digest('hex');
  const sourceType = SOURCE_TYPE_BY_PROVIDER[opts.provider];

  const { data: existing } = await supabase
    .from('brand_documents')
    .select('id, sha256')
    .eq('brand_id', opts.brandId)
    .eq('source_id', opts.sourceId)
    .eq('external_id', opts.externalId)
    .maybeSingle();

  if (existing?.id && existing.sha256 === sha) return 'unchanged';

  if (existing?.id) {
    const { error } = await supabase
      .from('brand_documents')
      .update({
        title: opts.title.slice(0, 200),
        markdown,
        content_text: markdown.slice(0, 200_000),
        source_url: opts.sourceUrl ?? null,
        mime_type: opts.mimeType ?? null,
        source_type: sourceType,
        sha256: sha,
        bytes: Buffer.byteLength(markdown, 'utf8'),
        status: 'pending',
        processed_at: null,
        attempts: 0,
        error: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    return 'updated';
  }

  const existingCount = await countBrandDocuments(supabase, opts.brandId);
  if (existingCount >= docLimitForPlan(opts.plan)) return 'limit';

  const { error } = await supabase.from('brand_documents').insert({
    brand_id: opts.brandId,
    kind: 'document',
    title: opts.title.slice(0, 200),
    markdown,
    content_text: markdown.slice(0, 200_000),
    source_type: sourceType,
    source_url: opts.sourceUrl ?? null,
    source_id: opts.sourceId,
    external_id: opts.externalId,
    mime_type: opts.mimeType ?? 'text/markdown',
    sha256: sha,
    bytes: Buffer.byteLength(markdown, 'utf8'),
    status: 'pending'
  });
  if (error) throw new Error(error.message);
  return 'inserted';
}

async function ingestMany(
  supabase: SupabaseClient,
  docs: Array<{
    externalId: string;
    title: string;
    markdown: string;
    sourceUrl?: string | null;
    mimeType?: string | null;
  }>,
  ctx: { sourceId: string; brandId: string; provider: KnowledgeProvider; plan: string | null; cap: number }
): Promise<{ ingested: number; unchanged: number; skipped: number }> {
  let ingested = 0;
  let unchanged = 0;
  let skipped = 0;
  for (const doc of docs.slice(0, ctx.cap)) {
    const result = await upsertConnectorDocument(supabase, {
      brandId: ctx.brandId,
      sourceId: ctx.sourceId,
      provider: ctx.provider,
      plan: ctx.plan,
      ...doc
    });
    if (result === 'inserted' || result === 'updated') ingested++;
    else if (result === 'unchanged') unchanged++;
    else skipped++;
    if (result === 'limit') break;
  }
  return { ingested, unchanged, skipped };
}

async function pruneSourceDocuments(
  supabase: SupabaseClient,
  opts: { brandId: string; sourceId: string; keepExternalIds: Set<string> }
): Promise<void> {
  const { data, error } = await supabase
    .from('brand_documents')
    .select('id, external_id')
    .eq('brand_id', opts.brandId)
    .eq('source_id', opts.sourceId);
  if (error) throw new Error(error.message);
  const toDelete = (data ?? [])
    .filter((row) => !opts.keepExternalIds.has(String(row.external_id ?? '')))
    .map((row) => row.id as string);
  if (!toDelete.length) return;
  const { error: delError } = await supabase.from('brand_documents').delete().in('id', toDelete);
  if (delError) throw new Error(delError.message);
}

async function syncDrive(
  supabase: SupabaseClient,
  ctx: {
    sourceId: string;
    brandId: string;
    provider: KnowledgeProvider;
    auth: ProviderAuth;
    plan: string | null;
    cap: number;
    settings?: unknown;
  }
): Promise<SyncResult> {
  const about = await providerGetJson(
    'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)',
    ctx.auth
  );
  const displayName = parseDriveAboutUser(about);
  const scope = driveBrandScope(ctx.settings);
  if (!scope.fileIds.length && !scope.folderIds.length) {
    await pruneSourceDocuments(supabase, {
      brandId: ctx.brandId,
      sourceId: ctx.sourceId,
      keepExternalIds: new Set()
    });
    return { ingested: 0, unchanged: 0, skipped: 0, displayName };
  }

  const collected = new Map<string, DriveFile>();
  if (scope.fileIds.length) {
    for (const file of await listDriveFilesByIds(ctx.auth, scope.fileIds)) {
      collected.set(file.id, file);
    }
  }
  if (scope.folderIds.length) {
    const expanded = await expandDriveFolderIds(ctx.auth, scope.folderIds);
    for (const file of await listDriveFilesInFolders(ctx.auth, expanded, Math.max(ctx.cap, 200))) {
      collected.set(file.id, file);
    }
  }
  const files = [...collected.values()];
  const keep = new Set(files.map((f) => f.id));

  const docs: Array<{
    externalId: string;
    title: string;
    markdown: string;
    sourceUrl?: string | null;
    mimeType?: string | null;
  }> = [];

  for (const file of files.slice(0, ctx.cap)) {
    try {
      const markdown = await driveFileToMarkdown(file, ctx.auth);
      if (!markdown) continue;
      docs.push({
        externalId: file.id,
        title: file.name,
        markdown,
        sourceUrl: file.webViewLink,
        mimeType: file.mimeType
      });
    } catch (e) {
      console.error('[knowledge-sources] drive file', file.id, e);
    }
  }

  const counts = await ingestMany(supabase, docs, ctx);
  await pruneSourceDocuments(supabase, {
    brandId: ctx.brandId,
    sourceId: ctx.sourceId,
    keepExternalIds: keep
  });
  return { ...counts, displayName };
}

async function syncNotion(
  supabase: SupabaseClient,
  ctx: {
    sourceId: string;
    brandId: string;
    provider: KnowledgeProvider;
    auth: ProviderAuth;
    plan: string | null;
    cap: number;
    settings?: unknown;
  }
): Promise<SyncResult> {
  const me = await providerGetJson('https://api.notion.com/v1/users/me', ctx.auth, NOTION_VERSION);
  const displayName = parseNotionUser(me);
  const selected = parseNotionPageSelection(ctx.settings);
  if (!selected.length) {
    await pruneSourceDocuments(supabase, {
      brandId: ctx.brandId,
      sourceId: ctx.sourceId,
      keepExternalIds: new Set()
    });
    return { ingested: 0, unchanged: 0, skipped: 0, displayName };
  }

  const pages = await collectNotionScopedPages(ctx.auth, selected, ctx.cap);
  const keep = new Set(pages.map((p) => p.id));
  const docs = [];
  for (const page of pages) {
    try {
      const markdown = await notionPageMarkdown(page.id, ctx.auth);
      if (!markdown) continue;
      docs.push({
        externalId: page.id,
        title: page.title,
        markdown,
        sourceUrl: page.url,
        mimeType: 'text/markdown'
      });
    } catch (e) {
      console.error('[knowledge-sources] notion page', page.id, e);
    }
  }

  const counts = await ingestMany(supabase, docs, ctx);
  await pruneSourceDocuments(supabase, {
    brandId: ctx.brandId,
    sourceId: ctx.sourceId,
    keepExternalIds: keep
  });
  return { ...counts, displayName };
}

async function pruneGithubDocuments(
  supabase: SupabaseClient,
  opts: { brandId: string; sourceId: string; selectedRepos: string[] }
): Promise<void> {
  const { data, error } = await supabase
    .from('brand_documents')
    .select('id, external_id')
    .eq('brand_id', opts.brandId)
    .eq('source_id', opts.sourceId);
  if (error) throw new Error(error.message);
  const keep = new Set(opts.selectedRepos);
  const toDelete = (data ?? [])
    .filter((row) => {
      const repo = githubRepoFromExternalId(String(row.external_id ?? ''));
      return !repo || !keep.has(repo);
    })
    .map((row) => row.id as string);
  if (!toDelete.length) return;
  const { error: delError } = await supabase.from('brand_documents').delete().in('id', toDelete);
  if (delError) throw new Error(delError.message);
}

async function syncGithub(
  supabase: SupabaseClient,
  ctx: {
    sourceId: string;
    brandId: string;
    provider: KnowledgeProvider;
    auth: ProviderAuth;
    plan: string | null;
    cap: number;
    settings?: unknown;
  }
): Promise<SyncResult> {
  const displayName = await githubConnectionLabel(ctx.auth);
  const selected = parseGithubRepoSelection(ctx.settings);
  if (!selected.length) {
    await pruneGithubDocuments(supabase, { brandId: ctx.brandId, sourceId: ctx.sourceId, selectedRepos: [] });
    return { ingested: 0, unchanged: 0, skipped: 0, displayName };
  }

  const docs = [];
  for (const fullName of selected) {
    if (docs.length >= ctx.cap) break;
    const htmlUrl = `https://github.com/${fullName}`;
    for (const extra of ['README.md', 'CHANGELOG.md']) {
      if (docs.length >= ctx.cap) break;
      const path =
        extra === 'README.md'
          ? `https://api.github.com/repos/${fullName}/readme`
          : `https://api.github.com/repos/${fullName}/contents/${extra}`;
      try {
        const data = await providerGetJson(path, ctx.auth, GITHUB_HEADERS);
        const file = decodeGithubFileContent(data);
        if (!file?.text) continue;
        const filePath = file.path || extra;
        docs.push({
          externalId: githubFileExternalId(fullName, filePath),
          title: `${fullName} — ${filePath}`,
          markdown: file.text,
          sourceUrl: file.htmlUrl || htmlUrl,
          mimeType: 'text/markdown'
        });
      } catch (e) {
        console.error('[knowledge-sources] github file', fullName, extra, e);
      }
    }
  }

  const counts = await ingestMany(supabase, docs, ctx);
  await pruneGithubDocuments(supabase, {
    brandId: ctx.brandId,
    sourceId: ctx.sourceId,
    selectedRepos: selected
  });
  return { ...counts, displayName };
}

async function syncGmail(
  supabase: SupabaseClient,
  ctx: { sourceId: string; brandId: string; provider: KnowledgeProvider; auth: ProviderAuth; plan: string | null; cap: number }
): Promise<SyncResult> {
  const profile = await providerGetJson(
    'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    ctx.auth
  );
  const displayName = parseGmailProfile(profile);
  const list = await providerGetJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${ctx.cap}&q=${encodeURIComponent(GMAIL_LIST_QUERY)}`,
    ctx.auth
  );
  const { ids } = parseGmailMessageList(list);

  const docs = [];
  for (const id of ids.slice(0, ctx.cap)) {
    try {
      const msg = await providerGetJson(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
        ctx.auth
      );
      if (!msg || typeof msg !== 'object') continue;
      const payload = (msg as Record<string, unknown>).payload;
      const body = extractGmailText(payload);
      if (!body || body.length < 40) continue;
      const subject = gmailHeader(payload, 'Subject') || '(no subject)';
      const from = gmailHeader(payload, 'From') || '';
      const date = gmailHeader(payload, 'Date') || '';
      docs.push({
        externalId: id,
        title: subject.slice(0, 200),
        markdown: formatGmailMarkdown({ subject, from, date, body: body.slice(0, 20_000) }),
        sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${id}`,
        mimeType: 'text/plain'
      });
    } catch (e) {
      console.error('[knowledge-sources] gmail', id, e);
    }
  }

  const counts = await ingestMany(supabase, docs, ctx);
  return { ...counts, displayName };
}

export { upsertConnectorDocument };
