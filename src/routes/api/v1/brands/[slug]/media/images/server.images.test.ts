import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Due porte sullo stesso motore, e i rifiuti sono ciò che conta: un render che parte quando non
 * doveva è denaro speso. Il modello passato a mano è la novità da tenere onesta — vale per questa
 * chiamata e per nessun'altra, e uno non valido si rifiuta ELENCANDO quelli buoni, invece di
 * scoprirlo al render fallito.
 */

const generateBrandImages = vi.fn();
const refineBrandImage = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/media-generate', () => ({
  generateBrandImages: (...args: unknown[]) => generateBrandImages(...args),
  refineBrandImage: (...args: unknown[]) => refineBrandImage(...args)
}));

import { POST as GENERATE } from './+server';
import { POST as REFINE } from './refine/+server';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

const DRAWN = {
  id: 'media-1',
  kind: 'image',
  mime: 'image/png',
  width: 1080,
  height: 1350,
  url: 'https://anomalia.so/a/K7BX2MQ4'
};

type Handler = (event: unknown) => Promise<Response>;

function call(handler: Handler, path: string, body: unknown, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/media/${path}`);

  return handler({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

const generate = (body: unknown, slug?: string) => call(GENERATE as Handler, 'images', body, slug);
const refine = (body: unknown, slug?: string) => call(REFINE as Handler, 'images/refine', body, slug);

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
  generateBrandImages.mockResolvedValue({ ok: true, media: [DRAWN], model: 'nano-banana-2-lite', renders: 1 });
  refineBrandImage.mockResolvedValue({ ok: true, media: [DRAWN], model: 'nano-banana-2-pro', renders: 1 });
});

describe('POST /media/images — generate_image', () => {
  it('disegna e dice con quale modello, così chi non l ha scelto sa cosa ha ottenuto', async () => {
    const { res, body } = await generate({ prompt: 'un banco di lavoro in noce' });

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, media: [DRAWN], model: 'nano-banana-2-lite', renders: 1 });
  });

  it('un brand senza crediti non disegna', async () => {
    vi.mocked(gateAiAction).mockResolvedValue(
      new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 402 }) as never
    );

    const { res } = await generate({ prompt: 'x' });

    expect(res.status).toBe(402);
    expect(generateBrandImages).not.toHaveBeenCalled();
  });

  it('una chiave di sola lettura non disegna', async () => {
    vi.mocked(gateAiAction).mockResolvedValue(
      new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
    );

    const { res } = await generate({ prompt: 'x' });

    expect(res.status).toBe(403);
    expect(generateBrandImages).not.toHaveBeenCalled();
  });

  it('il tetto sulle alternative è applicato senza spendere', async () => {
    const { res, body } = await generate({ prompt: 'tre direzioni', count: 5 });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(generateBrandImages).not.toHaveBeenCalled();
  });

  it('un modello che non sa fare questo mestiere è rifiutato con l elenco di quelli buoni', async () => {
    generateBrandImages.mockResolvedValue({
      ok: false,
      error: 'model_not_for_slot',
      allowed: ['nano-banana-2-lite', 'nano-banana-2-pro']
    });

    const { res, body } = await generate({ prompt: 'x', model: 'un-modello-che-non-esiste' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('model_not_for_slot');
    // Senza l'elenco il rifiuto è un vicolo cieco: l'agente non sa cosa riprovare.
    expect(body.allowed).toEqual(['nano-banana-2-lite', 'nano-banana-2-pro']);
  });

  it('il modello passato vale per questa chiamata e non tocca le preferenze del brand', async () => {
    await generate({ prompt: 'x', model: 'nano-banana-2-pro' });

    expect(generateBrandImages).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ brandId: 'brand-1', model: 'nano-banana-2-pro' })
    );
  });

  it('genera per il brand risolto dallo slug, mai per un id che arriva dal corpo', async () => {
    const { res } = await generate({ prompt: 'x', brand_id: 'brand-di-qualcun-altro' });

    expect(res.status).toBe(400);
    expect(generateBrandImages).not.toHaveBeenCalled();
  });

  it('un brand che il chiamante non può vedere si ferma prima di spendere', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);

    const { res } = await generate({ prompt: 'x' }, 'brand-altrui');

    expect(res.status).toBe(404);
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(generateBrandImages).not.toHaveBeenCalled();
  });
});

describe('POST /media/images/refine — refine_image', () => {
  it('rifinisce a partire da un asset della libreria e deposita un asset NUOVO', async () => {
    const { res, body } = await refine({ base_media_id: 'media-0', instruction: 'sfondo più caldo' });

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, media: [DRAWN], model: 'nano-banana-2-pro', renders: 1 });
    expect(refineBrandImage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ baseMediaId: 'media-0', prompt: 'sfondo più caldo' })
    );
  });

  it('un asset di un altro brand non è una sorgente valida', async () => {
    refineBrandImage.mockResolvedValue({ ok: false, error: 'source_not_found' });

    const { res, body } = await refine({ base_media_id: 'media-di-un-altro', instruction: 'x' });

    expect(res.status).toBe(404);
    expect(body.error).toBe('source_not_found');
  });

  it('un brand senza crediti non rifinisce', async () => {
    vi.mocked(gateAiAction).mockResolvedValue(
      new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 402 }) as never
    );

    const { res } = await refine({ base_media_id: 'media-0', instruction: 'x' });

    expect(res.status).toBe(402);
    expect(refineBrandImage).not.toHaveBeenCalled();
  });

  it('rifinire senza dire cosa cambiare non è una richiesta', async () => {
    const { res, body } = await refine({ base_media_id: 'media-0' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(refineBrandImage).not.toHaveBeenCalled();
  });
});
