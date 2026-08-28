import { describe, expect, test } from 'bun:test';
import { handleMcpFetch } from './http-app.ts';

describe('mcp HTTP transport', () => {
  test('health endpoint', async () => {
    const res = await handleMcpFetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mcp).toBe('/mcp');
  });

  test('oauth protected resource metadata', async () => {
    const res = await handleMcpFetch(
      new Request('http://localhost/.well-known/oauth-protected-resource'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resource).toContain('/mcp');
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    expect(body.authorization_servers.length).toBeGreaterThan(0);
  });

  test('initialize + tools/list over streamable HTTP (JSON)', async () => {
    const initRes = await handleMcpFetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '0.0.1' },
          },
        }),
      }),
    );
    expect(initRes.status).toBe(200);
    const initBody = await initRes.json();
    expect(initBody.result?.serverInfo?.name).toBe('anomalia');

    const listRes = await handleMcpFetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      }),
    );
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const names = (listBody.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toContain('list_brands');
    expect(names).toContain('login');
    expect(names.length).toBeGreaterThan(50);
  });

  test('requires bearer when MCP_REQUIRE_BEARER=1', async () => {
    const prev = process.env.MCP_REQUIRE_BEARER;
    process.env.MCP_REQUIRE_BEARER = '1';
    try {
      const res = await handleMcpFetch(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'test', version: '0.0.1' },
            },
          }),
        }),
      );
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate') ?? '').toContain('Bearer');
    } finally {
      if (prev === undefined) delete process.env.MCP_REQUIRE_BEARER;
      else process.env.MCP_REQUIRE_BEARER = prev;
    }
  });
});
