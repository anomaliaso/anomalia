import { describe, expect, test } from 'bun:test';
import { handleMcpFetch } from './http-app.ts';

/**
 * `tools/list` si paga a ogni sessione, come le istruzioni del handshake, e nessuno lo guardava:
 * misurato sul transport vero era 131.959 caratteri — circa 33.000 token prima che l'agente
 * chieda qualunque cosa. Il budget qui sotto è quel numero dopo il taglio, e il test esiste
 * perché ricresce da solo: ogni tool nuovo porta la sua descrizione, e nessuno somma.
 *
 * Si misura il TRANSPORT, non i sorgenti: il conto dei sorgenti ha già sbagliato due volte,
 * perché lo schema JSON che il protocollo spedisce non somiglia allo zod da cui nasce.
 */
const TOOLS_LIST_MAX_CHARS = 96_000;

async function listedTools(): Promise<{ tools: Array<Record<string, unknown>>; chars: number }> {
  const post = (body: unknown) =>
    handleMcpFetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      }),
    );

  await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'cost', version: '0.0.1' },
    },
  });

  const body = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })).json();

  return { tools: body.result.tools, chars: JSON.stringify(body.result).length };
}

describe('la lista dei tool sta dentro il suo budget', () => {
  test('un client la riceve intera prima di poter chiedere qualcosa', async () => {
    const { chars } = await listedTools();

    expect(chars).toBeLessThanOrEqual(TOOLS_LIST_MAX_CHARS);
  });

  /**
   * Due chiavi che l'SDK aggiunge da sé e che nessun client legge: `$schema` dichiara il dialetto
   * di uno schema che il protocollo dichiara già JSON Schema, e `taskSupport: 'forbidden'` è il
   * valore che l'assenza del campo significa. Costavano 13.356 caratteri — il 10% della lista.
   */
  test('non ripete il dialetto dello schema a ogni tool', async () => {
    const { tools } = await listedTools();

    for (const tool of tools) {
      expect(tool.inputSchema).not.toHaveProperty('$schema');
    }
  });

  test('non dichiara taskSupport: nessun tool qui accetta un task', async () => {
    const { tools } = await listedTools();

    for (const tool of tools) {
      expect(tool).not.toHaveProperty('execution');
    }
  });
});
