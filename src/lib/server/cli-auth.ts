import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { userCanEnter } from '$lib/server/access';
import { BOOKING_URL } from '$lib/links';

export interface ApiKeyInfo {
  id: string;
  name: string;
  user_id: string;
  permissions: { brand_ids: string[] | '*'; scopes: string[] };
}

/**
 * Authenticate a CLI/API request via Bearer token.
 * Supports two token types:
 *   1. Supabase JWT (standard session token)
 *   2. API Key (starts with "anomalia_", long-lived, hashed in DB)
 *
 * Returns the Supabase client scoped to the user, or an error Response.
 */
type Caller =
  | { supabase: SupabaseClient; user: { id: string; email?: string }; apiKey?: ApiKeyInfo; error?: undefined }
  | { supabase?: undefined; user?: undefined; apiKey?: undefined; error: Response };

/**
 * L'unica porta che CLI e MCP attraversano entrambe. Col prodotto chiuso la guardia sta qui, una
 * volta: metterla per rotta significa dimenticarla nella prossima. Il 403 porta con sé il link
 * alla call — la CLI stampa il corpo della risposta, e "Forbidden" secco a chi ha appena provato
 * a lavorare è il modo peggiore di dirgli che manca un passaggio.
 */
export async function authenticate(request: Request): Promise<Caller> {
  const caller = await resolveCaller(request);
  if (caller.error) return caller;

  if (await userCanEnter(caller.user.id)) return caller;

  return {
    error: json(
      {
        error: `Access not enabled yet — Anomalia opens after a product call. Book it: ${BOOKING_URL}`,
        booking_url: BOOKING_URL
      },
      { status: 403 }
    )
  };
}

async function resolveCaller(request: Request): Promise<Caller> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { error: json({ error: 'Missing or invalid Authorization header' }, { status: 401 }) };
  }
  const token = auth.slice(7);

  // ── API Key path ──────────────────────────────────────────────
  // legacy 021_live_* prefix migrated from the pre-renaming era
  if (token.startsWith('anomalia_') || token.startsWith('021_live_')) {
    const res = await authenticateApiKey(token);
    if ('error' in res && res.error) return res;
    // Write scope, enforced once here instead of per-route: a read-only key may only ever read.
    // Every mutating CLI route is a non-GET, so the method is the whole check.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const denied = checkApiKeyWriteAccess((res as { apiKey: ApiKeyInfo }).apiKey);
      if (denied) return { error: denied };
    }
    return res;
  }

  // ── Supabase JWT path (existing) ─────────────────────────────
  const supabase = createServerClient(publicEnv.PUBLIC_SUPABASE_URL, publicEnv.PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: () => {}
    },
    global: {
      headers: { Authorization: `Bearer ${token}` }
    }
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return { error: json({ error: 'Invalid or expired token' }, { status: 401 }) };
  }

  return { supabase, user };
}

async function authenticateApiKey(token: string) {
  const keyHash = await hashApiKey(token);

  // Service-role client to look up the key (bypasses RLS)
  const adminKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!adminKey) {
    return { error: json({ error: 'Server misconfiguration' }, { status: 500 }) };
  }
  const admin = createClient(publicEnv.PUBLIC_SUPABASE_URL, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: keyRow, error: lookupError } = await admin
    .from('api_keys')
    .select('id, user_id, name, permissions')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (lookupError || !keyRow) {
    return { error: json({ error: 'Invalid API key' }, { status: 401 }) };
  }

  // Fire-and-forget: update last_used_at
  admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id);

  const apiKey: ApiKeyInfo = {
    id: keyRow.id,
    name: keyRow.name,
    user_id: keyRow.user_id,
    permissions: keyRow.permissions as ApiKeyInfo['permissions']
  };

  // Service-role client: it bypasses RLS, so the ownership check RLS would have done has to be
  // redone by hand. Registering the identity here is what lets loadBrandForUser do it — the alternative
  // (remembering a permission call in each of ~60 routes) is what left the tenant boundary open.
  const supabase = createClient(publicEnv.PUBLIC_SUPABASE_URL, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  apiKeyIdentity.set(supabase, { userId: keyRow.user_id, apiKey });

  return {
    supabase,
    user: { id: keyRow.user_id },
    apiKey
  };
}

