import { handleMcpFetch } from '../mcp/http-app.ts';
import { authServerUrl } from '../lib/config.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

/**
 * Shared HTTP router for local Bun (`mcp/http.ts`) and Vercel (`api/*`).
 * Kept free of framework detection at the repo root (no Hono in app.ts).
 */
export async function routeMcpHttp(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (url.pathname === '/health' || url.pathname === '/' || url.pathname === '/api/health') {
    return json({
      ok: true,
      name: 'anomalia-mcp',
      transport: 'streamable-http',
      mcp: '/mcp',
    });
  }

  if (
    url.pathname === '/.well-known/oauth-protected-resource' ||
    url.pathname === '/api/oauth-protected-resource'
  ) {
    const appUrl = authServerUrl();
    const publicUrl = (process.env.MCP_PUBLIC_URL ?? url.origin).replace(/\/$/, '');
    return json({
      resource: `${publicUrl}/mcp`,
      authorization_servers: [appUrl],
      scopes_supported: ['anomalia'],
      bearer_methods_supported: ['header'],
    });
  }

  if (url.pathname === '/mcp' || url.pathname === '/api/mcp' || url.pathname.endsWith('/mcp')) {
    // Normalize path so the MCP handler sees /mcp
    const normalized = new URL(req.url);
    normalized.pathname = '/mcp';
    const forwarded = new Request(normalized, req);
    return handleMcpFetch(forwarded);
  }

  return json({ error: 'Not found', hint: 'Use /mcp or /health' }, 404);
}
