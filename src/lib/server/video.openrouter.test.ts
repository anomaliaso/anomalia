import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL CABLAGGIO, non il trasporto: che `AI_ROUTE_VIDEO` arrivi davvero fin dentro il render, e che
 * un job consegnato a OpenRouter resti recuperabile DA CHI L'HA PRESO.
 *
 * La proprietà che costa se si rompe è l'ultima. Una riga in coda sopravvive al deploy che cambia
 * la variabile: se il riconciliatore decidesse il fornitore da `AI_ROUTE_VIDEO` invece che dalla
 * riga, dopo uno spostamento chiederebbe a kie un job di OpenRouter, non lo troverebbe mai, e la
 * clip già pagata resterebbe lì senza che nessuno se ne accorga.
 */

const M = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  logged: [] as Record<string, unknown>[]
}));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: (e: Record<string, unknown>) => void M.logged.push(e),
  getBrandContext: () => null,
  withBrandContext: <T>(_b: string, fn: () => T) => fn()
}));

let hits: string[];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(replies: Record<string, unknown> = {}) {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    hits.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('openrouter.ai/api/v1/videos') && init?.method === 'POST') {
      return json({ id: 'or-job-1', status: 'pending' }, 202);
    }
    if (url.includes('openrouter.ai/api/v1/videos/')) {
      return json(replies.poll ?? { status: 'pending' });
    }
    if (url.includes('api.kie.ai')) return json({ data: { taskId: 'kie-1', state: 'waiting' } });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const RENDER = {
  model: 'bytedance/seedance-2-5',
  prompt: 'p',
  durationSeconds: 8,
  resolution: '480p',
  coverUrl: undefined,
  persistOpts: { captions: false, tighten: false },
  submittedAt: Date.now()
};

const supabase = {
  storage: {
    from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.test/stored.mp4' } })
    })
  }
} as never;

describe('il cablaggio del video verso OpenRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(M.env)) delete M.env[k];
    Object.assign(M.env, { KIE_API_KEY: 'k', OPENROUTER_API_KEY: 'o' });
    M.logged.length = 0;
    hits = [];
  });

  it('AI_ROUTE_VIDEO manda l’invio a OpenRouter, e l’id resta marchiato', async () => {
    M.env.AI_ROUTE_VIDEO = 'seedance@openrouter';
    stubFetch();
    const { submitVideoRender } = await import('./video');
    const out = await submitVideoRender('una tazza che fuma', { model: 'bytedance/seedance-2-5' });

    expect(out?.taskId).toBe('openrouter:or-job-1');
    expect(hits.some((h) => h.includes('api.kie.ai')), 'nessun task su kie').toBe(false);
  });

  it('il riconciliatore segue la RIGA, non la variabile di adesso', async () => {
    // La variabile è tornata su kie dopo il deploy; il job però è di OpenRouter e resta suo.
    M.env.AI_ROUTE_VIDEO = 'grok-imagine@kie';
    stubFetch({
      poll: {
        status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/or-job-1/content?index=0'],
        usage: { cost: 0.64 }
      }
    });
    const { finishVideoRender } = await import('./video');
    const outcome = await finishVideoRender(supabase, 'user-1', {
      ...RENDER,
      taskId: 'openrouter:or-job-1'
    });

    expect(outcome.status).toBe('done');
    expect(hits.some((h) => h.includes('api.kie.ai')), 'non ha chiesto a kie').toBe(false);
    expect(hits.filter((h) => h.startsWith('POST')), 'nessun secondo invio').toEqual([]);
    expect(M.logged.at(-1)).toMatchObject({
      provider: 'openrouter',
      model: 'bytedance/seedance-2.5',
      ok: true,
      flatCostUsd: 0.64
    });
  });

  it('chi ha tenuto il lavoro si legge dall’id, non dalla variabile di adesso', async () => {
    M.env.AI_ROUTE_VIDEO = 'grok-imagine@kie';
    const { videoTaskProvider } = await import('./video');

    expect(videoTaskProvider('openrouter:or-job-1')).toBe('openrouter');
    expect(videoTaskProvider('kie-task-1')).toBe('kie');
  });

  it('la clip si scarica con la chiave: senza, OpenRouter risponde 401', async () => {
    M.env.AI_ROUTE_VIDEO = 'grok-imagine@kie';
    const f = stubFetch({
      poll: {
        status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/or-job-1/content?index=0'],
        usage: { cost: 0.64 }
      }
    });
    const { finishVideoRender } = await import('./video');
    await finishVideoRender(supabase, 'user-1', { ...RENDER, taskId: 'openrouter:or-job-1' });

    const download = f.mock.calls.find(([u]) => String(u).includes('/content?index=0'));
    expect((download?.[1] as RequestInit)?.headers).toMatchObject({ authorization: 'Bearer o' });
  });

  it('un modello che OpenRouter non ha resta su kie, e lo dice', async () => {
    M.env.AI_ROUTE_VIDEO = 'seedance@openrouter';
    stubFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { submitVideoRender } = await import('./video');
    await submitVideoRender('p', { model: 'runway/aleph' });

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/non è nel suo catalogo video/));
    expect(hits.some((h) => h.includes('api.kie.ai')), 'è andato su kie').toBe(true);
    warn.mockRestore();
  });

  it('i riferimenti non passano da OpenRouter: quel render resta su kie, rumorosamente', async () => {
    M.env.AI_ROUTE_VIDEO = 'seedance@openrouter';
    stubFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { submitVideoRender } = await import('./video');
    await submitVideoRender('p', {
      model: 'bytedance/seedance-2-5',
      referenceImageUrls: ['https://cdn.test/ref.png']
    });

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/riferimenti non passano/));
    expect(hits.some((h) => h.includes('api.kie.ai'))).toBe(true);
    warn.mockRestore();
  });

  it('l’upscale di kie non accetta un id di OpenRouter', async () => {
    stubFetch();
    const { upscaleVideo } = await import('./video');
    expect(await upscaleVideo(supabase, 'user-1', 'openrouter:or-job-1', '720p')).toBeUndefined();
    expect(hits, 'nemmeno un giro di rete').toEqual([]);
  });
});
