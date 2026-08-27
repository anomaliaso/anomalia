// Google Search Console — first-party OAuth + Search Analytics sync.
// Tokens in Vault (`platform: 'search_console'`); metadata in brand_gsc_connections.
import { swallow } from '$lib/server/swallow';
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { storeSecrets, loadSecrets, deleteSecrets } from '$lib/server/integration-secrets';

export const GSC_PLATFORM = 'search_console';
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** Single Google OAuth redirect — brand is carried in `state`, not in the path. */
export const GSC_OAUTH_CALLBACK_PATH = '/auth/gsc/callback';

export function gscConfigured(): boolean {
  return !!(env.GOOGLE_GSC_CLIENT_ID && env.GOOGLE_GSC_CLIENT_SECRET);
}

/** Absolute redirect_uri registered once in Google Cloud (Web client). */
export function gscOAuthRedirectUri(origin: string): string {
  const base = String(origin ?? '').replace(/\/$/, '');
  return `${base}${GSC_OAUTH_CALLBACK_PATH}`;
}

export type GscConnection = {
  brand_id: string;
  site_url: string | null;
  permission_level: string | null;
  active: boolean;
  synced_at: string | null;
  last_error: string | null;
  connected_at: string;
};

export type GscMetricRow = {
  date: string;
  query: string;
  page: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscSite = { siteUrl: string; permissionLevel: string };

export type GscSummary = {
  /** OAuth tokens saved (Google account linked) — a property may still be unselected. */
  connected: boolean;
  configured: boolean;
  siteUrl: string | null;
  syncedAt: string | null;
  lastError: string | null;
  clicks28d: number;
  impressions28d: number;
  topQueries: Array<{ query: string; clicks: number; impressions: number; position: number }>;
  topPages: Array<{ page: string; clicks: number; impressions: number; position: number }>;
};

export function hostnameFromWebsite(website: string | null | undefined): string {
  const raw = String(website ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .toLowerCase();
  }
}

/** True when a GSC property covers the brand website (URL-prefix or domain property). */
export function gscSiteMatchesWebsite(siteUrl: string, website: string | null | undefined): boolean {
  const host = hostnameFromWebsite(website);
  if (!host || !siteUrl) return false;
  const site = siteUrl.trim();
  if (/^sc-domain:/i.test(site)) {
    const domain = site.slice(site.indexOf(':') + 1).replace(/\/+$/, '').toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  }
  const siteHost = hostnameFromWebsite(site);
  return !!siteHost && siteHost === host;
}

export function parseGscSiteList(data: unknown): GscSite[] {
  if (!data || typeof data !== 'object') return [];
  const rec = data as Record<string, unknown>;
  const raw = rec.siteEntry ?? rec.site_entry ?? rec.sites;
  if (!Array.isArray(raw)) return [];
  const out: GscSite[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const siteUrl = String(o.siteUrl ?? o.site_url ?? '').trim();
    if (!siteUrl) continue;
    out.push({
      siteUrl,
      permissionLevel: String(o.permissionLevel ?? o.permission_level ?? '')
    });
  }
  return out;
}

export function rankGscSites(
  sites: GscSite[],
  website?: string | null,
  selected?: string | null
): GscSite[] {
  const selectedUrl = String(selected ?? '').trim();
  return [...sites].sort((a, b) => {
    const aMatch = gscSiteMatchesWebsite(a.siteUrl, website) ? 0 : 1;
    const bMatch = gscSiteMatchesWebsite(b.siteUrl, website) ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    const aSel = a.siteUrl === selectedUrl ? 0 : 1;
    const bSel = b.siteUrl === selectedUrl ? 0 : 1;
    if (aSel !== bSel) return aSel - bSel;
    return a.siteUrl.localeCompare(b.siteUrl);
  });
}

function oauthBase() {
  return {
    clientId: env.GOOGLE_GSC_CLIENT_ID!,
    clientSecret: env.GOOGLE_GSC_CLIENT_SECRET!
  };
}

/** Build Google OAuth consent URL. `state` should encode brand slug + CSRF nonce. */
export function buildGscAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = oauthBase();
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GSC_SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeGscCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const { clientId, clientSecret } = oauthBase();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!res.ok) throw new Error(`GSC token exchange failed: ${await res.text()}`.slice(0, 300));
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret } = oauthBase();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) throw new Error(`GSC refresh failed: ${await res.text()}`.slice(0, 300));
  return res.json();
}

