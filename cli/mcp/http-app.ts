import { authServerUrl, loadEnv } from '../lib/config.ts';
import { runWithRequestAuth } from './context.ts';
import { mcpLog } from './observability.ts';
import { extractBearer, toAuthInfo, verifyBearerToken } from './verify-token.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(data: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function mcpResourceUrl(req: Request): string {
  const envUrl = process.env.MCP_PUBLIC_URL?.replace(/\/$/, '');
  if (envUrl) return `${envUrl}/mcp`;
  const url = new URL(req.url);
  return `${url.origin}/mcp`;
}

function authServers(): string[] {
  return [authServerUrl()];
}

/**
 * Web-standard fetch handler for Streamable HTTP MCP (stateless + JSON responses).
 * Suitable for Bun.serve and Vercel Node/Edge adapters.
 */
export async function handleMcpFetch(req: Request): Promise<Response> {
  await loadEnv();
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }));
  }

  if (url.pathname === '/health' || url.pathname === '/') {
    return json({
      ok: true,
      name: 'anomalia-mcp',
      transport: 'streamable-http',
      mcp: '/mcp',
    });
  }

  if (url.pathname === '/.well-known/oauth-protected-resource') {
    return json({
      resource: mcpResourceUrl(req),
      authorization_servers: authServers(),
      scopes_supported: ['anomalia'],
      bearer_methods_supported: ['header'],
    });
  }

  if (url.pathname !== '/mcp' && !url.pathname.endsWith('/mcp')) {
    return json({ error: 'Not found' }, 404);
  }

  const bearer = extractBearer(req);
  const verified = await verifyBearerToken(bearer);

  // Remote/public: require Bearer. Local HTTP may also fall back to CLI session file inside tools.
  const requireBearer = process.env.MCP_REQUIRE_BEARER === '1' || process.env.VERCEL === '1';
  if (requireBearer && !verified) {
    mcpLog({
      level: 'warn',
      event: 'auth.unauthorized',
      message: 'Missing or invalid Bearer token',
      method: req.method,
      path: url.pathname,
      statusCode: 401,
    });
    return withCors(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message:
              'Unauthorized. Pass Authorization: Bearer <access_token> from an Anomalia OAuth session.',
          },
          id: null,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': `Bearer realm="anomalia", resource_metadata="${new URL('/.well-known/oauth-protected-resource', req.url).toString()}"`,
          },
        },
      ),
    );
  }

  const run = async (): Promise<Response> => {
    const { WebStandardStreamableHTTPServerTransport } = await import(
      '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
    );
    const { createAnomaliaMcpServer } = await import('./server.ts');

    const server = createAnomaliaMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req, {
        authInfo: verified ? toAuthInfo(verified) : undefined,
      });
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  };

  try {
    const res = verified
      ? await runWithRequestAuth(verified, run)
      : await run();
    return withCors(res);
  } catch (e) {
    mcpLog({
      level: 'error',
      event: 'mcp.handler_error',
      message: e instanceof Error ? e.message : String(e),
      method: req.method,
      path: url.pathname,
      userId: verified?.user.id,
      error: e,
      statusCode: 500,
    });
    return json(
      {
        jsonrpc: '2.0',
        error: { code: -32603, message: e instanceof Error ? e.message : 'Internal error' },
        id: null,
      },
      500,
    );
  }
}
