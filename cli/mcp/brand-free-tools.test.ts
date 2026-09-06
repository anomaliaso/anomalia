import { describe, expect, test } from 'bun:test';
import { BRAND_ENDPOINTS } from '../lib/contracts/index.ts';
import { handleMcpFetch } from './http-app.ts';

/**
 * `slug` obbligatorio è la ragione tecnica per cui un agente collegato via MCP risponde che non ha
 * uno strumento per generare un'immagine: per disegnare un gatto dovrebbe prima scegliere
 * un'azienda. Qui si verifica che sia opzionale SOLO dove il registro dichiara una strada che non
 * passa da un brand — un opzionale sparso ovunque toglierebbe il confine invece di aprire una porta.
 */

type Tool = {
  name: string;
  inputSchema?: { properties?: Record<string, { description?: string }>; required?: string[] };
};

async function rpc(method: string, params: unknown, id = 1) {
  const res = await handleMcpFetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    }),
  );
  return (await res.json()) as { result?: Record<string, unknown> };
}

async function tools(): Promise<Tool[]> {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.1' },
  });
  const listed = await rpc('tools/list', {}, 2);
  return (listed.result?.tools ?? []) as Tool[];
}

const find = (all: Tool[], name: string): Tool => {
  const tool = all.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} non registrato`);
  return tool;
};

describe('slug opzionale, e solo dove il registro lo dichiara', () => {
  test('generate_image si chiama senza nominare un brand', async () => {
    const tool = find(await tools(), 'generate_image');

    expect(tool.inputSchema?.required ?? []).not.toContain('slug');
    expect(tool.inputSchema?.properties?.slug).toBeDefined();
  });

  test('il campo dice da solo che si può omettere', async () => {
    const tool = find(await tools(), 'generate_image');

    expect(tool.inputSchema?.properties?.slug?.description).toMatch(/omit/i);
  });

  test('refine_media continua a pretendere il brand: la sorgente vive nella sua libreria', async () => {
    const tool = find(await tools(), 'refine_media');

    expect(tool.inputSchema?.required ?? []).toContain('slug');
  });

  test('ogni altro endpoint del registro tiene slug obbligatorio', async () => {
    const all = await tools();

    for (const endpoint of BRAND_ENDPOINTS) {
      const required = find(all, endpoint.tool).inputSchema?.required ?? [];

      expect(required.includes('slug'), endpoint.tool).toBe(!endpoint.pathWithoutBrand);
    }
  });
});
