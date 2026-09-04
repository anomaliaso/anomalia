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
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
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

const find = (all: Tool[], name: string): Tool => {
  const tool = all.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} non registrato`);
  return tool;
};

describe('le scritture dello studio esposte dal registry', () => {
  test('un agente esterno vede creare, correggere e togliere, non solo leggere', async () => {
    const names = (await tools()).map((t) => t.name);

    for (const name of [
      'create_product',
      'update_product',
      'delete_product',
      'update_person',
      'update_competitor',
      'get_bio',
      'set_bio',
    ]) {
      expect(names, name).toContain(name);
    }
  });

  test('una modifica chiede lo slug e l’id della riga, senza prefissi da risolvere', async () => {
    const all = await tools();

    for (const name of ['update_product', 'update_person', 'update_competitor', 'delete_product']) {
      expect(find(all, name).inputSchema?.required?.sort(), name).toEqual(['id', 'slug']);
    }
  });

  test('solo delete_product si annuncia distruttivo', async () => {
    const all = await tools();

    expect(find(all, 'delete_product').annotations?.destructiveHint).toBe(true);
    for (const name of ['create_product', 'update_product', 'update_person', 'update_competitor']) {
      expect(find(all, name).annotations?.destructiveHint, name).toBe(false);
    }
  });

  test('get_bio è una lettura, set_bio no', async () => {
    const all = await tools();

    expect(find(all, 'get_bio').annotations?.readOnlyHint).toBe(true);
    expect(find(all, 'set_bio').annotations?.readOnlyHint).toBe(false);
  });

  test('update_person non offre nessun campo con cui attestare un consenso', async () => {
    const person = find(await tools(), 'update_person');

    expect(Object.keys(person.inputSchema?.properties ?? {}).sort()).toEqual(
      ['attributes', 'description', 'id', 'name', 'role', 'slug'].sort(),
    );
  });

  test('nessun tool è registrato due volte', async () => {
    const names = (await tools()).map((t) => t.name);

    expect(names).toEqual([...new Set(names)]);
  });
});
