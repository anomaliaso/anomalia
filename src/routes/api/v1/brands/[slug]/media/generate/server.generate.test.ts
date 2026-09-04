import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * QUESTA È LA PRIMA ROTTA A PAGAMENTO CHE PRODUCE UN ASSET SENZA UN POST, quindi i test che
 * contano sono i rifiuti: un render che parte quando non doveva è denaro speso, non un bug da
 * correggere dopo. Il percorso felice ha un test solo; i quattro rifiuti ne hanno uno ciascuno.
 */

const generateBrandMedia = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/media-generate', () => ({
  generateBrandMedia: (...args: unknown[]) => generateBrandMedia(...args),
  listMediaJobs: vi.fn()
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

const GENERATED = {
  id: 'media-1',
  kind: 'image',
  mime: 'image/png',
  width: 1080,
  height: 1350,
  signed_url: 'https://signed.test/a.png'
};

function call(body: unknown, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/media/generate`);

  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({
    supabase: {},
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo' },
    error: null
  } as never);
  vi.mocked(gateAiAction).mockResolvedValue(undefined as never);
  generateBrandMedia.mockResolvedValue({
    ok: true,
    status: 'ready',
    media: [GENERATED],
    jobId: null,
    model: 'nano-banana-2-lite',
    renders: 1
  });
});

describe('POST /api/v1/brands/:slug/media/generate', () => {
  it('deposita in libreria e restituisce l id che create_post accetta in media_ids', async () => {
    const { res, body } = await call({ prompt: 'un banco di lavoro in noce' });

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      status: 'ready',
      media: [GENERATED],
      job_id: null,
      model: 'nano-banana-2-lite',
      renders: 1
    });
  });

  it('un brand senza crediti non genera: il gate risponde e il modello non parte', async () => {
    vi.mocked(gateAiAction).mockResolvedValue(
      new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 402 }) as never
    );

    const { res, body } = await call({ prompt: 'qualunque cosa' });

    expect(res.status).toBe(402);
    expect(body.error).toBe('credits_exhausted');
    expect(generateBrandMedia).not.toHaveBeenCalled();
  });

  it('una chiave di sola lettura non genera', async () => {
    // gateAiAction rifiuta la chiave read-only prima ancora di guardare i crediti.
    vi.mocked(gateAiAction).mockResolvedValue(
      new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
    );

    const { res, body } = await call({ prompt: 'qualunque cosa' });

    expect(res.status).toBe(403);
    expect(body.error).toBe('API key is read-only');
    expect(generateBrandMedia).not.toHaveBeenCalled();
  });

  it('il tetto sulle alternative è applicato: oltre il massimo si rifiuta senza spendere', async () => {
    const { res, body } = await call({ prompt: 'tre direzioni visive', count: 5 });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(generateBrandMedia).not.toHaveBeenCalled();
  });

  it('l asset appartiene al brand che ha chiamato, non a quello nominato nel corpo', async () => {
    // `brand_id` nel corpo non è un campo del contratto: lo schema strict lo rifiuta invece di
    // lasciarlo arrivare fino alla insert, dove sarebbe un asset depositato nel brand sbagliato.
    const { res } = await call({ prompt: 'x', brand_id: 'brand-di-qualcun-altro' });

    expect(res.status).toBe(400);
    expect(generateBrandMedia).not.toHaveBeenCalled();
  });

  it('genera per il brand risolto dallo slug, mai per un id che arriva da fuori', async () => {
    await call({ prompt: 'un banco di lavoro in noce' });

    expect(generateBrandMedia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ brandId: 'brand-1', userId: 'user-1' })
    );
  });

  it('un brand che il chiamante non può vedere si ferma prima di generare', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);

    const { res } = await call({ prompt: 'x' }, 'brand-altrui');

    expect(res.status).toBe(404);
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(generateBrandMedia).not.toHaveBeenCalled();
  });

  it('un video torna come lavoro, non come attesa', async () => {
    generateBrandMedia.mockResolvedValue({
      ok: true,
      status: 'rendering',
      media: [],
      jobId: 'job-1',
      model: 'grok-imagine/text-to-video',
      renders: 0
    });

    const { res, body } = await call({ prompt: 'un carrello lento sul prodotto', kind: 'video' });

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      status: 'rendering',
      media: [],
      job_id: 'job-1',
      model: 'grok-imagine/text-to-video',
      renders: 0
    });
  });

  it('un fallimento del render non finge un successo', async () => {
    generateBrandMedia.mockResolvedValue({ ok: false, error: 'render_failed' });

    const { res, body } = await call({ prompt: 'x' });

    expect(res.status).toBe(502);
    expect(body).toEqual({ error: 'render_failed' });
  });
});
