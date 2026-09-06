import { describe, expect, test } from 'bun:test';
import { handleMcpFetch } from './http-app.ts';

/**
 * Il registro si legge dal trasporto, non dall'array: un contratto esportato ma mai registrato
 * passerebbe un controllo sull'array e resterebbe invisibile in `tools/list`, che e' l'unica
 * superficie che un agente vede davvero.
 */
async function listedTools(): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
  const res = await handleMcpFetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()).result?.tools ?? [];
}

describe('refine_media in tools/list', () => {
  test('e\' esposto, e prende una sorgente di libreria piu\' un\'istruzione', async () => {
    const tool = (await listedTools()).find((t) => t.name === 'refine_media');
    expect(tool).toBeDefined();

    const props = (tool?.inputSchema?.properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(props)).toContain('base_media_id');
    expect(Object.keys(props)).toContain('instruction');

    const required = (tool?.inputSchema?.required ?? []) as string[];
    expect(required).toContain('base_media_id');
    expect(required).toContain('instruction');
  });

  test('la descrizione vieta di ridisegnare da zero, che e\' il difetto da cui nasce', async () => {
    const tool = (await listedTools()).find((t) => t.name === 'refine_media');
    const description = String(tool?.description ?? '');

    // Il modello che aveva ridisegnato un gatto rosso invece di arrossare il suo aveva letto la
    // lista e non aveva trovato la rifinitura. Qui deve trovarla, e deve leggere che generare NON
    // e' la strada — nominato, non sottinteso.
    expect(description).toMatch(/generate_media/);
    expect(description.toLowerCase()).toMatch(/video/);
    expect(description.toLowerCase()).toMatch(/new asset|nuovo/);
  });

  test('refine_image e\' ritirato: una sola porta per la rifinitura', async () => {
    const names = (await listedTools()).map((t) => t.name);
    expect(names).not.toContain('refine_image');
    expect(names).toContain('refine_media');
  });
});
