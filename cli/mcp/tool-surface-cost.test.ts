import { describe, expect, test } from 'bun:test';
import { handleMcpFetch } from './http-app.ts';

/**
 * `tools/list` si paga a ogni sessione, come le istruzioni del handshake, e nessuno lo guardava:
 * misurato sul transport vero era 129.212 caratteri — circa 32.300 token prima che l'agente
 * chieda qualunque cosa. Oggi sono 112.789, e il tetto lascia il margine di qualche tool nuovo:
 * quando lo sfonda, la superficie va guardata di nuovo invece di crescere in silenzio.
 *
 * I 2.952 in più sono `insert_row` e `update_row`, e il conto va detto per intero perché il tetto
 * da solo lo nasconde: NON portano via l'enum delle 149 tabelle che `query` si porta dietro — lì
 * costa 2.700 caratteri e li vale, perché una lettura si scopre indovinando il nome, mentre chi
 * sta per scrivere ha appena letto. Il rientro è il censimento dei 71 handler di scrittura, che
 * ne trova quattro — `create_product`, `update_product`, `update_person`, `update_competitor`,
 * 3.794 caratteri — che sono `insert`/`update` di una riga e nient'altro. Toglierli è una
 * decisione separata: quando atterra, questo numero scende sotto quello di partenza.
 *
 * Si misura il TRANSPORT, non i sorgenti: il conto dei sorgenti ha già sbagliato due volte,
 * perché lo schema JSON che il protocollo spedisce non somiglia allo zod da cui nasce. E si misura
 * `result` intero, wrapper `{"tools":…}` compreso: contare il solo array dà 10 caratteri in meno,
 * ed è la differenza esatta fra due conteggi che sembravano in disaccordo.
 */
const TOOLS_LIST_MAX_CHARS = 113_000;

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
   * valore che l'assenza del campo significa. Costavano 10.948 caratteri — l'8,5% della lista.
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
