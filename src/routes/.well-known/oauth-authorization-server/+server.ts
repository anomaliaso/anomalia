import { corsJson, corsPreflight, endpointsFor, issuerFor, OAUTH_SCOPE } from '$lib/server/oauth';
import { appOrigin } from '$lib/server/app-url';
import type { RequestHandler } from './$types';

// RFC 8414 discovery. mcp.anomalia.so points MCP clients here via its
// /.well-known/oauth-protected-resource document; before this route existed they got the
// SvelteKit 404 page and died trying to JSON.parse "<!doctype html>".
export const GET: RequestHandler = ({ url }) =>
  corsJson({
    issuer: issuerFor(url),
    ...endpointsFor(url),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [OAUTH_SCOPE],
    service_documentation: `${appOrigin(url)}/docs/mcp`
  });

export const OPTIONS: RequestHandler = () => corsPreflight();
