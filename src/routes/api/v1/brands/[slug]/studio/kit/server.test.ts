import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

import { PUT } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

const upserted: Row[] = [];

function fakeSupabase() {
  return {
    from(table: string) {
      const q = {
        upsert: async (row: Row) => {
          if (table === 'brand_kit') upserted.push(row);
          return { error: null };
        },
        select: () => q,
        eq: () => q,
        update: () => q,
        maybeSingle: async () => ({ data: { content_prefs: {} }, error: null }),
        then: (resolve: (v: { data: null; error: null }) => unknown) => resolve({ data: null, error: null })
      };
      return q;
    }
  };
}

function signedIn() {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(),
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo Brand' },
    error: null
  } as never);
}

function put(body: Row) {
  return (PUT as (event: unknown) => Promise<Response>)({
    request: new Request('https://anomalia.test/api/v1/brands/demo/studio/kit', {
      method: 'PUT',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo' }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upserted.length = 0;
});

describe('PUT /studio/kit', () => {
  /**
   * `update_brand_kit` promette «Only the fields you send change», e l'upsert spediva tutte e
   * quattro le colonne con `about ?? null`: correggere la categoria cancellava quello che il brand
   * dice di sé, il pubblico a cui parla e il suo stile — i fatti da cui è scritto ogni post
   * generato. Nessun errore, nessuna schermata: la riga tornava `ok: true`.
   */
  it('non azzera i campi che non hai mandato', async () => {
    signedIn();

    const res = await put({ category: 'bakery' });

    expect(res.status).toBe(200);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toEqual({ brand_id: 'brand-1', category: 'bakery' });
  });

  it('scrive null solo quando null è quello che hai mandato', async () => {
    signedIn();

    await put({ about: null, target_audience: 'chi cucina la domenica' });

    expect(upserted[0]).toEqual({
      brand_id: 'brand-1',
      about: null,
      target_audience: 'chi cucina la domenica'
    });
  });

  it('non tocca il kit quando cambi soltanto la lingua', async () => {
    signedIn();

    const res = await put({ language: 'it' });

    expect(res.status).toBe(200);
    expect(upserted).toHaveLength(0);
  });
});
