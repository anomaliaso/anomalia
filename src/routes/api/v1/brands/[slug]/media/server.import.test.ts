import { describe, it, expect, vi, beforeEach } from 'vitest';

const importBrandMediaFromUrl = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => undefined),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/brand-media', () => ({ listBrandMedia: vi.fn() }));
vi.mock('$lib/server/media-import', () => ({
  importBrandMediaFromUrl: (...args: unknown[]) => importBrandMediaFromUrl(...args)
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';

const IMPORTED = {
  id: 'media-1',
  kind: 'image',
  mime: 'image/png',
  bytes: 4096,
  width: 1080,
  height: 1350,
  source_url: 'https://cdn.example.com/a.png',
  signed_url: 'https://signed.test/a.png'
};

function call(body: unknown, slug = 'demo') {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: {},
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug },
    error: null
  } as never);

  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/media`);
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(undefined);
  importBrandMediaFromUrl.mockResolvedValue({ ok: true, media: IMPORTED });
});

describe('POST /api/v1/brands/:slug/media', () => {
  it('importa il file e restituisce l id che create_post accetta in media_ids', async () => {
    const { res, body } = await call({ url: 'https://cdn.example.com/a.png' });

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ...IMPORTED });
    expect(importBrandMediaFromUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        brandId: 'brand-1',
        userId: 'user-1',
        url: 'https://cdn.example.com/a.png'
      })
    );
  });

  it('non chiama il modello e non tocca i crediti: qui si copia un file, non si genera niente', async () => {
    await call({ url: 'https://cdn.example.com/a.png' });

    expect(gateAiAction).not.toHaveBeenCalled();
  });

  it('passa il titolo che il chiamante ha scelto', async () => {
    await call({ url: 'https://cdn.example.com/a.png', title: 'Scatto del prodotto' });

    expect(importBrandMediaFromUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'Scatto del prodotto' })
    );
  });

  it('rifiuta una richiesta senza autenticazione', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      error: new Response('Unauthorized', { status: 401 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/media');

    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(401);
    expect(importBrandMediaFromUrl).not.toHaveBeenCalled();
  });

  it('rifiuta un brand a cui il chiamante non accede', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      supabase: {},
      user: { id: 'user-1' },
      apiKey: undefined,
      error: null
    } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/altrui/media');

    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'altrui' },
      url
    });

    expect(res.status).toBe(404);
    expect(importBrandMediaFromUrl).not.toHaveBeenCalled();
  });

  it('rifiuta una API key di sola lettura prima di scaricare qualsiasi cosa', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
    );

    const { res } = await call({ url: 'https://cdn.example.com/a.png' });

    expect(res.status).toBe(403);
    expect(importBrandMediaFromUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['senza url', {}],
    ['con un url vuoto', { url: '' }],
    ['con un campo che il contratto non dichiara', { url: 'https://cdn.example.com/a.png', quality: 'high' }]
  ])('rifiuta una richiesta %s senza toccare la rete', async (_label, body) => {
    const { res, body: out } = await call(body);

    expect(res.status).toBe(400);
    expect(out.error).toBe('invalid_input');
    expect(importBrandMediaFromUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['not_https', 400],
    ['blocked_host', 400],
    ['fetch_failed', 400],
    ['unsupported_type', 415],
    ['too_large', 413],
    ['empty', 400],
    ['store_failed', 502]
  ])('traduce %s nello status che il contratto dichiara', async (error, status) => {
    importBrandMediaFromUrl.mockResolvedValue({ ok: false, error });

    const { res, body } = await call({ url: 'https://cdn.example.com/a.png' });

    expect(res.status).toBe(status);
    expect(body).toEqual({ error });
  });
});
