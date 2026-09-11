import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il clip che nessun brand reclama. Non torna mai pronto, quindi la rotta ha due metà: quella che
 * lo manda in coda e quella che dice dov'è finito — e senza la seconda un clip pagato resterebbe
 * irraggiungibile, che è la forma esatta di `CLIP_NOT_IN_LIBRARY`.
 */

const generateVideoWithoutBrand = vi.fn();
const listOrgMediaJobs = vi.fn();
const openOrgScope = vi.fn();

vi.mock('$lib/server/cli-auth', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, openOrgScope: (...args: unknown[]) => openOrgScope(...args) };
});
vi.mock('$lib/server/media-generate', () => ({
  generateVideoWithoutBrand: (...args: unknown[]) => generateVideoWithoutBrand(...args),
  listOrgMediaJobs: (...args: unknown[]) => listOrgMediaJobs(...args)
}));

import { GET, POST } from './+server';

const ORG = { id: 'org-1', name: 'Acme' };

async function film(body: unknown) {
  const url = new URL('https://anomalia.test/api/v1/videos');
  const res = await (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    url
  });

  return { res, body: await res.json() };
}

async function check(query = '') {
  const url = new URL(`https://anomalia.test/api/v1/videos${query}`);
  const res = await (GET as (event: unknown) => Promise<Response>)({
    request: new Request(url),
    url
  });

  return { res, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  openOrgScope.mockResolvedValue({
    scope: { supabase: {}, user: { id: 'user-1' }, orgId: 'org-1', organization: ORG }
  });
  generateVideoWithoutBrand.mockResolvedValue({
    ok: true,
    status: 'rendering',
    media: [],
    jobId: 'job-1',
    model: 'bytedance/seedance-2-5',
    renders: 0,
    durationSeconds: 8
  });
  listOrgMediaJobs.mockResolvedValue([
    { id: 'job-1', status: 'done', media_url: 'https://cdn/clip.mp4', error: null, submitted_at: '2026-09-11T10:00:00Z' }
  ]);
});

describe('POST /api/v1/videos — filmare senza nominare un brand', () => {
  it('torna un lavoro da seguire, non un clip: kie ci mette minuti', async () => {
    const { res, body } = await film({ prompt: 'un gatto che salta' });

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'rendering', job_id: 'job-1' });
  });

  it('dice da quale organizzazione sono stati presi i crediti', async () => {
    const { body } = await film({ prompt: 'un gatto' });

    expect(body.organization).toEqual(ORG);
  });

  /** I secondi DAVVERO mandati: un clip si paga al secondo, e il modello ha una sua finestra. */
  it('dice quanti secondi sono stati mandati, non quanti ne sono stati chiesti', async () => {
    const { body } = await film({ prompt: 'un gatto', duration: 8 });

    expect(body.duration_seconds).toBe(8);
  });

  it('un rifiuto dello scope ferma la spesa invece di seguirla', async () => {
    openOrgScope.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'brand_scoped_key' }), { status: 403 })
    });

    const { res } = await film({ prompt: 'un gatto' });

    expect(res.status).toBe(403);
    expect(generateVideoWithoutBrand).not.toHaveBeenCalled();
  });

  /** Chi paga lo risolve lo scope, mai il corpo: un campo in piu' cade prima di spendere. */
  it('un organizzazione passata dal chiamante non è una scelta: si rifiuta', async () => {
    const { res } = await film({ prompt: 'un gatto', org_id: 'org-di-qualcun-altro' });

    expect(res.status).toBe(400);
    expect(generateVideoWithoutBrand).not.toHaveBeenCalled();
  });

  it('addebita all organizzazione risolta dallo scope', async () => {
    await film({ prompt: 'un gatto' });

    expect(generateVideoWithoutBrand).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }));
  });

  /** Il motivo del fornitore risale: un `render_failed` nudo nasconde l'unica cosa che serviva. */
  it('porta su il motivo del rifiuto del fornitore', async () => {
    generateVideoWithoutBrand.mockResolvedValue({
      ok: false,
      error: 'render_failed',
      reason: 'il modello ha rifiutato il prompt'
    });

    const { res, body } = await film({ prompt: 'x' });

    expect(res.status).toBe(502);
    expect(body.reason).toBe('il modello ha rifiutato il prompt');
  });

  it('una durata fuori finestra si rifiuta senza spendere', async () => {
    const { res, body } = await film({ prompt: 'x', duration: 99 });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(generateVideoWithoutBrand).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/videos — dove è finito il clip', () => {
  it('consegna dove sono i clip, non un id di libreria che non esiste', async () => {
    const { res, body } = await check();

    expect(res.status).toBe(200);
    expect(body.jobs[0].media_url).toBe('https://cdn/clip.mp4');
  });

  it('un job alla volta, quando se ne nomina uno', async () => {
    await check('?job_id=job-1');

    expect(listOrgMediaJobs).toHaveBeenCalledWith(expect.anything(), 'org-1', 'job-1');
  });

  /** L'organizzazione la risolve lo scope, mai la querystring: un id indovinato non apre niente. */
  it('un organizzazione nella querystring si rifiuta, non si segue', async () => {
    const { res } = await check('?job_id=job-1&org_id=org-di-qualcun-altro');

    expect(res.status).toBe(400);
    expect(listOrgMediaJobs).not.toHaveBeenCalled();
  });
});
