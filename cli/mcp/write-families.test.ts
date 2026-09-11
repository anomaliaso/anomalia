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

type Tool = {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown> };
  annotations?: Record<string, unknown>;
};

async function tools(): Promise<Tool[]> {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'families', version: '0.0.1' },
  });
  return ((await rpc('tools/list', {}, 2)).result?.tools ?? []) as Tool[];
}

const find = async (name: string): Promise<Tool> => {
  const tool = (await tools()).find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} non registrato`);
  return tool;
};

const fields = (tool: Tool): string[] => Object.keys(tool.inputSchema?.properties ?? {});

type ApiCall = { method: string; path: string; body: Record<string, unknown> };

/** Ogni chiamata che il tool fa davvero: il fan-out si misura sulle rotte toccate, non sullo schema. */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  reply: (path: string) => unknown = () => ({ ok: true }),
): Promise<{ calls: ApiCall[]; structured: Record<string, unknown>; isError: boolean }> {
  const calls: ApiCall[] = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
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
          clientInfo: { name: 'families', version: '0.0.1' },
        });
        return rpc('tools/call', { name, arguments: args }, 3);
      },
    );
    return {
      calls,
      structured: (res.result?.structuredContent ?? {}) as Record<string, unknown>,
      isError: res.result?.isError === true,
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const RETIRED = ['update_brand_kit', 'update_voice', 'set_colors', 'set_appearance'] as const;

describe('update_brand_identity: una porta sola per cosa il brand è, come suona e come appare', () => {
  test('i quattro nomi non sono più in tools/list, e il nuovo sì', async () => {
    const names = (await tools()).map((t) => t.name);

    expect(names).toContain('update_brand_identity');
    for (const gone of RETIRED) expect(names, gone).not.toContain(gone);
  });

  /**
   * Il conto delle capacità, non delle parole: ogni campo che i quattro accettavano deve stare
   * nello schema del nuovo, o il collasso ha tolto qualcosa invece di unirlo.
   */
  test('accetta ogni campo che i quattro accettavano', async () => {
    const props = fields(await find('update_brand_identity'));

    for (const field of [
      'about', 'category', 'target_audience', 'brand_style', 'language',
      'mood', 'tone', 'register', 'emotion', 'character', 'syntax', 'avoid', 'platform_instructions',
      'colors',
      'logo_url', 'favicon_url', 'remove_logo', 'display_font', 'body_font',
      'graphic_instructions', 'visual_style',
    ]) {
      expect(props, field).toContain(field);
    }
  });

  test('nessun campo è obbligatorio: si manda solo quello che cambia', async () => {
    const schema = (await find('update_brand_identity')).inputSchema as { required?: string[] };

    expect(schema.required ?? []).toEqual(['slug']);
  });

  test('manda ogni campo alla rotta che lo sa scrivere, in una chiamata sola', async () => {
    const { calls } = await callTool('update_brand_identity', {
      slug: 'demo',
      language: 'it',
      tone: 'warm',
      colors: ['#7c5cff'],
      display_font: 'Inter',
      body_font: 'Inter',
    });

    const routed = Object.fromEntries(calls.map((c) => [c.path.replace('/api/v1/brands/demo', ''), c.body]));

    expect(routed['/studio/kit']).toEqual({ language: 'it' });
    expect(routed['/voice/update']).toEqual({ tone: 'warm' });
    expect(routed['/studio/colors']).toEqual({ colors: ['#7c5cff'] });
    expect(routed['/studio/appearance']).toEqual({ display_font: 'Inter', body_font: 'Inter' });
  });

  test('non chiama la rotta di cui non hai nominato nessun campo', async () => {
    const { calls } = await callTool('update_brand_identity', { slug: 'demo', colors: ['#000'] });

    expect(calls.map((c) => c.path)).toEqual(['/api/v1/brands/demo/studio/colors']);
  });

  test('il metodo di ogni rotta resta quello che il contratto dichiara', async () => {
    const { calls } = await callTool('update_brand_identity', { slug: 'demo', tone: 'warm', colors: ['#000'] });

    const byPath = Object.fromEntries(calls.map((c) => [c.path, c.method]));
    expect(byPath['/api/v1/brands/demo/voice/update']).toBe('POST');
    expect(byPath['/api/v1/brands/demo/studio/colors']).toBe('PUT');
  });

  /** Gli echi che i quattro davano — il `#` aggiunto ai colori, la vista dell'aspetto — restano. */
  test('la risposta porta gli echi delle rotte che hanno scritto', async () => {
    const { structured } = await callTool(
      'update_brand_identity',
      { slug: 'demo', colors: ['7c5cff'], visual_style: 'x'.repeat(30) },
      (path) =>
        path.endsWith('/studio/colors')
          ? { ok: true, colors: ['#7c5cff'] }
          : { ok: true, appearance: { colors: ['#7c5cff'], visual_style_locked: true } },
    );

    expect(structured.ok).toBe(true);
    expect(structured.colors).toEqual(['#7c5cff']);
    expect((structured.appearance as { visual_style_locked: boolean }).visual_style_locked).toBe(true);
  });

  test('senza nessun campo non tocca niente e lo dice', async () => {
    const { calls, isError } = await callTool('update_brand_identity', { slug: 'demo' });

    expect(calls).toEqual([]);
    expect(isError).toBe(true);
  });

  /**
   * Chi conosceva i quattro nomi deve atterrare qui leggendo la lista, non scoprendo un 404: sono
   * i nomi con cui cercherà, e la palette è la ricerca che si è già persa una volta.
   */
  test('la descrizione nomina i quattro nomi ritirati e la parola con cui li si cerca', async () => {
    const description = (await find('update_brand_identity')).description ?? '';

    for (const gone of RETIRED) expect(description, gone).toContain(gone);
    expect(description.toLowerCase()).toContain('colour');
    expect(description.toLowerCase()).toContain('logo');
    expect(description.toLowerCase()).toContain('voice');
  });

  test('non distrugge niente: è additivo campo per campo', async () => {
    expect((await find('update_brand_identity')).annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  /**
   * `set_bio` scrive `social_accounts`, non il brand, e risponde 404 quando nessun account è
   * collegato: unirlo qui darebbe alla famiglia un fallimento che nessuno degli altri può avere.
   */
  test('set_bio resta il suo tool: scrive un account social, non il brand', async () => {
    expect((await tools()).map((t) => t.name)).toContain('set_bio');
  });
});

describe('generate_media è ritirato: era la porta vecchia che inoltrava alle altre due', () => {
  test('non è più in tools/list, e le due a cui inoltrava ci sono', async () => {
    const names = (await tools()).map((t) => t.name);

    expect(names).not.toContain('generate_media');
    expect(names).toContain('generate_image');
    expect(names).toContain('generate_video');
  });

  test('ogni campo che accettava resta raggiungibile dai due che restano', async () => {
    const image = fields(await find('generate_image'));
    const video = fields(await find('generate_video'));

    for (const field of ['prompt', 'count', 'aspect_ratio', 'model', 'title']) {
      expect(image, field).toContain(field);
    }
    for (const field of ['prompt', 'aspect_ratio', 'model', 'title']) {
      expect(video, field).toContain(field);
    }
  });

  test('nessuna descrizione manda più a un tool che non esiste', async () => {
    for (const tool of await tools()) {
      expect(tool.description ?? '', tool.name).not.toContain('generate_media');
    }
  });
});
