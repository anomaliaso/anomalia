import type { SupabaseClient, Session, User } from '@supabase/supabase-js';

// In-memory caches for same-instance SPA navigations (Vercel Fluid Compute reuses the isolate).
// These are the difference between 2–3s per click (getUser + fat brand row every time) and a
// cache hit that lets the page load run immediately after parent().

const USER_TTL_MS = 30_000;
const SHELL_TTL_MS = 20_000;
const MAX_ENTRIES = 400;

type Timed<T> = { value: T; at: number };

const userByToken = new Map<string, Timed<User>>();
const brandShellByKey = new Map<string, Timed<BrandShell>>();
const brandDeferredByKey = new Map<string, Timed<unknown>>();

export type BrandShell = {
  brand: Record<string, unknown>;
  brandRows: Record<string, unknown>[] | null;
};

function prune<T>(map: Map<string, Timed<T>>, ttl: number) {
  if (map.size <= MAX_ENTRIES) return;
  const cutoff = Date.now() - ttl;
  for (const [k, v] of map) {
    if (v.at < cutoff) map.delete(k);
  }
  if (map.size > MAX_ENTRIES) {
    const extra = map.size - MAX_ENTRIES;
    let i = 0;
    for (const k of map.keys()) {
      map.delete(k);
      if (++i >= extra) break;
    }
  }
}

/**
 * Re-validate the JWT with Auth at most once per token per TTL.
 * getSession() is local (cookie → JWT); getUser() is a network round-trip to GoTrue and was
 * running on every in-app click. A revoked session still dies within USER_TTL_MS, and a token
 * refresh (new access_token) misses the cache immediately.
 */
export async function verifiedUser(
  supabase: SupabaseClient,
  session: Session
): Promise<User | null> {
  const token = session.access_token;
  if (!token) return null;
  const now = Date.now();
  const expMs = (session.expires_at ?? 0) * 1000;
  if (expMs && expMs < now + 8_000) {
    userByToken.delete(token);
  } else {
    const hit = userByToken.get(token);
    if (hit && now - hit.at < USER_TTL_MS) return hit.value;
  }

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error || !user) {
    userByToken.delete(token);
    return null;
  }
  userByToken.set(token, { value: user, at: now });
  prune(userByToken, USER_TTL_MS);
  return user;
}

function shellKey(userId: string, slug: string) {
  return `${userId}:${slug}`;
}

export function getBrandShell(userId: string, slug: string): BrandShell | null {
  const hit = brandShellByKey.get(shellKey(userId, slug));
  if (!hit) return null;
  if (Date.now() - hit.at >= SHELL_TTL_MS) {
    brandShellByKey.delete(shellKey(userId, slug));
    return null;
  }
  return hit.value;
}

export function setBrandShell(userId: string, slug: string, shell: BrandShell) {
  brandShellByKey.set(shellKey(userId, slug), { value: shell, at: Date.now() });
  prune(brandShellByKey, SHELL_TTL_MS);
}

export function getBrandDeferred<T>(userId: string, slug: string): T | null {
  const hit = brandDeferredByKey.get(shellKey(userId, slug));
  if (!hit) return null;
  if (Date.now() - hit.at >= SHELL_TTL_MS) {
    brandDeferredByKey.delete(shellKey(userId, slug));
    return null;
  }
  return hit.value as T;
}

export function setBrandDeferred(userId: string, slug: string, extras: unknown) {
  brandDeferredByKey.set(shellKey(userId, slug), { value: extras, at: Date.now() });
  prune(brandDeferredByKey, SHELL_TTL_MS);
}

function dropKeysForUser<T>(map: Map<string, T>, userId: string, slug?: string) {
  if (slug) {
    map.delete(shellKey(userId, slug));
    return;
  }
  const prefix = `${userId}:`;
  for (const k of map.keys()) {
    if (k.startsWith(prefix)) map.delete(k);
  }
}

function dropKeysForSlug<T>(map: Map<string, T>, slug: string) {
  for (const k of map.keys()) {
    const sep = k.indexOf(':');
    if (sep >= 0 && k.slice(sep + 1) === slug) map.delete(k);
  }
}

/** Drop cached shell after a brand write so the next navigation sees the new name/logo/prefs. */
export function invalidateBrandShell(userId: string, slug?: string) {
  dropKeysForUser(brandShellByKey, userId, slug);
  dropKeysForUser(brandDeferredByKey, userId, slug);
}

/** Form actions have the slug, not always the user id — drop every user's copy of this brand. */
export function invalidateBrandNav(slug: string) {
  dropKeysForSlug(brandShellByKey, slug);
  dropKeysForSlug(brandDeferredByKey, slug);
}

/** Columns the brand layout needs to render the shell. Kit is logo-only — studio fields load deferred. */
export const BRAND_SHELL_SELECT =
  'id, name, slug, website, status, plan, timezone, target_platforms, launched_at, content_prefs, blog_config, setup_step, setup_completed_at, onboarding_completed_at, onboarding_state, autopilot_enabled, autopilot_failure_count, chat_default_tier, zernio_profile_id, ads_settings, brand_kit(favicon_url, logos)';

export const BRAND_SWITCHER_SELECT = 'id, name, slug, status, brand_kit(favicon_url, logos)';
