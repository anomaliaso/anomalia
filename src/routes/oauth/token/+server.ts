import {
  anonClient,
  corsJson,
  corsPreflight,
  mintSession,
  oauthError,
  OAUTH_SCOPE,
  readCode,
  verifyPkce
} from '$lib/server/oauth';
import type { Session } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

/** Spec says form-urlencoded; a few MCP hosts post JSON. Accept both. */
async function readParams(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>;
    return new URLSearchParams(
      Object.entries(body).map(([k, v]) => [k, String(v)])
    );
  }
  return new URLSearchParams(await request.text());
}

function tokenResponse(session: Session) {
  return corsJson({
    access_token: session.access_token,
    token_type: 'Bearer',
    expires_in: session.expires_in ?? 3600,
    refresh_token: session.refresh_token,
    scope: OAUTH_SCOPE
  });
}

export const POST: RequestHandler = async ({ request }) => {
  let params: URLSearchParams;
  try {
    params = await readParams(request);
  } catch {
    return oauthError('invalid_request', 'Unparseable body');
  }

  const grantType = params.get('grant_type');

  if (grantType === 'refresh_token') {
    const refreshToken = params.get('refresh_token') ?? '';
    if (!refreshToken) return oauthError('invalid_request', 'refresh_token is required');
    const { data, error } = await anonClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) return oauthError('invalid_grant', 'Refresh token rejected');
    return tokenResponse(data.session);
  }

  if (grantType !== 'authorization_code') {
    return oauthError('unsupported_grant_type', `Unsupported grant_type: ${grantType ?? '(none)'}`);
  }

  const code = params.get('code') ?? '';
  const verifier = params.get('code_verifier') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const clientId = params.get('client_id') ?? '';

  // ponytail: codes are stateless (signed, 60s TTL) and bound to client_id + redirect_uri +
  // PKCE challenge, so a replay needs the original client's code_verifier within the minute.
  // Add a used-codes table if we ever want strict single-use.
  const parsed = readCode(code);
  if (!parsed) return oauthError('invalid_grant', 'Authorization code invalid or expired');
  if (parsed.cid !== clientId) return oauthError('invalid_grant', 'client_id does not match the code');
  if (parsed.uri !== redirectUri) return oauthError('invalid_grant', 'redirect_uri does not match the code');
  if (!verifyPkce(verifier, parsed.chal)) return oauthError('invalid_grant', 'PKCE verification failed');

  try {
    return tokenResponse(await mintSession(parsed.email));
  } catch (e) {
    return oauthError('server_error', e instanceof Error ? e.message : 'Could not mint a session', 500);
  }
};

export const OPTIONS: RequestHandler = () => corsPreflight();
