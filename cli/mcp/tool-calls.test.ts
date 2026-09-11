import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * `mcp_logs` ha zero righe in produzione, e uno dei due motivi è qui: il campo `tool_name` esiste
 * da sempre e nessuno in `cli/mcp/` lo riempiva. Finché resta vuoto, nessuna decisione sui tool
 * può essere presa sui dati — le letture tolte e i tool riscritti sono stati decisi ragionando, e
 * non sapremo mai se ha funzionato.
 *
 * Si guarda la RIGA che arriva a PostgREST, non la funzione che la chiama: un `mcpLog` invocato
 * col nome giusto ma senza destinazione non prova niente, ed era esattamente il caso.
 */

const rows: Record<string, unknown>[] = [];

const supabase: Server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c as Buffer));
  req.on('end', () => {
    if (req.url?.includes('mcp_logs')) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      rows.push(...(Array.isArray(body) ? body : [body]));
    }
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
});

await new Promise<void>((resolve) => supabase.listen(0, '127.0.0.1', resolve));

process.env.PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(supabase.address() as AddressInfo).port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-for-the-test';
// Nessuna sessione CLI da trovare: il tool si ferma su `requireAuth` e non parla con nessuno. La
// riga deve esserci comunque — un tool che fallisce è quello che più di tutti si vuole nei log.
process.env.HOME = mkdtempSync(join(tmpdir(), 'anomalia-mcp-'));
process.env.PUBLIC_APP_URL = 'http://127.0.0.1:1';

const { handleMcpFetch } = await import('./http-app.ts');

afterAll(() => supabase.close());

const post = (body: unknown) =>
  handleMcpFetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    }),
  );

async function callTool(name: string, args: Record<string, unknown>): Promise<void> {
  await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'tool-calls', version: '0.0.1' },
    },
  });
  await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });

  // La scrittura è fire-and-forget: la risposta non la aspetta, il test sì.
  const deadline = Date.now() + 5000;
  while (!rows.some((r) => r.event === 'tool.call') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const toolCall = (): Record<string, unknown> | undefined => rows.find((r) => r.event === 'tool.call');

beforeEach(() => {
  rows.length = 0;
});

describe('ogni chiamata a un tool lascia il suo nome', () => {
  test('la riga nomina il tool e il brand su cui è stato chiamato', async () => {
    await callTool('approve_posts', { slug: 'demo' });

    expect(toolCall()?.tool_name).toBe('approve_posts');
    expect(toolCall()?.brand_slug).toBe('demo');
    expect(typeof toolCall()?.duration_ms).toBe('number');
  });

  test('un tool che torna un errore lascia un avviso, non il silenzio', async () => {
    await callTool('approve_posts', { slug: 'demo' });

    expect(toolCall()?.level).toBe('warn');
  });

  test('vale per un tool qualunque, perché non è il tool a scrivere la riga', async () => {
    await callTool('list_brands', {});

    expect(toolCall()?.tool_name).toBe('list_brands');
  });
});
