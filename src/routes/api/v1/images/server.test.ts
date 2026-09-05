import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La rotta che non chiede un brand. Quello che conta qui sono i rifiuti e chi paga: un render che
 * parte quando non doveva è denaro speso, e un render che parte senza dire a chi è stato addebitato
 * è denaro speso in silenzio — che in una sessione vera voleva dire il gatto di qualcuno sul conto
 * di un cliente.
 */

const generateImagesWithoutBrand = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  gateOrgAiAction: vi.fn(),
  apiKeyIsBrandScoped: vi.fn()
}));
vi.mock('$lib/server/org', () => ({
  ensureOrgForUser: vi.fn()
}));
vi.mock('$lib/server/media-generate', () => ({
  generateImagesWithoutBrand: (...args: unknown[]) => generateImagesWithoutBrand(...args)
}));

import { POST } from './+server';
import { authenticate, gateOrgAiAction, apiKeyIsBrandScoped } from '$lib/server/cli-auth';
import { ensureOrgForUser } from '$lib/server/org';

const DRAWN = {
  id: null,
  kind: 'image',
  mime: 'image/png',
  width: 1024,
  height: 1024,
  url: 'https://storage.test/signed?token=abc',
  storage_path: 'user-1/media/generated-x.png'
};

function supabaseWithOrgName(name: string | null) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'org-1', name }, error: null }) }) })
    })
  };
}

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
  vi.mocked(authenticate).mockResolvedValue({
    supabase: supabaseWithOrgName('Acme'),
    user: { id: 'user-1', email: 'andrea@teta.so' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(ensureOrgForUser).mockResolvedValue('org-1' as never);
  vi.mocked(gateOrgAiAction).mockResolvedValue(undefined as never);
  vi.mocked(apiKeyIsBrandScoped).mockReturnValue(false as never);
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

  /**
   * Il test più importante dei due buchi nei pagamenti, e l'unico che si vede da TypeScript:
   * senza crediti non si disegna nemmeno quando non c'è un brand da interrogare.
   */
  it('senza crediti non disegna, e il render non parte', async () => {
    vi.mocked(gateOrgAiAction).mockResolvedValue(
      new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 402 }) as never
    );

    const { res } = await generate({ prompt: 'un gatto' });

    expect(res.status).toBe(402);
    expect(generateImagesWithoutBrand).not.toHaveBeenCalled();
  });

  it('dice da quale organizzazione sono stati presi i crediti', async () => {
    const { body } = await generate({ prompt: 'un gatto' });

    expect(body.organization).toEqual({ id: 'org-1', name: 'Acme' });
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

  /**
   * Una chiave ristretta a certi brand è una restrizione che l'utente ha scelto. Lasciarla spendere
   * fuori da quei brand la allargherebbe in silenzio, proprio mentre si apre una strada nuova.
   */
  it('una chiave ristretta a certi brand non spende fuori da quelli', async () => {
    vi.mocked(apiKeyIsBrandScoped).mockReturnValue(true as never);

    const { res, body } = await generate({ prompt: 'un gatto' });

    expect(res.status).toBe(403);
    expect(body.error).toBe('brand_scoped_key');
    expect(generateImagesWithoutBrand).not.toHaveBeenCalled();
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
