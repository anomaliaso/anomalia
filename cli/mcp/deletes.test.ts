import { describe, expect, test } from 'bun:test';
import { handleMcpFetch } from './http-app.ts';

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

type Tool = {
  name: string;
  inputSchema?: { properties?: Record<string, { format?: string }>; required?: string[] };
  annotations?: Record<string, unknown>;
};

async function tools(): Promise<Tool[]> {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.1' },
  });
  const listed = await rpc('tools/list', {}, 2);
  return (listed.result?.tools ?? []) as Tool[];
}

const DELETES = ['delete_product', 'delete_person', 'delete_document', 'delete_competitor'];

describe('le cancellazioni esposte dal registry', () => {
  test('chiedono l’UUID pieno della riga, non un prefisso da risolvere', async () => {
    const all = await tools();

    for (const name of DELETES) {
      const tool = all.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.inputSchema?.properties?.id?.format, name).toBe('uuid');
      expect(tool?.inputSchema?.required?.slice().sort(), name).toEqual(['id', 'slug']);
      expect(tool?.annotations?.destructiveHint, name).toBe(true);
    }
  });
});
