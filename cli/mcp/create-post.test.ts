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

describe('i tool di brand derivati dal registry', () => {
  test('create_post è esposto e chiede slug, piattaforme e copy', async () => {
    const createPost = find(await tools(), 'create_post');

    expect(Object.keys(createPost.inputSchema?.properties ?? {}).sort()).toEqual(
      ['caption', 'link_url', 'media_ids', 'platform_captions', 'platforms', 'scheduled_for', 'slug', 'subreddit', 'title'].sort(),
    );
    expect((createPost.inputSchema?.required ?? []).sort()).toEqual(['caption', 'platforms', 'slug']);
  });

  test('create_post si dichiara non distruttivo e dice che non pubblica', async () => {
    const createPost = find(await tools(), 'create_post');

    expect(createPost.annotations?.readOnlyHint).toBe(false);
    expect(createPost.annotations?.destructiveHint).toBe(false);
    expect(createPost.description ?? '').toContain('does not publish');
  });

  test('le letture migrate restano registrate e restano letture', async () => {
    const all = await tools();

    for (const name of ['list_posts', 'get_calendar']) {
      expect(find(all, name).annotations?.readOnlyHint, name).toBe(true);
    }
    expect(Object.keys(find(all, 'get_calendar').inputSchema?.properties ?? {}).sort()).toEqual([
      'month',
      'slug',
    ]);
  });

  test('list_media compare senza una riga di codice scritta a mano', async () => {
    const listMedia = find(await tools(), 'list_media');

    expect(listMedia.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys(listMedia.inputSchema?.properties ?? {}).sort()).toEqual([
      'limit',
      'query',
      'slug',
    ]);
    expect((listMedia.inputSchema?.required ?? [])).toEqual(['slug']);
  });

  test('create_post accetta i media della libreria', async () => {
    const createPost = find(await tools(), 'create_post');

    expect(Object.keys(createPost.inputSchema?.properties ?? {})).toContain('media_ids');
  });

  test('import_media_url compare come scrittura, e chiede solo un URL', async () => {
    const importMedia = find(await tools(), 'import_media_url');

    expect(importMedia.annotations?.readOnlyHint).toBe(false);
    expect(importMedia.annotations?.destructiveHint).toBe(false);
    expect(Object.keys(importMedia.inputSchema?.properties ?? {}).sort()).toEqual(['slug', 'title', 'url']);
    expect((importMedia.inputSchema?.required ?? []).sort()).toEqual(['slug', 'url']);
    expect(importMedia.description ?? '').toContain('https');
  });

  test('nessun tool è registrato due volte dopo la migrazione', async () => {
    const names = (await tools()).map((t) => t.name);

    expect(names).toEqual([...new Set(names)]);
  });
});
