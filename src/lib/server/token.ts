import crypto from 'node:crypto';
import { env } from '$env/dynamic/private';

// Stateless signed token (HMAC, expiring). No DB row needed — used for one-tap email
// approval and for the OAuth authorization codes / client ids in ./oauth.ts.
//
// Fail-closed: an unset (or default) APP_SECRET must never sign tokens in production —
// the constant is public in this repo, so a default value would let anyone forge
// approval tokens and OAuth authorization codes (account takeover).
function secret(): string {
  const s = env.APP_SECRET;
  if (!s || s === 'dev-insecure-secret-change-me') {
    throw new Error('APP_SECRET is not configured — refusing to sign tokens');
  }
  return s;
}

/** Sign an arbitrary payload with an expiry. `e` is reserved. */
export function signPayload(payload: Record<string, unknown>, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, e: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify signature + expiry. Returns the payload, or null on any tamper/expiry/parse failure. */
export function verifyPayload<T>(token: string): (T & { e: number }) | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof parsed?.e !== 'number' || Date.now() > parsed.e) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function signApproveToken(brandId: string, ttlMs = 1000 * 60 * 60 * 24 * 3): string {
  return signPayload({ b: brandId }, ttlMs);
}

export function verifyApproveToken(token: string): { brandId: string } | null {
  const payload = verifyPayload<{ b: unknown }>(token);
  if (!payload || typeof payload.b !== 'string') return null;
  return { brandId: payload.b };
}
