import type { SupabaseClient } from '@supabase/supabase-js';

// can_enter() depends on the caller's session (admin bypass), so it can only be cached per
// request, not globally. Keyed by the per-request supabase client (WeakMap so entries die
// with the client, no manual eviction needed).
const canEnterCache = new WeakMap<SupabaseClient, Promise<boolean>>();

// Feature flags live in the DB (public.app_flags) — toggle without redeploy.
// `can_enter()` (security-definer) returns true when the waitlist flag is off OR the
// session is an admin. Toggle the waitlist in SQL:
//   update public.app_flags set enabled = true  where key = 'waitlist';  -- re-enable
//   update public.app_flags set enabled = false where key = 'waitlist';  -- open to all
export async function canEnter(supabase: SupabaseClient): Promise<boolean> {
  // can_enter() = NOT waitlist OR is_admin. Waitlist is off in prod and already TTL-cached
  // via flagEnabled — skip the RPC on every /app/[brand] navigation.
  if (!(await flagEnabled(supabase, 'waitlist', true))) return true;

  let cached = canEnterCache.get(supabase);
  if (!cached) {
    cached = Promise.resolve(supabase.rpc('can_enter')).then(({ data }) => data === true);
    canEnterCache.set(supabase, cached);
  }
  return cached;
}

// Flags rarely change and serverless instances are reused (Fluid Compute), so a short
// in-memory TTL cache saves an RPC per request without meaningfully delaying rollout of a
// flag toggle. 60s is long enough to matter under load, short enough that nobody notices.
const flagCache = new Map<string, { value: boolean; expires: number }>();
const FLAG_TTL_MS = 60_000;

// Generic flag read for future use.
export async function flagEnabled(
  supabase: SupabaseClient,
  key: string,
  fallback = false
): Promise<boolean> {
  const cacheKey = `${key}:${fallback}`;
  const cached = flagCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const { data, error } = await supabase.rpc('flag_enabled', { p_key: key, p_default: fallback });
  // Never cache a failed read: one transient RPC error would otherwise pin the flag to the
  // wrong value for every request on this instance for a full TTL. Fall back uncached instead.
  if (error) return fallback;
  const value = data === true;
  flagCache.set(cacheKey, { value, expires: Date.now() + FLAG_TTL_MS });
  return value;
}
