import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateBrandRow = vi.fn();
const deleteBrandRow = vi.fn();
const structured = vi.fn();
const gateCredits = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/brand-rows', () => ({
  ROW_NOT_FOUND: 'not_found',
  updateBrandRow: (...args: unknown[]) => updateBrandRow(...args),
  deleteBrandRow: (...args: unknown[]) => deleteBrandRow(...args)
}));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError: class extends Error {}
}));

import { PUT, DELETE } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';

const supabase = {};

function event(body: Record<string, unknown> | null, id = 'p1') {
  return {
    request: new Request('https://example.test/api/v1/brands/demo/products/p1', {
      method: 'PUT',
      body: body === null ? undefined : JSON.stringify(body)
    }),
    params: { slug: 'demo', id }
  };
}

const put = (body: Record<string, unknown>, id?: string) =>
  (PUT as (e: unknown) => Promise<Response>)(event(body, id));
const del = (id?: string) => (DELETE as (e: unknown) => Promise<Response>)(event(null, id));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ supabase, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
  updateBrandRow.mockResolvedValue(null);
  deleteBrandRow.mockResolvedValue(null);
});

describe('PUT /api/v1/brands/:slug/products/:id', () => {
  it('scrive solo il campo passato, non un patch con tutte le colonne', async () => {
    const res = await put({ pricing: '19,90 €' });

    expect(res.status).toBe(200);
    expect(updateBrandRow).toHaveBeenCalledWith(supabase, 'products', 'brand-1', 'p1', {
      pricing: '19,90 €'
    });
  });

  it('rifiuta un id che non è di questo brand senza dire se esiste altrove', async () => {
    updateBrandRow.mockResolvedValue({ error: 'not_found', status: 404 });

    const res = await put({ pricing: '19,90 €' }, 'di-un-altro-brand');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rifiuta un campo che il contratto non dichiara invece di scartarlo in silenzio', async () => {
    const res = await put({ title: 'Blend Milano', brand_id: 'brand-2' });

    expect(res.status).toBe(400);
    expect(updateBrandRow).not.toHaveBeenCalled();
  });

  it('rifiuta una richiesta senza nessun campo da cambiare', async () => {
    updateBrandRow.mockResolvedValue({ error: 'no_fields', status: 400 });

    const res = await put({});

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no_fields' });
  });

  it('non chiama nessun modello e non addebita nessun credito', async () => {
    await put({ title: 'Blend Milano' });

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response('read only', { status: 403 }) as never
    );

    const res = await put({ title: 'Blend Milano' });

    expect(res.status).toBe(403);
    expect(updateBrandRow).not.toHaveBeenCalled();
  });

  it('si ferma prima di scrivere se il brand non è del chiamante', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: null,
      error: new Response('not found', { status: 404 })
    } as never);

    const res = await put({ title: 'Blend Milano' });

    expect(res.status).toBe(404);
    expect(updateBrandRow).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/brands/:slug/products/:id', () => {
  it('cancella la riga del brand', async () => {
    const res = await del();

    expect(res.status).toBe(200);
    expect(deleteBrandRow).toHaveBeenCalledWith(supabase, 'products', 'brand-1', 'p1');
  });

  it('rifiuta la riga di un altro brand invece di rispondere ok su zero righe', async () => {
    deleteBrandRow.mockResolvedValue({ error: 'not_found', status: 404 });

    const res = await del('di-un-altro-brand');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
