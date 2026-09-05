/**
 * Configuration for the Anomalia CLI.
 * All values are public (no secrets) — hardcoded for zero-config installation.
 *
 * The CLI auto-detects if a local dev server is running on localhost:5174.
 * If yes, uses it. Otherwise, uses the production URL.
 *
 * Override with: PUBLIC_APP_URL=http://my-server:3000 anomalia brands
 */

const LOCAL_URL = 'http://localhost:5173';

/**
 * Canonical production origin — **www, not the apex**.
 *
 * `https://anomalia.so` 308-redirects to `https://www.anomalia.so`, which is a *cross-origin*
 * redirect, and fetch drops the `Authorization` header across origins. Every API call made
 * against the apex therefore arrives unauthenticated and the server answers
 * `401 {"error":"Missing or invalid Authorization header"}` — which reads like a broken login
 * but is really a redirect eating the token. Point at the host that answers directly.
 *
 * Single source of truth on purpose: this literal used to be copy-pasted into api.ts, auth.ts,
 * health.ts and the MCP HTTP layer, so the bug had to be fixed in six places or none.
 */
export const PRODUCTION_URL = 'https://www.anomalia.so';

/** Resolved API/base origin: explicit override, else auto-detected dev server, else production. */
export function appUrl(): string {
  return (process.env.PUBLIC_APP_URL || PRODUCTION_URL).replace(/\/$/, '');
}

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url);

export function authServerUrl(): string {
  const app = appUrl();
  return isLocal(app) ? app : PRODUCTION_URL;
}

// Public Supabase keys (safe to embed — anon key, no secrets)
process.env.PUBLIC_SUPABASE_URL ??= 'https://kszazivzwievqixcnanp.supabase.co';
process.env.PUBLIC_SUPABASE_ANON_KEY ??= 'sb_publishable_gXzHd-4PxJ8UJ-US7mO15Q_bgiGGHvB';

let resolved = false;

export async function loadEnv() {
  if (resolved) return;

  // On Vercel / remote MCP, never probe localhost.
  if (process.env.VERCEL || process.env.MCP_REQUIRE_BEARER === '1') {
    process.env.PUBLIC_APP_URL ??= PRODUCTION_URL;
    resolved = true;
    return;
  }

  // If user explicitly set PUBLIC_APP_URL, use it
  if (process.env.PUBLIC_APP_URL && process.env.PUBLIC_APP_URL !== PRODUCTION_URL) {
    resolved = true;
    return;
  }

  // Auto-detect: try localhost first (dev server), fall back to production
  try {
    await fetch(`${LOCAL_URL}/api/v1/brands`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(1000),
    });
    // If we get any response (even 401), the server is running
    process.env.PUBLIC_APP_URL = LOCAL_URL;
  } catch {
    process.env.PUBLIC_APP_URL = PRODUCTION_URL;
  }

  resolved = true;
}

export function assertEnv() {
  // No required vars — everything has defaults.
}
