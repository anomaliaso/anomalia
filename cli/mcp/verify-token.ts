import { createClient } from '@supabase/supabase-js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { RequestAuth } from './context.ts';

function anonClient() {
  return createClient(
    process.env.PUBLIC_SUPABASE_URL!,
    process.env.PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Validate an Anomalia / Supabase access token (same JWT the CLI stores after OAuth).
 * Returns undefined if missing/invalid — never accepts a static API key.
 */
export async function verifyBearerToken(bearerToken?: string): Promise<RequestAuth | undefined> {
  if (!bearerToken) return undefined;
  const token = bearerToken.trim();
  if (!token) return undefined;

  try {
    const { data, error } = await anonClient().auth.getUser(token);
    if (error || !data.user?.id || !data.user.email) return undefined;
    return {
      access_token: token,
      user: { id: data.user.id, email: data.user.email },
      source: 'bearer',
    };
  } catch {
    return undefined;
  }
}

export function toAuthInfo(auth: RequestAuth): AuthInfo {
  return {
    token: auth.access_token,
    clientId: auth.user.id,
    scopes: ['anomalia'],
    expiresAt: auth.expires_at,
    extra: { email: auth.user.email, source: auth.source },
  };
}

export function extractBearer(req: Request): string | undefined {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}
