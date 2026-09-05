import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Una porta sola per rifinire, e i rifiuti sono cio' che conta: un render che parte quando non
 * doveva e' denaro speso. Il tipo dell'asset NON viaggia nel corpo — lo decide la libreria — e la
 * risposta lo dichiara, cosi' chi chiama sa che cosa ha ottenuto senza rileggerlo altrove.
 */

const refineBrandMedia = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/media-generate', () => ({
  refineBrandMedia: (...args: unknown[]) => refineBrandMedia(...args)
}));

import { POST as REFINE } from './+server';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

const DRAWN = {
  id: 'media-1',
  kind: 'image',
  mime: 'image/png',
  width: 1080,
  height: 1350,
  url: 'https://anomalia.so/a/K7BX2MQ4'
};

const CLIP = {
  id: 'media-2',
  kind: 'video',
  mime: 'video/mp4',
  width: null,
  height: null,
  url: 'https://anomalia.so/a/M4NP7QRS'
};

type Handler = (event: unknown) => Promise<Response>;

function refine(body: unknown, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/media/refine`);

  return (REFINE as Handler)({
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
  refineBrandMedia.mockResolvedValue({
    ok: true,
    kind: 'image',
    media: [DRAWN],
    model: 'nano-banana-2-pro',
    renders: 1
  });
});

describe('POST /media/refine — refine_media', () => {
  it('rifinisce a partire da un asset della libreria e deposita un asset NUOVO', async () => {
    const { res, body } = await refine({ base_media_id: 'media-0', instruction: 'sfondo più caldo' });

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, kind: 'image', media: [DRAWN], model: 'nano-banana-2-pro', renders: 1 });
    expect(refineBrandMedia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ baseMediaId: 'media-0', instruction: 'sfondo più caldo' })
    );
  });

  it('la stessa porta serve una clip, e la risposta dice che era un video', async () => {
    refineBrandMedia.mockResolvedValue({
      ok: true,
      kind: 'video',
      media: [CLIP],
      model: 'runway/aleph',
      renders: 1
    });

    const { res, body } = await refine({ base_media_id: 'media-2', instruction: 'fallo notturno' });

    expect(res.status).toBe(200);
    expect(body.kind).toBe('video');
    expect(body.media).toEqual([CLIP]);
  });

  it('brand_style arriva al motore', async () => {
    await refine({ base_media_id: 'media-0', instruction: 'più caldo', brand_style: 'ignore' });

    expect(refineBrandMedia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ brandStyle: 'ignore' })
    );
  });

  it('un asset di un altro brand non è una sorgente valida', async () => {
    refineBrandMedia.mockResolvedValue({ ok: false, error: 'source_not_found' });

    const { res, body } = await refine({ base_media_id: 'media-di-un-altro', instruction: 'x' });

    expect(res.status).toBe(404);
    expect(body.error).toBe('source_not_found');
  });

  it('una clip senza modello di refine si rifiuta con 400, non con un render', async () => {
    refineBrandMedia.mockResolvedValue({ ok: false, error: 'no_refine_model' });

    const { res, body } = await refine({ base_media_id: 'media-2', instruction: 'fallo notturno' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('no_refine_model');
  });

  it('un brand senza crediti non rifinisce', async () => {
    vi.mocked(gateAiAction).mockResolvedValue(
      new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 402 }) as never
    );

    const { res } = await refine({ base_media_id: 'media-0', instruction: 'x' });

    expect(res.status).toBe(402);
    expect(refineBrandMedia).not.toHaveBeenCalled();
  });

  it('rifinire senza dire cosa cambiare non è una richiesta', async () => {
    const { res, body } = await refine({ base_media_id: 'media-0' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(refineBrandMedia).not.toHaveBeenCalled();
  });

  it('il tipo non si dichiara: un kind nel corpo è rifiutato invece di essere creduto', async () => {
    const { res, body } = await refine({ base_media_id: 'media-0', instruction: 'x', kind: 'image' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(refineBrandMedia).not.toHaveBeenCalled();
  });
});
