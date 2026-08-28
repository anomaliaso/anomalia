#!/usr/bin/env bun
/**
 * Anomalia MCP server (Streamable HTTP) — local Bun.serve.
 * Production on Vercel uses api/*.ts (Node), not this file.
 */
import { loadEnv } from '../lib/config.ts';
import { routeMcpHttp } from './http-router.ts';
import { mcpLog } from './observability.ts';

await loadEnv();

const port = Number(process.env.MCP_PORT ?? process.env.PORT ?? 8787);

const server = Bun.serve({
  port,
  fetch: async (req) => {
    const started = Date.now();
    try {
      const res = await routeMcpHttp(req);
      if (res.status >= 500) {
        mcpLog({
          level: 'error',
          source: 'mcp-http',
          event: 'http.response',
          message: `status ${res.status}`,
          method: req.method,
          path: new URL(req.url).pathname,
          statusCode: res.status,
          durationMs: Date.now() - started,
        });
      }
      return res;
    } catch (e) {
      mcpLog({
        level: 'error',
        source: 'mcp-http',
        event: 'http.unhandled',
        message: e instanceof Error ? e.message : String(e),
        method: req.method,
        path: new URL(req.url).pathname,
        error: e,
        durationMs: Date.now() - started,
      });
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
});

console.error(`Anomalia MCP (HTTP) on http://localhost:${server.port}/mcp`);
console.error(`Health: http://localhost:${server.port}/health`);
