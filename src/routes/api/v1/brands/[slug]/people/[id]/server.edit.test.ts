import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateBrandRow = vi.fn();
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
  deleteBrandRow: vi.fn()
}));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError: class extends Error {}
}));

import { PUT } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';

const supabase = {};

const put = (body: Record<string, unknown>, id = 'per1') =>
  (PUT as (e: unknown) => Promise<Response>)({
    request: new Request('https://example.test/api/v1/brands/demo/people/per1', {
      method: 'PUT',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo', id }
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({ supabase, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
  updateBrandRow.mockResolvedValue(null);
});

describe('PUT /api/v1/brands/:slug/people/:id', () => {
  it('corregge il ruolo e non tocca nient’altro della persona', async () => {
    const res = await put({ role: 'Co-fondatrice' });

    expect(res.status).toBe(200);
    expect(updateBrandRow.mock.lastCall).toStrictEqual([
      supabase,
      'people',
      'brand-1',
      'per1',
      { role: 'Co-fondatrice' }
    ]);
  });

  // Il consenso lo attesta una persona, non un agente: fino ad allora resolvePeopleVisualRefs
  // nega quel volto a ogni generatore. Una modifica non è la scorciatoia per concederlo.
  it('non lascia che una modifica attesti il consenso o cambi il tipo di persona', async () => {
    for (const forbidden of [
      { consent: true },
      { consent_source: 'owner_attested' },
      { kind: 'ai' },
      { images: [] }
    ]) {
      const res = await put({ role: 'Co-fondatrice', ...forbidden });

      expect(res.status, Object.keys(forbidden)[0]).toBe(400);
      expect(updateBrandRow).not.toHaveBeenCalled();
    }
  });

  it('rifiuta una persona di un altro brand senza dire se esiste altrove', async () => {
    updateBrandRow.mockResolvedValue({ error: 'not_found', status: 404 });

    const res = await put({ role: 'Co-fondatrice' }, 'di-un-altro-brand');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('non chiama nessun modello e non addebita nessun credito', async () => {
    await put({ name: 'Marta' });

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response('read only', { status: 403 }) as never
    );

    const res = await put({ name: 'Marta' });

    expect(res.status).toBe(403);
    expect(updateBrandRow).not.toHaveBeenCalled();
  });

  it('si ferma prima di scrivere se il brand non è del chiamante', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: null,
      error: new Response('not found', { status: 404 })
    } as never);

    const res = await put({ name: 'Marta' });

    expect(res.status).toBe(404);
    expect(updateBrandRow).not.toHaveBeenCalled();
  });
});
