import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn()
}));

import { GET } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] === value);
          return q;
        },
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null })
      };
      return q;
    }
  };
}

const CONTRACT = 'Clausola 4.2: la garanzia decade se il macinacaffè viene aperto. '.repeat(40);

const TABLES: Record<string, Row[]> = {
  brand_documents: [
    {
      id: 'd1',
      brand_id: 'brand-1',
      kind: 'document',
      title: 'Contratto di fornitura',
      content_text: CONTRACT,
      file_url: null,
      file_name: 'contratto.pdf',
      mime_type: 'application/pdf',
      created_at: '2026-08-01T00:00:00Z',
      status: 'ready',
      chunk_count: 9
    },
    {
      id: 'd2',
      brand_id: 'brand-1',
      kind: 'note',
      title: 'Nota vuota',
      content_text: null,
      file_url: null,
      file_name: null,
      mime_type: null,
      created_at: '2026-08-02T00:00:00Z',
      status: 'pending',
      chunk_count: 0
    }
  ]
};

function signedIn() {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(TABLES),
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo Brand' },
    error: null
  } as never);
}

function call(query: Record<string, string> = {}, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/studio`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return (GET as (event: unknown) => Promise<Response>)({
    request: new Request(url),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /studio — documents', () => {
  /**
   * Il campo non aveva nessun lettore: la CLI stampa icona, titolo e id, `strategy-agent-reads`
   * usa `.length`, la pagina Knowledge ha la sua query. L'unico effetto era rovesciare il corpus
   * nella finestra di un agente esterno, che a quel punto non cerca più.
   */
  it('per difetto non spedisce il testo dei documenti', async () => {
    signedIn();

    const { res, body } = await call();

    expect(res.status).toBe(200);
    expect(body.documents).toHaveLength(2);
    expect(body.documents[0]).not.toHaveProperty('content_text');
    expect(JSON.stringify(body)).not.toContain('Clausola 4.2');
  });

  it('dice che il testo c’è e quanto pesa, senza spedirlo', async () => {
    signedIn();

    const { body } = await call();

    expect(body.documents[0]).toMatchObject({
      id: 'd1',
      title: 'Contratto di fornitura',
      status: 'ready',
      chunkCount: 9,
      textBytes: CONTRACT.length
    });
    expect(body.documents[1].textBytes).toBe(0);
  });

  it('restituisce il testo, byte per byte, a chi lo chiede', async () => {
    signedIn();

    const { body } = await call({ documents: 'full' });

    expect(body.documents[0].content_text).toBe(CONTRACT);
    expect(body.documents[1].content_text).toBeNull();
    expect(body.documents[0].textBytes).toBe(CONTRACT.length);
  });

  it('un valore inventato non apre il rubinetto: vale il difetto', async () => {
    signedIn();

    const { body } = await call({ documents: 'tutto' });

    expect(body.documents[0]).not.toHaveProperty('content_text');
  });

  it('il resto dello studio non cambia', async () => {
    signedIn();

    const { body } = await call();

    for (const key of ['kit', 'products', 'history', 'people', 'competitors', 'targetPlatforms', 'studioPct']) {
      expect(body, key).toHaveProperty(key);
    }
  });
});
