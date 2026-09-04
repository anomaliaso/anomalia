import { describe, it, expect, vi, beforeEach } from 'vitest';

const structured = vi.fn();
const gateCredits = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError: class extends Error {}
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

function fakeSupabase(insertError: { message: string } | null = null) {
  const inserted: Row[] = [];
  const client = {
    from() {
      const q = {
        insert(row: Row) {
          inserted.push(row);
          return q;
        },
        select: () => q,
        single: async () => ({
          data: insertError
            ? null
            : { id: 'p1', title: inserted[0].title, kind: 'product', pricing: null, featured: true },
          error: insertError
        })
      };
      return q;
    }
  };
  return { client, inserted };
}

let supabase: ReturnType<typeof fakeSupabase>;

const post = (body: Record<string, unknown>) =>
  (POST as (e: unknown) => Promise<Response>)({
    request: new Request('https://example.test/api/v1/brands/demo/studio/products', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo' }
  });

beforeEach(() => {
  vi.clearAllMocks();
  supabase = fakeSupabase();
  vi.mocked(authenticate).mockResolvedValue({ supabase: supabase.client, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
});

describe('POST /api/v1/brands/:slug/studio/products', () => {
  it('crea l’offerta sul brand del chiamante e la restituisce', async () => {
    const res = await post({ title: 'Blend Milano', pricing: '18,50 €' });

    expect(res.status).toBe(200);
    expect(supabase.inserted[0]).toEqual({
      brand_id: 'brand-1',
      title: 'Blend Milano',
      pricing: '18,50 €'
    });
    expect(await res.json()).toEqual({
      ok: true,
      product: { id: 'p1', title: 'Blend Milano', kind: 'product', pricing: null, featured: true }
    });
  });

  it('non scrive le colonne che il chiamante non ha nominato: restano i default del database', async () => {
    await post({ title: 'Blend Milano' });

    expect(Object.keys(supabase.inserted[0]).sort()).toEqual(['brand_id', 'title']);
  });

  it('rifiuta un’offerta senza titolo', async () => {
    const res = await post({ pricing: '18,50 €' });

    expect(res.status).toBe(400);
    expect(supabase.inserted).toEqual([]);
  });

  it('non lascia scegliere il brand a chi chiama', async () => {
    const res = await post({ title: 'Blend Milano', brand_id: 'brand-2' });

    expect(res.status).toBe(400);
    expect(supabase.inserted).toEqual([]);
  });

  it('non chiama nessun modello e non addebita nessun credito', async () => {
    await post({ title: 'Blend Milano' });

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response('read only', { status: 403 }) as never
    );

    const res = await post({ title: 'Blend Milano' });

    expect(res.status).toBe(403);
    expect(supabase.inserted).toEqual([]);
  });

  it('si ferma prima di scrivere se il brand non è del chiamante', async () => {
    vi.mocked(loadBrandForUser).mockResolvedValue({
      brand: null,
      error: new Response('not found', { status: 404 })
    } as never);

    const res = await post({ title: 'Blend Milano' });

    expect(res.status).toBe(404);
    expect(supabase.inserted).toEqual([]);
  });

  it('riporta il fallimento della scrittura come 500 dichiarato', async () => {
    supabase = fakeSupabase({ message: 'connection reset' });
    vi.mocked(authenticate).mockResolvedValue({ supabase: supabase.client, apiKey: null, error: null } as never);

    const res = await post({ title: 'Blend Milano' });

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('insert_failed');
  });
});
