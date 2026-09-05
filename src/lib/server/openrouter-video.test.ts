import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL VIDEO SU OPENROUTER È ASINCRONO, quindi porta con sé lo stesso rischio che su kie è costato
 * render pagati due volte: la nostra scadenza non ferma il fornitore, che finisce e fattura. La
 * forma è quella già in produzione (#325): l'esito è esplicito, una scadenza porta il `jobId`, e il
 * tentativo successivo RIPRENDE quello. Il test che conta conta gli invii.
 */

const SUBMIT = 'https://openrouter.ai/api/v1/videos';

const M = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  logged: [] as Record<string, unknown>[]
}));
vi.mock('$env/dynamic/private', () => ({ env: M.env }));
vi.mock('$lib/server/ai-log', () => ({
  logAiCall: (e: Record<string, unknown>) => void M.logged.push(e),
  getBrandContext: () => null
}));

let submits: number;
let polls: string[];
let states: unknown[];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch() {
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST' && url === SUBMIT) {
      submits += 1;
      return json({ id: `job-${submits}`, status: 'pending' }, 202);
    }
    polls.push(url.slice(SUBMIT.length + 1));
    const next = states.shift() ?? { status: 'pending' };
    return json(next);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const RENDER = {
  model: 'bytedance/seedance-2-5',
  prompt: 'una tazza che fuma sul bancone',
  durationSeconds: 8,
  resolution: '480p',
  aspectRatio: '9:16'
};

const DONE = {
  status: 'completed',
  unsigned_urls: ['https://openrouter.ai/api/v1/videos/job-1/content?index=0'],
  usage: { cost: 0.64 }
};

describe('il trasporto video su OpenRouter', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(M.env)) delete M.env[k];
    M.env.OPENROUTER_API_KEY = 'o';
    M.logged.length = 0;
    submits = 0;
    polls = [];
    states = [];
  });

  it('un invio e un poll: la clip torna con il costo che OpenRouter fattura', async () => {
    states = [DONE];
    stubFetch();
    const { renderOpenrouterVideo } = await import('./openrouter-video');
    const out = await renderOpenrouterVideo(RENDER, { intervalMs: 1 });
    expect(out).toMatchObject({ status: 'done', jobId: 'job-1', costUsd: 0.64 });
    expect(out.status === 'done' && out.url).toMatch(/\/content\?index=0$/);
    expect(submits).toBe(1);
  });

  it('un polling scaduto riprende lo stesso jobId invece di aprirne un altro', async () => {
    states = [{ status: 'pending' }];
    stubFetch();
    const { renderOpenrouterVideo } = await import('./openrouter-video');

    const first = await renderOpenrouterVideo(RENDER, { timeoutMs: 0, intervalMs: 1 });
    expect(first).toMatchObject({ status: 'timeout', jobId: 'job-1' });
    expect(submits).toBe(1);

    // Il secondo tentativo NON è un invio: è lo stesso lavoro, già in corso e già fatturato.
    states = [DONE];
    const second = await renderOpenrouterVideo(RENDER, { resumeJobId: first.jobId, intervalMs: 1 });
    expect(second).toMatchObject({ status: 'done', jobId: 'job-1' });
    expect(submits, 'un secondo invio è una clip pagata due volte').toBe(1);
    expect(polls).toEqual(['job-1', 'job-1']);
  });

  it('scaduto e fallito non collassano, e solo il fallito è ritentabile', async () => {
    states = [{ status: 'failed', error: 'moderazione' }];
    stubFetch();
    const { renderOpenrouterVideo } = await import('./openrouter-video');
    expect(await renderOpenrouterVideo(RENDER, { intervalMs: 1 })).toMatchObject({
      status: 'failed',
      jobId: 'job-1',
      error: 'moderazione'
    });
  });

  it('una scadenza lascia una riga con l’id e senza costo inventato', async () => {
    states = [{ status: 'pending' }];
    stubFetch();
    const { renderOpenrouterVideo } = await import('./openrouter-video');
    await renderOpenrouterVideo(RENDER, { timeoutMs: 0, intervalMs: 1 });

    const row = M.logged.at(-1)!;
    expect(row).toMatchObject({ provider: 'openrouter', ok: false });
    expect(String(row.context)).toContain('job-1');
    expect(row.flatCostUsd, 'ignoto non è zero').toBeUndefined();
  });

  it('LOG_PROVIDER scrive openrouter: dopo il deploy si vede da una query dove è andato il video', async () => {
    states = [DONE];
    stubFetch();
    const { renderOpenrouterVideo } = await import('./openrouter-video');
    await renderOpenrouterVideo(RENDER, { intervalMs: 1 });
    expect(M.logged.at(-1)).toMatchObject({
      provider: 'openrouter',
      model: 'bytedance/seedance-2.5',
      ok: true,
      flatCostUsd: 0.64
    });
  });

  it('un successo senza costo riportato non costa zero: costa ignoto', async () => {
    states = [{ status: 'completed', unsigned_urls: ['https://openrouter.ai/x'] }];
    stubFetch();
    const { renderOpenrouterVideo } = await import('./openrouter-video');
    await renderOpenrouterVideo(RENDER, { intervalMs: 1 });
    expect(M.logged.at(-1)!.flatCostUsd).toBeUndefined();
  });

  it('gli id di kie diventano quelli di OpenRouter, e un modello che non c’è non è servito', async () => {
    const { openrouterVideoModel } = await import('./openrouter-video');
    expect(openrouterVideoModel('bytedance/seedance-2-5')).toBe('bytedance/seedance-2.5');
    expect(openrouterVideoModel('grok-imagine-video-1-5-preview')).toBe('x-ai/grok-imagine-video-1.5');
    expect(openrouterVideoModel('kling-3.0/video')).toBe('kwaivgi/kling-v3.0-pro');
    expect(openrouterVideoModel('runway/aleph')).toBeUndefined();
  });

  it('la cover viaggia come frame_images, e il ratio sparisce quando c’è', async () => {
    states = [DONE];
    const f = stubFetch();
    const { renderOpenrouterVideo } = await import('./openrouter-video');
    await renderOpenrouterVideo({ ...RENDER, imageUrl: 'https://cdn.test/cover.png' }, { intervalMs: 1 });

    const body = JSON.parse(String(f.mock.calls[0][1]!.body));
    expect(body).toMatchObject({
      model: 'bytedance/seedance-2.5',
      duration: 8,
      resolution: '480p',
      frame_images: [
        { type: 'image_url', image_url: { url: 'https://cdn.test/cover.png' }, frame_type: 'first_frame' }
      ]
    });
    expect(body.aspect_ratio).toBeUndefined();
  });

  it('senza chiave non parte niente: non è un trasporto', async () => {
    delete M.env.OPENROUTER_API_KEY;
    stubFetch();
    const { renderOpenrouterVideo } = await import('./openrouter-video');
    expect(await renderOpenrouterVideo(RENDER, { intervalMs: 1 })).toMatchObject({ status: 'failed' });
    expect(submits).toBe(0);
  });

  it('la clip si scarica solo con la chiave: un download nudo prende 401', async () => {
    const { openrouterVideoHeaders } = await import('./openrouter-video');
    expect(openrouterVideoHeaders()).toMatchObject({ authorization: 'Bearer o' });
  });
});