/**
 * Who is behind a service-role client handed out for an API key. Keyed by the client itself so the
 * check lands in loadBrandForUser without changing every call site.
 */
const apiKeyIdentity = new WeakMap<SupabaseClient, { userId: string; apiKey: ApiKeyInfo }>();

/** Mirrors the auth_brand_ids() RLS predicate: brands of orgs you own ∪ brands you're a member of. */
async function accessibleBrandIds(admin: SupabaseClient, userId: string): Promise<string[]> {
  const [orgs, members] = await Promise.all([
    admin.from('organizations').select('id').eq('owner_id', userId),
    admin.from('brand_members').select('brand_id').eq('user_id', userId)
  ]);
  const ids = new Set<string>((members.data ?? []).map((m: any) => m.brand_id));
  const orgIds = (orgs.data ?? []).map((o: any) => o.id);
  if (orgIds.length) {
    const { data } = await admin.from('brands').select('id').in('org_id', orgIds);
    for (const b of data ?? []) ids.add(b.id);
  }
  return [...ids];
}

/**
 * Brand ids this request is allowed to touch — the user's own brands narrowed to the key's scope.
 * Returns null for JWT auth, where the client is already RLS-scoped and no filtering is needed.
 */
export async function apiKeyBrandIds(supabase: SupabaseClient): Promise<string[] | null> {
  const identity = apiKeyIdentity.get(supabase);
  if (!identity) return null;
  const owned = await accessibleBrandIds(supabase, identity.userId);
  const scoped = identity.apiKey.permissions.brand_ids;
  return scoped === '*' ? owned : owned.filter((id) => scoped.includes(id));
}

/** Hash an API key with SHA-256, returns hex string. */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a new API key. Returns the raw key (show once) and the hash (store). */
export async function generateApiKey(): Promise<{ raw: string; hash: string; prefix: string }> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const raw = `anomalia_live_${hex}`;
  const hash = await hashApiKey(raw);
  const prefix = raw.slice(0, 16); // "anomalia_live_<first 8 hex>"
  return { raw, hash, prefix };
}

// ── API Key permission helpers ─────────────────────────────────

/**
 * Check if an API key has access to a specific brand.
 * Returns undefined if allowed, or a 403 Response if denied.
 * For JWT auth (no apiKey), this is a no-op — RLS handles it.
 */
export function checkApiKeyBrandAccess(
  apiKey: ApiKeyInfo | undefined,
  brandId: string
): Response | undefined {
  if (!apiKey) return undefined; // JWT auth — RLS handles it
  const { brand_ids } = apiKey.permissions;
  if (brand_ids === '*') return undefined;
  if (Array.isArray(brand_ids) && brand_ids.includes(brandId)) return undefined;
  return json({ error: 'API key does not have access to this brand' }, { status: 403 });
}

/**
 * Check if an API key has write permission.
 * Returns undefined if allowed, or a 403 Response if denied.
 * For JWT auth (no apiKey), this is a no-op.
 */
export function checkApiKeyWriteAccess(
  apiKey: ApiKeyInfo | undefined
): Response | undefined {
  if (!apiKey) return undefined; // JWT auth
  if (apiKey.permissions.scopes.includes('write')) return undefined;
  return json({ error: 'API key is read-only' }, { status: 403 });
}

/**
 * Gate an AI-spending CLI action: credits left (free matches Go for feature access).
 * Returns undefined if allowed, or the Response to return.
 */
