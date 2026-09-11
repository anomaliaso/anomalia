import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateCarouselWithoutBrand = vi.fn();
const openOrgScope = vi.fn();

vi.mock('$lib/server/cli-auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openOrgScope: (...args: unknown[]) => openOrgScope(...args) };
});
vi.mock('$lib/server/media-generate', () => ({
  generateCarouselWithoutBrand: (...args: unknown[]) => generateCarouselWithoutBrand(...args)
}));

import { POST } from './+server';

const ORG = { id: 'org-1', name: 'Acme' };
const SLIDE = { id: null, kind: 'image', mime: 'image/png', width: 1080, height: 1350, url: 'https://s/1' };

async function make(body: unknown) {
  const url = new URL('https://anomalia.test/api/v1/carousel');
  const res = await (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    url
  });

  return { res, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  openOrgScope.mockResolvedValue({
    scope: { supabase: {}, user: { id: 'user-1' }, orgId: 'org-1', organization: ORG }
  });
  generateCarouselWithoutBrand.mockResolvedValue({
    ok: true,
    media: [SLIDE, SLIDE, SLIDE],
    continuityTokens: ['ocra', 'luce radente'],
    model: 'nano-banana-2-lite',
    renders: 3
  });
});

describe('POST /api/v1/carousel — una serie senza nominare un brand', () => {
  it('consegna le slide in ordine e dice quanti render sono stati pagati', async () => {
    const { res, body } = await make({ brief: 'tre motivi per cambiare sedia' });

    expect(res.status).toBe(200);
    expect(body.media).toHaveLength(3);
    expect(body.renders).toBe(3);
  });

  /** Senza i gettoni, una slide rifinita esce dalla serie: sono metà del prodotto. */
  it('porta i gettoni di continuità, che tengono insieme la serie', async () => {
    const { body } = await make({ brief: 'x' });

    expect(body.continuity_tokens).toEqual(['ocra', 'luce radente']);
  });

  it('dice da quale organizzazione sono stati presi i crediti', async () => {
    const { body } = await make({ brief: 'x' });

    expect(body.organization).toEqual(ORG);
  });

  it('un rifiuto dello scope ferma la spesa invece di seguirla', async () => {
    openOrgScope.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'no_organization' }), { status: 500 })
    });

    const { res } = await make({ brief: 'x' });

    expect(res.status).toBe(500);
    expect(generateCarouselWithoutBrand).not.toHaveBeenCalled();
  });

  it('il tetto sulle slide è applicato senza spendere', async () => {
    const { res, body } = await make({ brief: 'x', slides: 20 });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(generateCarouselWithoutBrand).not.toHaveBeenCalled();
  });

  /** Una serie incompleta è un carosello mancato: dirlo riuscito lascerebbe comporre meno slide. */
  it('una serie incompleta è un fallimento, non un successo più corto', async () => {
    generateCarouselWithoutBrand.mockResolvedValue({ ok: false, error: 'store_failed' });

    const { res, body } = await make({ brief: 'x' });

    expect(res.status).toBe(502);
    expect(body.error).toBe('store_failed');
  });
});
