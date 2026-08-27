import {
  corsJson,
  corsPreflight,
  isAllowedRedirectUri,
  issueClientId,
  oauthError
} from '$lib/server/oauth';
import type { RequestHandler } from './$types';

// RFC 7591 dynamic client registration. MCP hosts register themselves on first connect —
// without this they cannot obtain a client_id and the flow never starts.
export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return oauthError('invalid_client_metadata', 'Body must be JSON');
  }

  const requested = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (requested.length === 0) {
    return oauthError('invalid_redirect_uri', 'redirect_uris is required');
  }
  // Multi-URI DCR: register only the valid subset. Cursor sends both
  // `cursor://anysphere.cursor-mcp/oauth/callback` and
  // `https://www.cursor.com/agents/mcp/oauth/callback` — rejecting the whole
  // registration for one disallowed URI broke MCP OAuth with Cursor.
  const uris = requested.filter(isAllowedRedirectUri);
  if (uris.length === 0) {
    return oauthError(
      'invalid_redirect_uri',
      `No https, loopback, or allowlisted redirect URI among: ${requested.join(', ')}`
    );
  }

  const name = String(body.client_name ?? '').trim().slice(0, 80) || 'MCP client';
  const clientId = issueClientId({ uris, name });

  return corsJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      // Public client: PKCE is the proof, so there is no secret to store or rotate.
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    },
    201
  );
};

export const OPTIONS: RequestHandler = () => corsPreflight();