export async function gateAiAction(
  brand: { id: string; plan?: unknown },
  apiKey: ApiKeyInfo | undefined
): Promise<Response | undefined> {
  const write = checkApiKeyWriteAccess(apiKey);
  if (write) return write;

  const { gateCredits, CreditsExhaustedError } = await import('./credits');
  try {
    await gateCredits(brand.id);
  } catch (e) {
    if (e instanceof CreditsExhaustedError) return json({ error: 'credits_exhausted' }, { status: 402 });
    throw e;
  }
  return undefined;
}

/** The columns loadBrandForUser selects — typed, so callers don't get `unknown` everywhere. */
export type CliBrand = {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;          // NOT NULL, default 'trial'
  plan: string | null;
  timezone: string;        // NOT NULL, default 'Europe/Rome'
  target_platforms: string[] | null;
  launched_at: string | null;
  content_prefs: Record<string, unknown> | null;
  setup_step: string | null;
  setup_completed_at: string | null;
  autopilot_enabled: boolean | null;
  autopilot_failure_count: number | null;
  last_autopilot_run_at: string | null;
  zernio_profile_id: string | null;
  ads_settings: unknown;
} & Record<string, unknown>;

/**
 * Load a brand by slug, verifying it belongs to the authenticated user via RLS.
 *
 * API-key requests run as service-role (RLS bypassed), so when `apiKey` is present the tenant
 * boundary is re-applied by hand: the brand must belong to the key's user (as org owner or
 * brand member) AND be within the key's `brand_ids` scope. 404 (not 403) — an API key must not
 * be able to probe which slugs exist.
 */
export async function loadBrandForUser(
  supabase: SupabaseClient,
  slug: string,
  apiKey?: ApiKeyInfo | undefined
): Promise<{ brand: CliBrand; error?: undefined }
  | { brand?: undefined; error: Response }
> {
  // Service-role (API key) can see every row for a slug; JWT+RLS usually returns one.
  // Never maybeSingle() here — duplicate trial rows for the same slug exist in prod.
  const { data: rows, error } = await supabase
    .from('brands')
    .select('id, org_id, name, slug, status, plan, timezone, target_platforms, launched_at, content_prefs, setup_step, setup_completed_at, autopilot_enabled, autopilot_failure_count, last_autopilot_run_at, zernio_profile_id, ads_settings')
    .eq('slug', slug);

  if (error || !rows?.length) {
    return { error: json({ error: 'Brand not found' }, { status: 404 }) };
  }

  let candidates = rows as CliBrand[];

  // API-key path: the client bypassed RLS, so re-apply the tenant boundary by hand.
  if (apiKey) {
    const scoped: CliBrand[] = [];
    for (const brand of candidates) {
      const denied = checkApiKeyBrandAccess(apiKey, brand.id);
      if (denied) continue;

      const { data: org } = await supabase
        .from('organizations')
        .select('id')
        .eq('id', brand.org_id)
        .eq('owner_id', apiKey.user_id)
        .maybeSingle();

      if (org) {
        scoped.push(brand);
        continue;
      }

      const { data: member } = await supabase
        .from('brand_members')
        .select('brand_id')
        .eq('brand_id', brand.id)
        .eq('user_id', apiKey.user_id)
        .maybeSingle();

      if (member) scoped.push(brand);
    }
    candidates = scoped;
  }

  // Defense in depth: catches callers that forgot to pass `apiKey` while the client is still
  // registered in the API-key identity map. No-op for JWT and for callers that passed apiKey.
  const allowed = await apiKeyBrandIds(supabase);
  if (allowed) {
    candidates = candidates.filter((b) => allowed.includes(b.id));
  }

  if (!candidates.length) {
    return { error: json({ error: 'Brand not found' }, { status: 404 }) };
  }

  // Prefer the live brand when slug collisions exist (active > trial, launched first).
  const rank = (b: CliBrand) =>
    (b.status === 'active' ? 100 : 0) + (b.launched_at ? 10 : 0) + (b.plan ? 1 : 0);
  candidates.sort((a, b) => rank(b) - rank(a));

  return { brand: candidates[0] };
}
