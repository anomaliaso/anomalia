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
  EMPTY_PATCH: 'no_fields',
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

function event(body: Record<string, unknown> | null, id = 'c1') {
  return {
    request: new Request('https://example.test/api/v1/brands/demo/studio/competitors/c1', {
      method: 'PUT',
      body: body === null ? undefined : JSON.stringify(body)
    }),
    params: { slug: 'demo', id }
  };
}

const put = (body: Record<string, unknown>, id?: string) =>
  (PUT as (e: unknown) => Promise<Response>)(event(body, id));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ supabase, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
  updateBrandRow.mockResolvedValue(null);
  deleteBrandRow.mockResolvedValue(null);
});

describe('PUT /api/v1/brands/:slug/studio/competitors/:id', () => {
  it('ripara il sito e lascia intatti nome, tipo e motivazione', async () => {
    const res = await put({ website: 'cafferivale.it' });

    expect(res.status).toBe(200);
    expect(updateBrandRow).toHaveBeenCalledWith(supabase, 'competitors', 'brand-1', 'c1', {
      website: 'https://cafferivale.it'
    });
  });

  it('non azzera il sito quando la modifica riguarda solo la motivazione', async () => {
    await put({ rationale: 'Stesso scaffale, stesso prezzo' });

    expect(updateBrandRow).toHaveBeenCalledWith(supabase, 'competitors', 'brand-1', 'c1', {
      rationale: 'Stesso scaffale, stesso prezzo'
    });
  });

  it('rifiuta un kind che il CHECK del database non accetta', async () => {
    const res = await put({ kind: 'laterale' });

    expect(res.status).toBe(400);
    expect(updateBrandRow).not.toHaveBeenCalled();
  });

  it('rifiuta un competitor di un altro brand senza dire se esiste altrove', async () => {
    updateBrandRow.mockResolvedValue({ error: 'not_found', status: 404 });

    const res = await put({ name: 'Caffè Rivale' }, 'di-un-altro-brand');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('non chiama nessun modello e non addebita nessun credito', async () => {
    await put({ name: 'Caffè Rivale' });

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response('read only', { status: 403 }) as never
    );

    const res = await put({ name: 'Caffè Rivale' });

    expect(res.status).toBe(403);
    expect(updateBrandRow).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/brands/:slug/studio/competitors/:id', () => {
  it('rifiuta la riga di un altro brand invece di rispondere ok su zero righe', async () => {
    deleteBrandRow.mockResolvedValue({ error: 'not_found', status: 404 });

    const res = await (DELETE as (e: unknown) => Promise<Response>)(event(null, 'di-un-altro-brand'));

    expect(res.status).toBe(404);
    expect(deleteBrandRow).toHaveBeenCalledWith(
      supabase,
      'competitors',
      'brand-1',
      'di-un-altro-brand'
    );
  });
});
