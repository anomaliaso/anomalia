/**
 * Ultra-minimal health endpoint (ESM).
 * Kept dependency-free so /health stays up even if the MCP bundle fails to build.
 */
export default function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, mcp-session-id, Last-Event-ID, mcp-protocol-version',
    );
    res.end();
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(
    JSON.stringify({
      ok: true,
      name: 'anomalia-mcp',
      transport: 'streamable-http',
      mcp: '/mcp',
    }),
  );
}

export const config = { maxDuration: 10 };
