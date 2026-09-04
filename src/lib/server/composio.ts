/**
 * Thin Composio HTTP client — REST API v3.1.
 *
 * Composio brokers the OAuth: credentials never reach this app. Provider APIs are called
 * through the proxy (`composioProxy`), which injects the connection's token server-side, and
 * agent-facing tools go through the tool endpoints. Nothing here ever returns a raw token.
 */
import { swallow } from '$lib/server/swallow';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

const COMPOSIO_API = 'https://backend.composio.dev/api/v3.1';

export function composioApiKey(): string {
  return (env.COMPOSIO_API_KEY || '').trim();
}

export function composioConfigured(): boolean {
  return composioApiKey().length > 0;
}

/** Signs the trigger events Composio posts to our ingress. Rotate it in their dashboard. */
export function composioWebhookSecret(): string {
  return (env.COMPOSIO_WEBHOOK_SECRET || '').trim();
}

/**
 * Composio's `user_id` is the identity connections hang off. Connectors belong to a brand, not
 * to the person who clicked Connect, so the brand is the identity — a teammate connecting Drive
 * later reuses the same account instead of creating a second one.
 */
export function composioUserId(brandId: string): string {
  return `brand_${brandId}`;
}

/**
 * Composio ships two products with two credentials that are not interchangeable: a `ck_…`
 * consumer key belongs to "Composio For You" (one person's own AI client), while this app is a
 * Platform project and needs its project key. Sending the wrong one gets a bare 401 from every
 * endpoint, in the middle of whatever the user was doing — so name the problem instead.
 */
export function composioKeyProblem(key: string): string | null {
  if (!key) return null;
  if (key.startsWith('ck_')) {
    return 'COMPOSIO_API_KEY is a Composio "For You" consumer key (ck_…), which the Platform API rejects. Copy the project key from the Composio dashboard: Settings → Project Settings → API Keys.';
  }
  return null;
}

