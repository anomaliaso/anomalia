import { describe, it, expect, vi, beforeEach } from 'vitest';

const structured = vi.fn();
const llmStructured = vi.fn();
const gateCredits = vi.fn();
const findBrandMediaByIds = vi.fn();
const getPosts = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/cli-queries', () => ({ getPosts: (...args: unknown[]) => getPosts(...args) }));
vi.mock('$lib/server/brand-media', () => ({
  findBrandMediaByIds: (...args: unknown[]) => findBrandMediaByIds(...args)
}));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/llm', () => ({
  llmStructured: (...args: unknown[]) => llmStructured(...args),
  llmConfigured: () => false,
  llmImagesFromInline: () => []
}));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError: class extends Error {}
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

const CAPTION = 'Spedivamo il venerdì e il 22% dei resi arrivava il lunedì. Guarda cosa abbiamo cambiato.';

function call(body: unknown, slug = 'demo') {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: {},
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug, timezone: 'Europe/Rome' },
    error: null
  } as never);
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/content/check`);
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
  findBrandMediaByIds.mockResolvedValue([]);
  getPosts.mockResolvedValue([]);
});

describe('POST /api/v1/brands/:slug/content/check', () => {
  it('risponde 200 con il verdetto, anche quando il verdetto è negativo', async () => {
    const { res, body } = await call({ platforms: ['linkedin'], caption: 'a'.repeat(3001) });

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.errors.map((e: { code: string }) => e.code)).toContain('over_limit');
  });

  it('non chiama il modello e non tocca i crediti: il controllo non si paga', async () => {
    await call({ platforms: ['linkedin'], caption: CAPTION });

    expect(structured).not.toHaveBeenCalled();
    expect(llmStructured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  // `resolveCaller` nega ogni non-GET a una API key di sola lettura, prima che la route parta:
  // «Every mutating CLI route is a non-GET, so the method is the whole check». check_content è il
  // primo POST che calcola senza scrivere, quindi è il primo controesempio a quella frase — ma la
  // regola resta quella, e finché resta una chiave di sola lettura qui non arriva.
  it('non arriva a calcolare quando authenticate ha già negato la chiamata', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/content/check');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: JSON.stringify({ platforms: ['linkedin'], caption: CAPTION }) }),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(403);
    expect(loadBrandForUser).not.toHaveBeenCalled();
    expect(getPosts).not.toHaveBeenCalled();
  });

  it('rifiuta una richiesta senza autenticazione', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      error: new Response('Unauthorized', { status: 401 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/content/check');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(401);
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
    const url = new URL('https://anomalia.test/api/v1/brands/altrui/content/check');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'altrui' },
      url
    });

    expect(res.status).toBe(404);
  });

  it.each([
    ['senza piattaforme', { platforms: [], caption: 'copy' }],
    ['senza campi', {}],
    ['con un campo che il contratto non dichiara', { platforms: ['linkedin'], caption: 'copy', campo_inventato: 'x' }]
  ])('rifiuta una richiesta %s', async (_label, body) => {
    const { res, body: out } = await call(body);

    expect(res.status).toBe(400);
    expect(out.error).toBe('invalid_input');
  });

  it('porta le versioni delle regole nella risposta', async () => {
    const { body } = await call({ platforms: ['linkedin'], caption: CAPTION });

    expect(typeof body.versions.rules).toBe('number');
    expect(typeof body.versions.scorer).toBe('number');
  });
});
