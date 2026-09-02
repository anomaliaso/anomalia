import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase-admin';

// can_enter() depends on the caller's session (admin bypass), so it can only be cached per
// request, not globally. Keyed by the per-request supabase client (WeakMap so entries die
// with the client, no manual eviction needed).
const canEnterCache = new WeakMap<SupabaseClient, Promise<boolean>>();

// Feature flags live in the DB (public.app_flags) — toggle without redeploy.
// `can_enter()` (security-definer) = NOT closed_beta OR is_approved(). Toggle in SQL:
//   update public.app_flags set enabled = true  where key = 'closed_beta';  -- close
//   update public.app_flags set enabled = false where key = 'closed_beta';  -- open to all
//
// Il default è `false` — aperto — e non per distrazione: una lettura del flag che fallisce
// chiuderebbe fuori ogni cliente che paga, e questa è una porta commerciale, non un confine di
// sicurezza. Il costo dei due lati non è lo stesso, e il fallback sta dalla parte meno cara.
export async function canEnter(supabase: SupabaseClient): Promise<boolean> {
  // Col prodotto aperto la risposta è già nota: nessun RPC per navigazione.
  if (!(await flagEnabled(supabase, 'closed_beta', false))) return true;

  let cached = canEnterCache.get(supabase);
  if (!cached) {
    cached = Promise.resolve(supabase.rpc('can_enter')).then(({ data }) => data === true);
    canEnterCache.set(supabase, cached);
  }
  return cached;
}

/**
 * La stessa porta, ma per un utente di cui non abbiamo la sessione: la CLI e l'MCP arrivano con una
 * chiave API su un client service-role, dove `auth.uid()` è nullo e `can_enter()` direbbe sempre no.
 * Il predicato resta uno solo — `is_approved(uuid)` in SQL — perché una regola riscritta in
 * TypeScript accanto a quella in plpgsql diverge al primo cambio, in silenzio.
 */
export async function userCanEnter(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  if (!(await flagEnabled(admin, 'closed_beta', false))) return true;
  const { data } = await admin.rpc('is_approved', { p_user: userId });
  return data === true;
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