/** Keys must never surface in a UI string, a log line, or an agent's context. */
export function redactComposioText(value: string): string {
  return value
    .replace(/COMPOSIO_API_KEY[=:]?\s*\S+/gi, 'COMPOSIO_API_KEY=[redacted]')
    .replace(/\b(ak|ck|sk)_[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

export function composioErrorMessage(error: unknown): string {
  return redactComposioText(error instanceof Error ? error.message : String(error));
}

type Json = Record<string, unknown>;

async function composioFetch<T = Json>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number }
): Promise<T> {
  const key = composioApiKey();
  if (!key) throw new Error('Composio is not configured');
  const problem = composioKeyProblem(key);
  if (problem) throw new Error(problem);
  const res = await fetch(`${COMPOSIO_API}${path}`, {
    method,
    headers: {
      'x-api-key': key,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 30_000)
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }
  if (!res.ok) {
    const err = json && typeof json === 'object' ? ((json as Json).error ?? json) : null;
    const msg =
      (err && typeof err === 'object' && 'message' in err
        ? String((err as Json).message)
        : text) || res.statusText;
    throw new Error(
      redactComposioText(`Composio ${method} ${path} failed (${res.status}): ${msg}`).slice(0, 400)
    );
  }
  return json as T;
}

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function itemsOf(raw: unknown): Json[] {
  const o = asObject(raw);
  const rows = Array.isArray(o.items) ? o.items : Array.isArray(raw) ? raw : [];
  return rows.filter((r): r is Json => Boolean(r) && typeof r === 'object');
}

/** Walk a cursor-paginated list endpoint to the end (Composio caps a page at 1000). */
async function collectPages(path: string, limit = 100, maxPages = 20): Promise<Json[]> {
  const out: Json[] = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page += 1) {
    const sep = path.includes('?') ? '&' : '?';
    const raw = await composioFetch<Json>(
      'GET',
      `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    );
    out.push(...itemsOf(raw));
    const next = raw.next_cursor;
    if (!next) break;
    cursor = String(next);
  }
  return out;
}

// ── Toolkits (the catalog) ────────────────────────────────────────────────

export type ComposioToolkit = {
  slug: string;
  name: string;
  logo: string | null;
  description: string;
  noAuth: boolean;
  /** Composio ships its own OAuth app for this toolkit — nothing to register on our side. */
  managedAuth: boolean;
};

function parseToolkit(row: Json): ComposioToolkit | null {
  const slug = String(row.slug ?? '').trim();
  if (!slug) return null;
  const meta = asObject(row.meta);
  const managed = Array.isArray(row.composio_managed_auth_schemes)
    ? row.composio_managed_auth_schemes.length > 0
    : false;
  return {
    slug: slug.toUpperCase(),
    name: String(row.name ?? slug),
    logo: meta.logo ? String(meta.logo) : null,
    description: String(meta.description ?? ''),
    noAuth: row.no_auth === true,
    managedAuth: managed || row.no_auth === true
  };
}

export async function listComposioToolkits(search?: string): Promise<ComposioToolkit[]> {
  const query = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  const rows = await collectPages(`/toolkits${query}`, 100, search ? 2 : 20);
  const out: ComposioToolkit[] = [];
  for (const row of rows) {
    const parsed = parseToolkit(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── Auth configs ──────────────────────────────────────────────────────────

export type ComposioAuthConfig = {
  id: string;
  toolkitSlug: string;
  authScheme: string;
  isComposioManaged: boolean;
  disabled: boolean;
};

function parseAuthConfig(row: Json): ComposioAuthConfig | null {
  const id = String(row.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    toolkitSlug: String(asObject(row.toolkit).slug ?? '').toUpperCase(),
    authScheme: String(row.auth_scheme ?? ''),
    isComposioManaged: row.is_composio_managed !== false,
    disabled: row.status === 'DISABLED'
  };
}

export async function listAuthConfigs(toolkitSlug: string): Promise<ComposioAuthConfig[]> {
  const raw = await composioFetch<Json>(
    'GET',
    `/auth_configs?toolkit_slug=${encodeURIComponent(toolkitSlug.toLowerCase())}&limit=50`
  );
  const out: ComposioAuthConfig[] = [];
  for (const row of itemsOf(raw)) {
    const parsed = parseAuthConfig(row);
    if (parsed && !parsed.disabled) out.push(parsed);
  }
  return out;
}

/**
 * Toolkits this project can actually connect with credentials of its own — either a custom auth
 * config someone created in the Composio dashboard, or a managed one already materialised here.
 * A toolkit with neither, and no Composio-managed app, answers 404 on the first connect attempt.
 */
export async function listAuthConfigToolkits(): Promise<Set<string>> {
  const rows = await collectPages('/auth_configs', 50, 20);
  const out = new Set<string>();
  for (const row of rows) {
    const parsed = parseAuthConfig(row);
    if (parsed && !parsed.disabled && parsed.toolkitSlug) out.add(parsed.toolkitSlug);
  }
  return out;
}

/**
 * An auth config is what a Connect Link points at. Managed toolkits need no credentials of
 * ours, so the first connect for a toolkit creates one and every later connect reuses it.
 * A custom OAuth app (our own client id/secret, e.g. for branding) is created in the Composio
 * dashboard and wins here, because a custom config is returned alongside the managed one.
 */
export async function ensureAuthConfig(toolkitSlug: string): Promise<ComposioAuthConfig> {
  const slug = toolkitSlug.toUpperCase();
  const existing = await listAuthConfigs(slug);
  const custom = existing.find((c) => !c.isComposioManaged);
  if (custom) return custom;
  if (existing.length) return existing[0];
  const raw = await composioFetch<Json>('POST', '/auth_configs', {
    toolkit: { slug: slug.toLowerCase() },
    auth_config: { type: 'use_composio_managed_auth' }
  });
  const created = parseAuthConfig({
    ...asObject(raw.auth_config),
    toolkit: asObject(raw.toolkit)
  });
  if (!created) throw new Error(`Composio did not return an auth config for ${slug}`);
  return created;
}

// ── Connected accounts ────────────────────────────────────────────────────

export type ComposioAccountStatus =
  | 'INITIALIZING'
  | 'INITIATED'
  | 'ACTIVE'
  | 'FAILED'
  | 'EXPIRED'
  | 'INACTIVE'
  | string;

export type ComposioConnectedAccount = {
  id: string;
  toolkitSlug: string;
  status: ComposioAccountStatus;
  createdAt: string | null;
  updatedAt: string | null;
};

function parseConnectedAccount(row: Json): ComposioConnectedAccount | null {
  const id = String(row.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    toolkitSlug: String(asObject(row.toolkit).slug ?? '').toUpperCase(),
    status: String(row.status ?? ''),
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null
  };
}

export function isActiveAccount(status: ComposioAccountStatus): boolean {
  return status === 'ACTIVE';
}

export async function listConnectedAccounts(opts: {
  userId: string;
  toolkitSlugs?: string[];
}): Promise<ComposioConnectedAccount[]> {
  const params = new URLSearchParams();
  params.set('user_ids', opts.userId);
  for (const slug of opts.toolkitSlugs ?? []) params.append('toolkit_slugs', slug.toLowerCase());
  params.set('limit', '100');
  const raw = await composioFetch<Json>('GET', `/connected_accounts?${params.toString()}`);
  const out: ComposioConnectedAccount[] = [];
  for (const row of itemsOf(raw)) {
    const parsed = parseConnectedAccount(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export type ComposioConnectLink = {
  redirectUrl: string | null;
  connectedAccountId: string;
  expiresAt: string | null;
};

/**
 * Hosted Connect Link: the user authorizes on Composio's page and the tokens stay there.
 * `redirect_url` is absent for a toolkit that needs no consent (no-auth toolkits), in which
 * case the account is already usable and the caller goes straight to the status check.
 */
export async function createConnectLink(opts: {
  authConfigId: string;
  userId: string;
  callbackUrl?: string | null;
}): Promise<ComposioConnectLink> {
  const raw = await composioFetch<Json>('POST', '/connected_accounts/link', {
    auth_config_id: opts.authConfigId,
    user_id: opts.userId,
    ...(opts.callbackUrl ? { callback_url: opts.callbackUrl } : {})
  });
  const connectedAccountId = String(raw.connected_account_id ?? '').trim();
  if (!connectedAccountId) throw new Error('Composio did not return a connected account id');
  return {
    redirectUrl: raw.redirect_url ? String(raw.redirect_url) : null,
    connectedAccountId,
    expiresAt: raw.expires_at ? String(raw.expires_at) : null
  };
}

/** Revoke at the provider, then drop the account. Best-effort: a dead account must still go. */
export async function deleteConnectedAccount(connectedAccountId: string): Promise<void> {
  const id = encodeURIComponent(connectedAccountId);
  await composioFetch('POST', `/connected_accounts/${id}/revoke`, {}).catch((error) => { swallow('composio call', error); return undefined; });
  await composioFetch('DELETE', `/connected_accounts/${id}`);
}

// ── Tools ─────────────────────────────────────────────────────────────────

export type ComposioTool = {
  slug: string;
  name: string;
  description: string;
  inputSchema: Json;
};

export async function listComposioTools(
  toolkitSlug: string,
  opts?: { limit?: number; query?: string }
): Promise<ComposioTool[]> {
  const params = new URLSearchParams();
  params.set('toolkit_slug', toolkitSlug.toLowerCase());
  params.set('limit', String(opts?.limit ?? 100));
  if (opts?.query?.trim()) params.set('query', opts.query.trim());
  const raw = await composioFetch<Json>('GET', `/tools?${params.toString()}`);
  const out: ComposioTool[] = [];
  for (const row of itemsOf(raw)) {
    const slug = String(row.slug ?? '').trim();
    if (!slug) continue;
    out.push({
      slug,
      name: String(row.name ?? slug),
      description: String(row.description ?? row.human_description ?? slug),
      inputSchema: asObject(row.input_parameters)
    });
  }
  return out;
}

export type ComposioToolResult = { successful: boolean; data: unknown; error: string | null };

export async function executeComposioTool(opts: {
  toolSlug: string;
  connectedAccountId: string;
  /**
   * Required alongside the account id: Composio answers "User ID is required with connected
   * account" without it, because an account is addressed within a user, not on its own.
   */
  userId: string;
  arguments?: Json | null;
}): Promise<ComposioToolResult> {
  const raw = await composioFetch<Json>(
    'POST',
    `/tools/execute/${encodeURIComponent(opts.toolSlug)}`,
    {
      connected_account_id: opts.connectedAccountId,
      user_id: opts.userId,
      arguments: opts.arguments ?? {}
    },
    { timeoutMs: 60_000 }
  );
  const error = raw.error ? redactComposioText(String(raw.error)) : null;
  return {
    successful: raw.successful !== false && !error,
    // The provider's own response body rides along on a failure: it usually names the real
    // problem (404 on a repo that does not exist, a scope the token lacks) far better than
    // Composio's summary line.
    data: raw.data ?? null,
    error
  };
}

// ── Proxy (raw provider API calls, credentials injected by Composio) ───────

export type ComposioProxyResult = {
  ok: boolean;
  status: number;
  data: unknown;
  binary: { url: string; contentType: string; size: number } | null;
};

/**
 * Calls the provider's own API with the connection's credentials, without ever handing us the
 * token. Composio restricts the endpoint to the toolkit's own domain, so this cannot be pointed
 * at an arbitrary host.
 */
export async function composioProxy(opts: {
  connectedAccountId: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<ComposioProxyResult> {
  const parameters: { name: string; value: string; type: 'header' | 'query' }[] = [];
  for (const [name, value] of Object.entries(opts.headers ?? {})) {
    parameters.push({ name, value, type: 'header' });
  }
  const raw = await composioFetch<Json>(
    'POST',
    '/tools/execute/proxy',
    {
      connected_account_id: opts.connectedAccountId,
      endpoint: opts.endpoint,
      method: opts.method,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(parameters.length ? { parameters } : {})
    },
    { timeoutMs: opts.timeoutMs ?? 45_000 }
  );
  const status = Number(raw.status ?? 0);
  const binaryRaw = asObject(raw.binary_data);
  const binary = binaryRaw.url
    ? {
        url: String(binaryRaw.url),
        contentType: String(binaryRaw.content_type ?? 'application/octet-stream'),
        size: Number(binaryRaw.size ?? 0)
      }
    : null;
  return { ok: status >= 200 && status < 300, status, data: raw.data ?? null, binary };
}

// ── Triggers ──────────────────────────────────────────────────────────────

export type ComposioTriggerEvent = {
  eventId: string;
  triggerSlug: string;
  triggerInstanceId: string;
  connectedAccountId: string;
  userId: string;
  data: unknown;
  timestamp: string;
};

/**
 * Create (or update) a trigger instance for one user's connection. Composio keys the instance on
 * (trigger slug, connection, config), so calling this twice with the same config is idempotent
 * and returns the same `ti_*` id.
 */
export async function upsertTriggerInstance(opts: {
  triggerSlug: string;
  userId: string;
  connectedAccountId?: string | null;
  triggerConfig?: Json;
}): Promise<string> {
  const raw = await composioFetch<Json>(
    'POST',
    `/trigger_instances/${encodeURIComponent(opts.triggerSlug)}/upsert`,
    {
      user_id: opts.userId,
      ...(opts.connectedAccountId ? { connected_account_id: opts.connectedAccountId } : {}),
      trigger_config: opts.triggerConfig ?? {}
    }
  );
  const id = String(raw.trigger_id ?? '').trim();
  if (!id) throw new Error(`Composio did not return a trigger id for ${opts.triggerSlug}`);
  return id;
}

export async function deleteTriggerInstance(triggerInstanceId: string): Promise<void> {
  await composioFetch(
    'DELETE',
    `/trigger_instances/manage/${encodeURIComponent(triggerInstanceId)}`
  );
}

/**
 * Verify the Standard Webhooks signature Composio sends: HMAC-SHA256 over
 * `{webhook-id}.{webhook-timestamp}.{rawBody}`, base64, in the `webhook-signature` header
 * (which may carry a `v1,` prefix and several space-separated signatures).
 */
export function verifyComposioWebhook(opts: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  signatureHeader: string | null;
  secret: string;
}): boolean {
  const { rawBody, webhookId, webhookTimestamp, signatureHeader, secret } = opts;
  if (!secret || !webhookId || !webhookTimestamp || !signatureHeader) return false;
  const expected = createHmac('sha256', secret)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest('base64');
  const expectedBuf = Buffer.from(expected);
  for (const part of signatureHeader.split(' ')) {
    const candidate = part.includes(',') ? part.slice(part.indexOf(',') + 1) : part;
    const candidateBuf = Buffer.from(candidate);
    if (candidateBuf.length !== expectedBuf.length) continue;
    if (timingSafeEqual(candidateBuf, expectedBuf)) return true;
  }
  return false;
}

/** The V3 envelope: `metadata` says where the event came from, `data` is the event itself. */
export function parseComposioTriggerEvent(payload: unknown): ComposioTriggerEvent | null {
  const o = asObject(payload);
  if (o.type && o.type !== 'composio.trigger.message') return null;
  const meta = asObject(o.metadata);
  const triggerSlug = String(meta.trigger_slug ?? '').trim();
  const userId = String(meta.user_id ?? '').trim();
  if (!triggerSlug || !userId) return null;
  return {
    eventId: String(o.id ?? meta.log_id ?? `${triggerSlug}-${Date.now()}`),
    triggerSlug,
    triggerInstanceId: String(meta.trigger_id ?? ''),
    connectedAccountId: String(meta.connected_account_id ?? ''),
    userId,
    data: o.data ?? null,
    timestamp: String(o.timestamp ?? new Date().toISOString())
  };
}

/** `brand_<uuid>` is our own convention (see composioUserId) — read it back out. */
export function brandIdFromComposioUser(userId: string): string | null {
  const match = /^brand_([0-9a-f-]{36})$/i.exec(userId.trim());
  return match ? match[1] : null;
}
