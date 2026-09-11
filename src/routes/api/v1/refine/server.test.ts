import { describe, it, expect, vi, beforeEach } from 'vitest';

const refineMediaWithoutBrand = vi.fn();
const openOrgScope = vi.fn();

vi.mock('$lib/server/cli-auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openOrgScope: (...args: unknown[]) => openOrgScope(...args) };
});
vi.mock('$lib/server/media-generate', () => ({
  refineMediaWithoutBrand: (...args: unknown[]) => refineMediaWithoutBrand(...args)
}));

import { POST } from './+server';

const ORG = { id: 'org-1', name: 'Acme' };
const OWN = 'user-1/media/generated-a1.png';

async function refine(body: unknown) {
  const url = new URL('https://anomalia.test/api/v1/refine');
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
  refineMediaWithoutBrand.mockResolvedValue({
    ok: true,
    kind: 'image',
    media: [{ id: null, kind: 'image', mime: 'image/png', width: 1, height: 1, url: 'https://s/1' }],
    model: 'nano-banana-2-lite',
    renders: 1
  });
});

describe('POST /api/v1/refine — correggere senza nominare un brand', () => {
  it('rifinisce la maniglia consegnata, e dice che tipo era', async () => {
    const { res, body } = await refine({ base_media_id: OWN, instruction: 'più caldo' });

    expect(res.status).toBe(200);
    expect(body.kind).toBe('image');
    expect(body.media[0].id).toBeNull();
  });

  it('dice da quale organizzazione sono stati presi i crediti', async () => {
    const { body } = await refine({ base_media_id: OWN, instruction: 'x' });

    expect(body.organization).toEqual(ORG);
  });

  it('un rifiuto dello scope ferma la spesa invece di seguirla', async () => {
    openOrgScope.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'credits_exhausted' }), { status: 402 })
    });

    const { res } = await refine({ base_media_id: OWN, instruction: 'x' });

    expect(res.status).toBe(402);
    expect(refineMediaWithoutBrand).not.toHaveBeenCalled();
  });

  it('brand_style senza un brand è rifiutato dicendo la mossa, non ignorato', async () => {
    const { res, body } = await refine({ base_media_id: OWN, instruction: 'x', brand_style: 'apply' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('brand_style_needs_a_brand');
    expect(refineMediaWithoutBrand).not.toHaveBeenCalled();
  });

  /**
   * Una sorgente che non è una maniglia nostra non risolve, e il render NON parte: ricadere sulla
   * generazione — disegnare da zero credendo di modificare — è il difetto che questa rotta toglie.
   */
  it('una sorgente che non risolve è 404, e niente è stato pagato', async () => {
    refineMediaWithoutBrand.mockResolvedValue({ ok: false, error: 'source_not_found' });

    const { res, body } = await refine({ base_media_id: 'https://evil.test/a.png', instruction: 'x' });

    expect(res.status).toBe(404);
    expect(body.error).toBe('source_not_found');
  });

  /**
   * `source_not_found` su un file che c'è manda l'agente a rigenerare da zero — il difetto chiuso
   * da #403. Il peso e il tetto viaggiano col rifiuto, o resta un 413 che non dice cosa fare.
   */
  it('un file troppo pesante torna 413 col tetto, non un 404', async () => {
    refineMediaWithoutBrand.mockResolvedValue({
      ok: false,
      error: 'source_too_large',
      bytes: null,
      limit: 6_291_456
    });

    const { res, body } = await refine({ base_media_id: OWN, instruction: 'x' });

    expect(res.status).toBe(413);
    expect(body).toMatchObject({ error: 'source_too_large', bytes: null, limit: 6_291_456 });
  });

  /** Senza preferenze di brand non c'è un modello di rifinitura video: si dice, non si rifilma. */
  it('un clip senza modello di rifinitura si rifiuta invece di rifilmare', async () => {
    refineMediaWithoutBrand.mockResolvedValue({ ok: false, error: 'no_refine_model' });

    const { res, body } = await refine({ base_media_id: 'user-1/generated/a.mp4', instruction: 'x' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('no_refine_model');
  });
});
