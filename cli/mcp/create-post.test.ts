import { describe, expect, test } from 'bun:test';
import { runWithRequestAuth } from './context.ts';
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

const FULL_ID = '2b38abc5-7f31-4e0a-9a41-0f2d0c1b8e55';

type ApiCall = { method: string; path: string; body: string | null };

async function callTool(
  name: string,
  args: Record<string, unknown>,
  reply: (path: string) => unknown,
): Promise<{ calls: ApiCall[]; structured: Record<string, unknown> }> {
  const calls: ApiCall[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    calls.push({
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return new Response(JSON.stringify(reply(url.pathname)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const res = await runWithRequestAuth(
      { access_token: 'tok', user: { id: 'u1', email: 'u@example.com' }, source: 'bearer' },
      async () => {
        await rpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.0.1' },
        });
        return rpc('tools/call', { name, arguments: args }, 3);
      },
    );
    return {
      calls,
      structured: (res.result?.structuredContent ?? {}) as Record<string, unknown>,
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}

type Tool = {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { description?: string }>; required?: string[] };
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

  test('check_content compare da solo e si dichiara gratuito e senza modello', async () => {
    const check = find(await tools(), 'check_content');

    expect(Object.keys(check.inputSchema?.properties ?? {}).sort()).toEqual(
      ['caption', 'media_ids', 'platform_captions', 'platforms', 'scheduled_for', 'slug', 'title'].sort(),
    );
    expect((check.inputSchema?.required ?? []).sort()).toEqual(['caption', 'platforms', 'slug']);
    expect(check.annotations?.destructiveHint).toBe(false);
    expect(check.description ?? '').toContain('spends no credits');
  });

  test('nessun tool è registrato due volte dopo la migrazione', async () => {
    const names = (await tools()).map((t) => t.name);

    expect(names).toEqual([...new Set(names)]);
  });
});

describe('i tool sul singolo post', () => {
  test('get_post chiede lo slug e un id, e resta una lettura', async () => {
    const getPost = find(await tools(), 'get_post');

    expect(Object.keys(getPost.inputSchema?.properties ?? {}).sort()).toEqual(['id', 'slug']);
    expect((getPost.inputSchema?.required ?? []).sort()).toEqual(['id', 'slug']);
    expect(getPost.annotations?.readOnlyHint).toBe(true);
    expect(getPost.description ?? '').toContain('id accepts a short prefix');
  });

  test('reschedule_post chiede anche la data e non si dichiara distruttivo', async () => {
    const reschedule = find(await tools(), 'reschedule_post');

    expect(Object.keys(reschedule.inputSchema?.properties ?? {}).sort()).toEqual([
      'id',
      'scheduled_for',
      'slug',
    ]);
    expect((reschedule.inputSchema?.required ?? []).sort()).toEqual([
      'id',
      'scheduled_for',
      'slug',
    ]);
    expect(reschedule.annotations?.readOnlyHint).toBe(false);
    expect(reschedule.annotations?.destructiveHint).toBe(false);
    expect(reschedule.description ?? '').toContain('ISO datetime');
  });

  test('ogni tool sul post dice che l id accetta un prefisso, non solo la sua description', async () => {
    const all = await tools();

    for (const name of ['get_post', 'reschedule_post', 'render_post']) {
      const id = find(all, name).inputSchema?.properties?.id as { description?: string };
      expect(id?.description, name).toBe('Post id or unambiguous prefix');
    }
  });

  test('render_post chiede solo il post e avvisa che si paga', async () => {
    const render = find(await tools(), 'render_post');

    expect(Object.keys(render.inputSchema?.properties ?? {}).sort()).toEqual(['id', 'slug']);
    expect((render.inputSchema?.required ?? []).sort()).toEqual(['id', 'slug']);
    expect(render.annotations?.readOnlyHint).toBe(false);
    expect(render.annotations?.destructiveHint).toBe(false);
    expect(render.description ?? '').toContain('Bills a render');
  });

  test('un prefisso diventa l id intero prima che la rotta REST lo veda', async () => {
    const { calls, structured } = await callTool('get_post', { slug: 'demo', id: '2b38abc5' }, (path) =>
      path.endsWith('/media') ? { status: 'approved', caption: 'ciao' } : [{ id: FULL_ID }, { id: 'ffff0000-0000-0000-0000-000000000000' }],
    );

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/v1/brands/demo/posts',
      `GET /api/v1/brands/demo/posts/${FULL_ID}/media`,
    ]);
    expect(structured).toEqual({ id: FULL_ID, status: 'approved', caption: 'ciao' });
  });

  test('reschedule_post manda la data al post risolto, e niente altro', async () => {
    const { calls, structured } = await callTool(
      'reschedule_post',
      { slug: 'demo', id: '2b38abc5', scheduled_for: '2030-06-20T10:00' },
      (path) => (path.endsWith('/reschedule') ? { ok: true, scheduled_for: '2030-06-20T08:00:00Z' } : [{ id: FULL_ID }]),
    );

    expect(calls[1]).toEqual({
      method: 'POST',
      path: `/api/v1/brands/demo/posts/${FULL_ID}/reschedule`,
      body: JSON.stringify({ scheduled_for: '2030-06-20T10:00' }),
    });
    expect(structured).toEqual({ id: FULL_ID, ok: true, scheduled_for: '2030-06-20T08:00:00Z' });
  });

  test('un prefisso ambiguo non tocca nessun post', async () => {
    const { calls } = await callTool('get_post', { slug: 'demo', id: 'aa' }, () => [
      { id: 'aa11' },
      { id: 'aa22' },
    ]);

    expect(calls).toHaveLength(1);
  });
});
