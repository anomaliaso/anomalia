import { describe, expect, test } from 'bun:test';
import { handleMcpFetch } from './http-app.ts';
import { routeMcpHttp } from './http-router.ts';
import { authServerUrl } from '../lib/config.ts';
import { MCP_INSTRUCTIONS } from './server.ts';

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
    expect(body.authorization_servers).toEqual([authServerUrl()]);
  });

  test('the vercel route advertises the same authorization server', async () => {
    const res = await routeMcpHttp(
      new Request('https://mcp.anomalia.so/.well-known/oauth-protected-resource'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorization_servers).toEqual([authServerUrl()]);
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
    // La mappa del server viaggia nel handshake, prima di qualunque descrizione: se non arriva
    // qui, il client non la vede mai e la superficie che decide per prima resta muta.
    expect(initBody.result?.instructions).toBe(MCP_INSTRUCTIONS);

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
    expect(names.length).toBeGreaterThan(50);
  });

  /**
   * Su HTTP l'autenticazione non e' mai stata di questi tre tool: la fa l'host, con la scoperta a
   * `/.well-known/oauth-protected-resource` e il 401 che porta `WWW-Authenticate: Bearer`, ed e'
   * verificata dai due test qui sopra e da quello sotto.
   *
   * `logout` andava via anche senza il conteggio: `clearSession()` e' un `unlinkSync` dentro un
   * `catch {}` sul file di sessione DELLA MACCHINA CHE ESEGUE IL SERVER. Da remoto quel file non
   * e' del chiamante, l'unlink fallisce, il catch se lo mangia e il tool rispondeva comunque
   * `{ loggedOut: true }`: un successo falso a ogni chiamata.
   */
  test('login, logout e whoami non sono piu tool: su HTTP autentica l’host', async () => {
    await handleMcpFetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.0.1' } },
        }),
      }),
    );
    const listRes = await handleMcpFetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      }),
    );
    const names = ((await listRes.json()).result?.tools ?? []).map((t: { name: string }) => t.name);

    for (const gone of ['login', 'logout', 'whoami']) expect(names, gone).not.toContain(gone);
  });

  /** Tolto il tool, il modo di autenticarsi deve restare scritto dove si legge per primo. */
  test('le istruzioni dicono come si entra, ora che non c’e’ un tool', () => {
    expect(MCP_INSTRUCTIONS).toContain('anomalia login');
    expect(MCP_INSTRUCTIONS).toMatch(/Bearer/);
    expect(MCP_INSTRUCTIONS).not.toMatch(/`login`/);
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
