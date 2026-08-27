import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { json } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { createAdminClient } from './supabase-admin';
import { appOrigin } from './app-url';
import { signPayload, verifyPayload } from './token';

/**
 * OAuth 2.1 authorization server for the remote MCP endpoint (https://mcp.anomalia.so/mcp).
 *
 * That server answers 401 with
 *   WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"
 * and the metadata names `https://anomalia.so` as its authorization server — this app.
 * The tokens we hand out are plain Supabase session tokens, i.e. exactly what the MCP
 * server (and `src/lib/server/cli-auth.ts`) already accept as `Authorization: Bearer …`,
 * so nothing on the resource side has to change.
 *
 * Public clients + PKCE only: there is no client secret to leak, and no client table —
 * a registration is a signed, self-describing client_id (see issueClientId).
 */

export const OAUTH_SCOPE = 'anomalia';

const CODE_TTL = 60_000;                          // authorization code: one round-trip
const CLIENT_TTL = 1000 * 60 * 60 * 24 * 365 * 5; // registration: effectively permanent

export const OAUTH_RETURN_COOKIE = 'oauth_return';

export type OAuthClient = { uris: string[]; name: string };

export type AuthCode = {
  /** The account the code was issued for. /token mints its session from this. */
  email: string;
  cid: string;
  uri: string;
  chal: string;
};

// ── Client registration (RFC 7591) ───────────────────────────────
// ponytail: the client_id *is* the registration — signed, so no clients table, no cleanup
// job, no lookup on the hot path. Move to a real table only if we ever need to revoke a
// single client or show the user a list of connected apps.

export function issueClientId(client: OAuthClient): string {
  return signPayload({ c: client }, CLIENT_TTL);
}

export function readClientId(clientId: string): OAuthClient | null {
  const payload = verifyPayload<{ c?: OAuthClient }>(clientId);
  const c = payload?.c;
  if (!c || !Array.isArray(c.uris) || typeof c.name !== 'string') return null;
  return c;
}

function isLoopback(u: URL): boolean {
  // URL keeps IPv6 hosts bracketed: new URL('http://[::1]:1/').hostname === '[::1]'.
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
}

/**
 * Native MCP hosts that use a custom URI scheme (not https/http). Exact match only —
 * arbitrary custom schemes would be an open redirect into other apps.
 * Cursor desktop: `cursor://…`; Cursor cloud agents use the https callback below (already
 * covered by the https rule).
 */
const ALLOWED_CUSTOM_SCHEME_REDIRECTS = new Set([
  'cursor://anysphere.cursor-mcp/oauth/callback'
]);

/** https anywhere, plain http only on loopback (RFC 8252), plus allowlisted custom schemes. */
export function isAllowedRedirectUri(uri: string): boolean {
  if (ALLOWED_CUSTOM_SCHEME_REDIRECTS.has(uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && isLoopback(u);
  } catch {
    return false;
  }
}

/**
 * Exact match, except loopback redirects ignore the port: native clients bind an ephemeral
 * port at authorize time that they could not know when they registered (RFC 8252 §7.3).
 */
export function redirectUriMatches(client: OAuthClient, uri: string): boolean {
  if (client.uris.includes(uri)) return true;
  let asked: URL;
  try {
    asked = new URL(uri);
  } catch {
    return false;
  }
  if (!isLoopback(asked)) return false;
  return client.uris.some((registered) => {
    try {
      const r = new URL(registered);
      return isLoopback(r) && r.protocol === asked.protocol && r.pathname === asked.pathname;
    } catch {
      return false;
    }
  });
}

// ── Authorization code + PKCE ────────────────────────────────────

export function issueCode(code: AuthCode): string {
  return signPayload({ ...code }, CODE_TTL);
}

export function readCode(code: string): AuthCode | null {
  const payload = verifyPayload<Partial<AuthCode>>(code);
  if (!payload?.email || !payload.cid || !payload.uri || !payload.chal) return null;
  return payload as AuthCode;
}

/** PKCE S256 only — `plain` is forbidden by OAuth 2.1. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  const digest = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(digest);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Session minting ──────────────────────────────────────────────

/**
 * Mint a Supabase session that is independent of the browser session.
 *
 * Handing out the *browser's* refresh_token would break the user's own login the first time
 * the MCP client refreshed: Supabase rotates refresh tokens, so whoever refreshes second is
 * logged out. generateLink gives us a one-shot token we can redeem server-side for a separate
 * session with its own refresh chain — the same trick /auth/confirm uses for email links.
 */
export async function mintSession(email: string) {
  const admin = createAdminClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email
  });
  const hashedToken = link?.properties?.hashed_token;
  if (linkError || !hashedToken) throw new Error(linkError?.message ?? 'generateLink returned no token');

  const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' });
  if (error || !data.session) throw new Error(error?.message ?? 'verifyOtp returned no session');
  return data.session;
}