async function getAccessToken(admin: SupabaseClient, brandId: string): Promise<string> {
  const secrets = await loadSecrets(admin, brandId, GSC_PLATFORM);
  if (!secrets?.refresh_token && !secrets?.access_token) throw new Error('GSC not connected');
  const expiresAt = Number(secrets.expires_at || 0);
  if (secrets.access_token && Date.now() < expiresAt - 60_000) return secrets.access_token;
  if (!secrets.refresh_token) throw new Error('GSC refresh token missing — reconnect');
  const refreshed = await refreshAccessToken(secrets.refresh_token);
  await storeSecrets(admin, brandId, GSC_PLATFORM, {
    ...secrets,
    access_token: refreshed.access_token,
    expires_at: String(Date.now() + refreshed.expires_in * 1000)
  });
  return refreshed.access_token;
}

export async function hasGscTokens(admin: SupabaseClient, brandId: string): Promise<boolean> {
  const secrets = await loadSecrets(admin, brandId, GSC_PLATFORM);
  return !!(secrets?.refresh_token || secrets?.access_token);
}

export async function listGscSites(admin: SupabaseClient, brandId: string): Promise<GscSite[]> {
  const token = await getAccessToken(admin, brandId);
  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`GSC sites list failed: ${await res.text()}`.slice(0, 300));
  return parseGscSiteList(await res.json());
}

async function upsertGscConnectionRow(
  admin: SupabaseClient,
  row: {
    brand_id: string;
    site_url?: string | null;
    permission_level?: string | null;
    active?: boolean;
    last_error?: string | null;
    updated_at?: string;
  }
): Promise<void> {
  const { error } = await admin.from('brand_gsc_connections').upsert(
    { active: true, last_error: null, updated_at: new Date().toISOString(), ...row },
    { onConflict: 'brand_id' }
  );
  if (error) throw new Error(`GSC connection save failed: ${error.message}`);
}

export async function saveGscConnection(
  admin: SupabaseClient,
  brandId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in: number },
  siteUrl?: string | null
): Promise<void> {
  const existing = (await loadSecrets(admin, brandId, GSC_PLATFORM)) ?? {};
  await storeSecrets(admin, brandId, GSC_PLATFORM, {
    ...existing,
    access_token: tokens.access_token,
    ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
    expires_at: String(Date.now() + tokens.expires_in * 1000)
  });
  const { data: existingConn } = await admin
    .from('brand_gsc_connections')
    .select('site_url')
    .eq('brand_id', brandId)
    .maybeSingle();
  const nextSite = siteUrl !== undefined ? siteUrl : (existingConn?.site_url ?? null);
  await upsertGscConnectionRow(admin, {
    brand_id: brandId,
    site_url: nextSite,
    active: true,
    last_error: null
  });
}

export async function setGscSiteUrl(
  admin: SupabaseClient,
  brandId: string,
  siteUrl: string,
  permissionLevel?: string
): Promise<void> {
  await upsertGscConnectionRow(admin, {
    brand_id: brandId,
    site_url: siteUrl,
    permission_level: permissionLevel ?? null,
    active: true,
    last_error: null
  });
}

