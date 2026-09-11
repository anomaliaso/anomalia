import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * `mcp_logs` aveva zero righe, e uno dei due motivi era qui: `tool_name`, `user_id` e `brand_slug`
 * esistono nello schema e `observability.ts` le scrive già fra le sue quindici colonne — ma nessuno
 * in `cli/mcp/` le passava, quindi arrivavano sempre `null`. Adesso che la tabella riceve le righe
 * sappiamo raccontare il transport e non cosa succede dentro:
 *
 *   26 richieste su 69 finiscono 401 — ma è un cliente che non riesce a collegarsi o qualcuno che
 *   sta provando? `user_id` separa le due, e vogliono risposte opposte.
 *
 * Si guarda la RIGA che arriva a PostgREST, non la funzione che la chiama: un `mcpLog` invocato
 * con i campi giusti ma senza destinazione non prova niente, ed era esattamente il caso.
 */

const USER_ID = '3f1c9a52-0d47-4c8b-9e21-5b7d0a2f6c84';
const USER_EMAIL = 'test@anomalia.so';
const BEARER = 'access-token-for-the-test';

const rows: Record<string, unknown>[] = [];
const apiCalls: { path: string; tool: string | null }[] = [];

const fake: Server = createServer((req: IncomingMessage, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c as Buffer));
  req.on('end', () => {
    const path = req.url ?? '';

    // Il guardiano del bearer: il token vale, e l'identità che ne esce è questa.
    if (path.startsWith('/auth/v1/user')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: USER_ID, email: USER_EMAIL, aud: 'authenticated', role: 'authenticated' }));
      return;
    }

    if (path.includes('mcp_logs')) {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      rows.push(...(Array.isArray(body) ? body : [body]));
    }

    // Le chiamate che il tool fa all'app: è lì che si vede se il nome viaggia con la richiesta.
    if (path.startsWith('/api/')) {
      apiCalls.push({ path, tool: (req.headers['x-anomalia-tool'] as string | undefined) ?? null });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
});

await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));

const origin = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
process.env.PUBLIC_SUPABASE_URL = origin;
process.env.PUBLIC_SUPABASE_ANON_KEY = 'anon-key-for-the-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-for-the-test';
process.env.PUBLIC_APP_URL = origin;
// Nessuna sessione CLI su disco: senza bearer il tool si ferma su `requireAuth` e non parla con
// nessuno. La riga deve esserci comunque — un tool che fallisce è quello che più di tutti si vuole
// nei log, e prima non lasciava niente.
process.env.HOME = mkdtempSync(join(tmpdir(), 'anomalia-mcp-'));

const { handleMcpFetch } = await import('./http-app.ts');

afterAll(() => fake.close());

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handleMcpFetch(
    new Request(`${origin}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

async function callTool(
  name: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<void> {
  await post(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tool-calls', version: '0.0.1' },
      },
    },
    headers,
  );
  await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, headers);

  // La scrittura è fire-and-forget: la risposta non la aspetta, il test sì.
  const deadline = Date.now() + 5000;
  while (!rows.some((r) => r.event === 'tool.call') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const toolCall = (): Record<string, unknown> | undefined => rows.find((r) => r.event === 'tool.call');

const signedIn = { Authorization: `Bearer ${BEARER}` };

beforeEach(() => {
  rows.length = 0;
  apiCalls.length = 0;
});

describe('ogni chiamata a un tool riempie le tre colonne vuote', () => {
  test('il tool e il brand su cui è stato chiamato', async () => {
    await callTool('approve_posts', { slug: 'demo' });

    expect(toolCall()?.tool_name).toBe('approve_posts');
    expect(toolCall()?.brand_slug).toBe('demo');
    expect(typeof toolCall()?.duration_ms).toBe('number');
  });

  test('chi ha chiamato, quando il client si è autenticato davvero', async () => {
    await callTool('list_brands', {}, signedIn);

    expect(toolCall()?.user_id).toBe(USER_ID);
  });

  /**
   * `user_id` è un identificatore, e si ferma lì. La tabella la leggeranno persone che non hanno
   * motivo di vedere l'indirizzo di un cliente, e l'identità arriva qui con l'email accanto: il
   * percorso comodo la porterebbe dentro senza che nessuno se ne accorga.
   */
  test('l’identificatore e nient’altro: nessuna email finisce nella riga', async () => {
    await callTool('list_brands', {}, signedIn);

    expect(JSON.stringify(toolCall())).not.toContain(USER_EMAIL);
    expect(JSON.stringify(toolCall())).not.toContain('@');
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

describe('il nome del tool viaggia con le chiamate che il tool fa', () => {
  /**
   * Il pezzo che lega `mcp_logs` a `ai_calls`: senza questa intestazione la spesa resta attribuita
   * a un'etichetta condivisa fra l'autopilot, la chat e gli agenti esterni — cioè a nessuno.
   */
  test('la richiesta all’app porta x-anomalia-tool', async () => {
    await callTool('list_brands', {}, signedIn);

    expect(apiCalls).toContainEqual({ path: '/api/v1/brands', tool: 'list_brands' });
  });

  test('fuori da un tool non parte nessuna intestazione inventata', async () => {
    const { api } = await import('../lib/api.ts');
    await api.listBrands(BEARER);

    expect(apiCalls.at(-1)).toEqual({ path: '/api/v1/brands', tool: null });
  });
});
