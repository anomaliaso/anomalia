import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La rotta che non chiede un brand. I rifiuti condivisi — nessuna organizzazione, chiave ristretta,
 * crediti — vivono in `orgScopeFor` e si provano lì, una volta sola. Qui conta che questa rotta li
 * metta PRIMA di spendere, e che dica chi ha pagato: un render che parte quando non doveva è denaro
 * speso, e uno che parte senza dire a chi è stato addebitato è denaro speso in silenzio.
 */

const generateImagesWithoutBrand = vi.fn();
const openOrgScope = vi.fn();

vi.mock('$lib/server/cli-auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openOrgScope: (...args: unknown[]) => openOrgScope(...args) };
});
vi.mock('$lib/server/media-generate', () => ({
  generateImagesWithoutBrand: (...args: unknown[]) => generateImagesWithoutBrand(...args)
}));

import { POST } from './+server';

const DRAWN = {
  id: null,
  kind: 'image',
  mime: 'image/png',
  width: 1024,
  height: 1024,
  url: 'https://storage.test/signed?token=abc',
  storage_path: 'user-1/media/generated-x.png'
};

const ORG = { id: 'org-1', name: 'Acme' };

async function generate(body: unknown) {
  const url = new URL('https://anomalia.test/api/v1/images');
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
  generateImagesWithoutBrand.mockResolvedValue({
    ok: true,
    media: [DRAWN],
    model: 'nano-banana-2-lite',
    renders: 1,
    costUsd: 0.0336
  });
});

describe('POST /api/v1/images — disegnare senza nominare un brand', () => {
  it('disegna, e non serve nessuno slug', async () => {
    const { res, body } = await generate({ prompt: 'un gatto' });

    expect(res.status).toBe(200);
    expect(body.media).toEqual([DRAWN]);
  });

  it('dice da quale organizzazione sono stati presi i crediti', async () => {
    const { body } = await generate({ prompt: 'un gatto' });

    expect(body.organization).toEqual(ORG);
  });

  /** Il rifiuto dello scope arriva PRIMA del render: dopo, sarebbe già stato pagato. */
  it('un rifiuto dello scope ferma la spesa invece di seguirla', async () => {
    openOrgScope.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 402 })
    });

    const { res } = await generate({ prompt: 'un gatto' });

    expect(res.status).toBe(402);
    expect(generateImagesWithoutBrand).not.toHaveBeenCalled();
  });

  it('addebita all organizzazione risolta, non a una passata dal chiamante', async () => {
    await generate({ prompt: 'un gatto', org_id: 'org-di-qualcun-altro' });

    expect(generateImagesWithoutBrand).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org-di-qualcun-altro' })
    );
  });

  it('dice quanto è costato, misurato, invece di una tariffa scritta a mano', async () => {
    const { body } = await generate({ prompt: 'un gatto' });

    expect(body.cost_usd).toBe(0.0336);
  });

  it('una fattura che non è arrivata resta sconosciuta, non zero', async () => {
    generateImagesWithoutBrand.mockResolvedValue({
      ok: true,
      media: [DRAWN],
      model: 'nano-banana-2-lite',
      renders: 1,
      costUsd: null
    });

    const { body } = await generate({ prompt: 'un gatto' });

    expect(body.cost_usd).toBeNull();
  });

  it('il tetto sulle alternative è applicato senza spendere', async () => {
    const { res, body } = await generate({ prompt: 'tre direzioni', count: 5 });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(generateImagesWithoutBrand).not.toHaveBeenCalled();
  });

  it('brand_style senza un brand è rifiutato dicendo la mossa, non ignorato', async () => {
    const { res, body } = await generate({ prompt: 'un gatto', brand_style: 'apply' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('brand_style_needs_a_brand');
    expect(body.reason).toMatch(/pass a slug, or drop brand_style/);
    expect(generateImagesWithoutBrand).not.toHaveBeenCalled();
  });

  it('un modello che non sa fare questo mestiere è rifiutato con l elenco di quelli buoni', async () => {
    generateImagesWithoutBrand.mockResolvedValue({
      ok: false,
      error: 'model_not_for_slot',
      allowed: ['nano-banana-2-lite', 'nano-banana-pro']
    });

    const { res, body } = await generate({ prompt: 'x', model: 'un-modello-che-non-esiste' });

    expect(res.status).toBe(400);
    expect(body.allowed).toEqual(['nano-banana-2-lite', 'nano-banana-pro']);
  });
});