export function anonClient() {
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// ── Discovery URLs ───────────────────────────────────────────────

/**
 * Identificativo dell'authorization server = **l'origin che serve davvero questo documento**.
 *
 * Qui prima si toglieva il `www.` e si annunciava l'apex. Il riferimento a RFC 8414 era giusto
 * (l'`issuer` dev'essere identico all'identificatore da cui il client costruisce l'URL di
 * discovery) ma applicato al contrario: l'apex `https://anomalia.so` non serve niente, Vercel
 * lo 308-redirecta a www a livello di *dominio*, cioè prima del routing del deployment —
 * nessun `vercel.json` può escludere `/.well-known/*` da quel redirect. I client OAuth/MCP che
 * non seguono i redirect in discovery (Smithery, per dirne uno) si fermano esattamente lì:
 *   {"code":"oauth/auth_server_discovery_http_error", "status":308}
 *
 * Quindi l'issuer sta sull'unico host che risponde 200: issuer, endpoint e host che serve i
 * metadata diventano lo stesso origin e la discovery non dipende più da un redirect.
 *
 * L'altra metà della coppia vive in anomalia (`authServerUrl()` in `lib/config.ts`, che
 * riempie `authorization_servers` nel documento RFC 9728 di mcp.anomalia.so): i due valori
 * devono restare identici byte per byte, o i client severi rifiutano i metadata. Si spostano
 * insieme, sempre.
 */
export function issuerFor(url: URL): string {
  return appOrigin(url);
}

export const endpointsFor = (url: URL) => {
  const origin = appOrigin(url);
  return {
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`
  };
};

// ── HTTP helpers ─────────────────────────────────────────────────

// Browser-based MCP hosts (the Inspector, web IDEs) call /token and /register cross-origin.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type, Authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  // OAuth 2.1 requires no-store on token responses; the discovery doc is small enough that
  // sharing one header set beats threading an options object through every call site.
  'cache-control': 'no-store'
};

export function corsJson(body: unknown, status = 200) {
  return json(body, { status, headers: CORS });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export function oauthError(error: string, description: string, status = 400) {
  return corsJson({ error, error_description: description }, status);
}

/**
 * Stash where to come back to after login. /login and /auth/callback always land on /app;
 * this is the one hook that lets an interrupted /oauth/authorize resume instead.
 */
export function stashOAuthReturn(cookies: Cookies, path: string) {
  cookies.set(OAUTH_RETURN_COOKIE, path, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 600
  });
}

/** Read-and-clear. Returns a same-site path only — never an attacker-supplied absolute URL. */
export function takeOAuthReturn(cookies: Cookies): string | null {
  const value = cookies.get(OAUTH_RETURN_COOKIE);
  if (!value) return null;
  cookies.delete(OAUTH_RETURN_COOKIE, { path: '/' });
  return value.startsWith('/oauth/authorize?') ? value : null;
}