export async function disconnectGsc(admin: SupabaseClient, brandId: string): Promise<void> {
  await deleteSecrets(admin, brandId, GSC_PLATFORM);
  await admin.from('brand_gsc_connections').delete().eq('brand_id', brandId);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Sync Search Analytics for the selected property. Dimensions: date+query+page. */
export async function syncGscMetrics(
  admin: SupabaseClient,
  brandId: string,
  opts: { days?: number } = {}
): Promise<{ rows: number }> {
  const { data: conn } = await admin
    .from('brand_gsc_connections')
    .select('site_url, active')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!conn?.active || !conn.site_url) throw new Error('GSC site not selected');

  const token = await getAccessToken(admin, brandId);
  const days = Math.min(Math.max(opts.days ?? 3, 1), 28);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2); // GSC late data
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const siteUrl = encodeURIComponent(conn.site_url);
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${siteUrl}/searchAnalytics/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      startDate: isoDate(start),
      endDate: isoDate(end),
      dimensions: ['date', 'query', 'page'],
      rowLimit: 25000,
      dataState: 'final'
    })
  });

  if (!res.ok) {
    const err = `GSC sync failed: ${await res.text()}`.slice(0, 400);
    await admin
      .from('brand_gsc_connections')
      .update({ last_error: err, updated_at: new Date().toISOString() })
      .eq('brand_id', brandId);
    throw new Error(err);
  }

  const data = await res.json();
  const apiRows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> =
    data.rows ?? [];

  const upserts = apiRows.map((r) => ({
    brand_id: brandId,
    date: r.keys[0]!,
    query: r.keys[1] ?? '',
    page: r.keys[2] ?? '',
    country: '',
    device: '',
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0
  }));

  // Chunk upserts
  for (let i = 0; i < upserts.length; i += 500) {
    const chunk = upserts.slice(i, i + 500);
    const { error } = await admin.from('brand_gsc_metrics').upsert(chunk, {
      onConflict: 'brand_id,date,query,page,country,device'
    });
    if (error) throw new Error(`GSC metrics upsert: ${error.message}`);
  }

  await admin
    .from('brand_gsc_connections')
    .update({
      synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('brand_id', brandId);

  return { rows: upserts.length };
}

export async function loadGscSummary(admin: SupabaseClient, brandId: string): Promise<GscSummary> {
  const configured = gscConfigured();
  const { data: conn } = await admin
    .from('brand_gsc_connections')
    .select('site_url, synced_at, last_error, active')
    .eq('brand_id', brandId)
    .maybeSingle();

  let tokens = false;
  if (!conn?.active) {
    tokens = await hasGscTokens(admin, brandId);
    if (tokens && !conn) {
      try {
        await upsertGscConnectionRow(admin, { brand_id: brandId, site_url: null, active: true });
      } catch (error) { swallow('upsert gsc connection row', error); }
    }
  }
  const oauthConnected = !!(conn?.active) || tokens;

  const empty: GscSummary = {
    connected: oauthConnected,
    configured,
    siteUrl: conn?.site_url ?? null,
    syncedAt: conn?.synced_at ?? null,
    lastError: conn?.last_error ?? null,
    clicks28d: 0,
    impressions28d: 0,
    topQueries: [],
    topPages: []
  };
  if (!oauthConnected || !conn?.site_url) return empty;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 28);
  const { data: rows } = await admin
    .from('brand_gsc_metrics')
    .select('query, page, clicks, impressions, position')
    .eq('brand_id', brandId)
    .gte('date', isoDate(since));

  const qMap = new Map<string, { clicks: number; impressions: number; position: number; n: number }>();
  const pMap = new Map<string, { clicks: number; impressions: number; position: number; n: number }>();
  let clicks28d = 0;
  let impressions28d = 0;
  for (const r of rows ?? []) {
    const c = Number(r.clicks) || 0;
    const im = Number(r.impressions) || 0;
    const pos = Number(r.position) || 0;
    clicks28d += c;
    impressions28d += im;
    if (r.query) {
      const cur = qMap.get(r.query) ?? { clicks: 0, impressions: 0, position: 0, n: 0 };
      cur.clicks += c;
      cur.impressions += im;
      cur.position += pos;
      cur.n += 1;
      qMap.set(r.query, cur);
    }
    if (r.page) {
      const cur = pMap.get(r.page) ?? { clicks: 0, impressions: 0, position: 0, n: 0 };
      cur.clicks += c;
      cur.impressions += im;
      cur.position += pos;
      cur.n += 1;
      pMap.set(r.page, cur);
    }
  }

  const topQueries = [...qMap.entries()]
    .map(([query, v]) => ({
      query,
      clicks: Math.round(v.clicks),
      impressions: Math.round(v.impressions),
      position: v.n ? Math.round((v.position / v.n) * 10) / 10 : 0
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);

  const topPages = [...pMap.entries()]
    .map(([page, v]) => ({
      page,
      clicks: Math.round(v.clicks),
      impressions: Math.round(v.impressions),
      position: v.n ? Math.round((v.position / v.n) * 10) / 10 : 0
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20);

  return { ...empty, clicks28d: Math.round(clicks28d), impressions28d: Math.round(impressions28d), topQueries, topPages };
}

/**
 * True when GSC can ground SEO priorities: OAuth connected, property selected, recent sync, and some data.
 * When OAuth is not configured on the environment, returns true (nothing to connect — don't nag).
 */
export function gscReadyFromSummary(gsc: GscSummary, maxAgeDays = 7): boolean {
  if (!gsc.configured) return true;
  if (!gsc.connected || !gsc.siteUrl || !gsc.syncedAt) return false;
  const syncedMs = new Date(gsc.syncedAt).getTime();
  if (!Number.isFinite(syncedMs)) return false;
  if (Date.now() - syncedMs > maxAgeDays * 86_400_000) return false;
  return gsc.clicks28d + gsc.impressions28d > 0 || gsc.topQueries.length > 0;
}

export async function loadGscReady(
  admin: SupabaseClient,
  brandId: string
): Promise<{ ready: boolean; summary: GscSummary }> {
  const summary = await loadGscSummary(admin, brandId);
  return { ready: gscReadyFromSummary(summary), summary };
}

/** Prompt block for agents / keyword strategy when GSC has owned queries. */
export function formatGscPromptBlock(gsc: GscSummary): string {
  if (!gsc.connected || !gsc.topQueries.length) return '';
  return `OWNED SEARCH (Google Search Console, 28d — prefer these over estimates):
Property: ${gsc.siteUrl ?? 'n/a'}. Synced: ${gsc.syncedAt ?? 'n/a'}.
Clicks: ${gsc.clicks28d}. Impressions: ${gsc.impressions28d}.
Top queries: ${gsc.topQueries
    .slice(0, 20)
    .map((q) => `${q.query} (${q.clicks} clicks, pos ${q.position})`)
    .join('; ')}
Top pages: ${gsc.topPages
    .slice(0, 10)
    .map((p) => `${p.page} (${p.clicks} clicks)`)
    .join('; ')}`;
}

/** Normalize a query for owned-vs-initiative matching. */
export function normalizeSearchQuery(q: string): string {
  return String(q ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Share of initiative targetQuery values that match an owned GSC query (exact or contains). */
export function ownedQueryCoverage(
  targetQueries: string[],
  ownedQueries: string[]
): { matched: number; total: number; ratio: number } {
  const owned = ownedQueries.map(normalizeSearchQuery).filter(Boolean);
  const total = targetQueries.length;
  if (!total || !owned.length) return { matched: 0, total, ratio: 0 };
  let matched = 0;
  for (const t of targetQueries) {
    const n = normalizeSearchQuery(t);
    if (!n) continue;
    if (owned.some((o) => o === n || o.includes(n) || n.includes(o))) matched++;
  }
  return { matched, total, ratio: matched / total };
}

/** Daily cron: sync last 3 days for every active GSC connection. */
export async function gscTickAll(
  admin: SupabaseClient,
  opts: { brandSlug?: string | null } = {}
): Promise<{ synced: number; errors: number }> {
  const { data: rows } = await admin
    .from('brand_gsc_connections')
    .select('brand_id, site_url, active')
    .eq('active', true);

  let synced = 0;
  let errors = 0;
  for (const row of rows ?? []) {
    if (!row.site_url) continue;
    if (opts.brandSlug) {
      const { data: b } = await admin.from('brands').select('slug, status').eq('id', row.brand_id).maybeSingle();
      if (!b || b.slug !== opts.brandSlug || b.status !== 'active') continue;
    } else {
      const { data: b } = await admin.from('brands').select('status').eq('id', row.brand_id).maybeSingle();
      if (!b || b.status !== 'active') continue;
    }
    try {
      await syncGscMetrics(admin, row.brand_id, { days: 3 });
      synced++;
    } catch (e) {
      errors++;
      console.error('[gsc/tick]', row.brand_id, e instanceof Error ? e.message : e);
    }
  }
  return { synced, errors };
}
