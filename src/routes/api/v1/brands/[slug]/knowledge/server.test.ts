import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn()
}));

import { GET } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { DOC_STATUSES, KNOWLEDGE_FAILURES_MAX } from '$lib/server/knowledge';
import { KNOWLEDGE_DOC_STATUSES } from '@anomalia/api-contracts';

type Row = Record<string, unknown>;

/**
 * Ogni tabella della pipeline è in memoria e i filtri sono quelli veri: `eq`, `neq`, `in`, e il
 * conteggio `head`. Il corpus contiene DUE brand, così un conteggio che dimentica `brand_id`
 * non passa il test invece di gonfiarsi in silenzio.
 */
function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let counting = false;

      const q = {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          counting = opts?.head === true;
          return q;
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] === value);
          return q;
        },
        neq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] !== value);
          return q;
        },
        not(column: string, _op: string, _value: unknown) {
          rows = rows.filter((r) => r[column] !== null && r[column] !== undefined);
          return q;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((r) => values.includes(r[column]));
          return q;
        },
        order: () => q,
        limit(n: number) {
          rows = rows.slice(0, n);
          return q;
        },
        then: (resolve: (v: { data: Row[] | null; count: number; error: null }) => unknown) =>
          resolve({ data: counting ? null : rows, count: rows.length, error: null })
      };
      return q;
    }
  };
}

const OWN_DOCS: Row[] = [
  { id: 'd1', brand_id: 'brand-1', kind: 'document', title: 'Listino', status: 'ready', error: null, chunk_count: 12, collection: 'commercial', attempts: 1 },
  { id: 'd2', brand_id: 'brand-1', kind: 'note', title: 'Tono di voce', status: 'ready', error: null, chunk_count: 3, collection: 'brand', attempts: 1 },
  { id: 'd3', brand_id: 'brand-1', kind: 'document', title: 'Manuale', status: 'pending', error: null, chunk_count: 0, collection: null, attempts: 0 },
  { id: 'd4', brand_id: 'brand-1', kind: 'document', title: 'Contratto', status: 'processing', error: null, chunk_count: 0, collection: 'legal', attempts: 1 },
  { id: 'd5', brand_id: 'brand-1', kind: 'document', title: 'Bilancio.pdf', status: 'failed', error: 'PDF is password protected', chunk_count: 0, collection: null, attempts: 3 },
  { id: 'd6', brand_id: 'brand-1', kind: 'document', title: 'Vecchia nota', status: 'ready', error: null, chunk_count: 0, collection: null, attempts: 0 },
  { id: 'img', brand_id: 'brand-1', kind: 'image', title: 'logo.png', status: 'ready', error: null, chunk_count: 0, collection: null, attempts: 0 }
];

const FOREIGN_DOCS: Row[] = Array.from({ length: 40 }, (_, i) => ({
  id: `x${i}`,
  brand_id: 'brand-2',
  kind: 'document',
  title: 'Segreto industriale del vicino',
  status: 'failed',
  error: 'il concorrente ha rotto qualcosa',
  chunk_count: 0,
  collection: 'research',
  attempts: 3
}));

const TABLES: Record<string, Row[]> = {
  brand_documents: [...OWN_DOCS, ...FOREIGN_DOCS],
  brand_doc_chunks: [
    ...Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, brand_id: 'brand-1', embedding: i < 10 ? '[0.1]' : null })),
    ...Array.from({ length: 99 }, (_, i) => ({ id: `f${i}`, brand_id: 'brand-2', embedding: '[0.2]' }))
  ],
  brand_knowledge_sources: [
    {
      id: 's1',
      brand_id: 'brand-1',
      provider: 'notion',
      display_name: 'Wiki di prodotto',
      status: 'active',
      last_sync_at: '2026-09-03T10:00:00Z',
      last_error: null,
      docs_ingested: 18
    },
    {
      id: 's2',
      brand_id: 'brand-1',
      provider: 'google-drive',
      display_name: 'Drive marketing',
      status: 'error',
      last_sync_at: '2026-08-30T09:00:00Z',
      last_error: 'folder no longer shared',
      docs_ingested: 4
    },
    {
      id: 's3',
      brand_id: 'brand-2',
      provider: 'github',
      display_name: 'Repo del vicino',
      status: 'active',
      last_sync_at: '2026-09-04T09:00:00Z',
      last_error: null,
      docs_ingested: 77
    }
  ]
};

function signedIn(tables: Record<string, Row[]> = TABLES) {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(tables),
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo Brand' },
    error: null
  } as never);
}

function call(slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/knowledge`);
  return (GET as (event: unknown) => Promise<Response>)({
    request: new Request(url),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /knowledge', () => {
  it('non conta i documenti di un altro brand, né ne nomina i guasti', async () => {
    signedIn();

    const { res, body } = await call();

    expect(res.status).toBe(200);
    expect(body.documents.total).toBe(6);
    expect(body.documents.failed).toBe(1);
    expect(JSON.stringify(body)).not.toContain('Segreto industriale del vicino');
    expect(JSON.stringify(body)).not.toContain('Repo del vicino');
    expect(body.chunks.total).toBe(15);
  });

  it('distingue caricato da digerito, che sono due situazioni opposte', async () => {
    signedIn();

    const { body } = await call();

    expect(body.documents).toMatchObject({
      total: 6,
      ready: 3,
      pending: 1,
      processing: 1,
      failed: 1,
      indexed: 2
    });
    expect(body.chunks).toEqual({ total: 15, embedded: 10 });
    expect(body.searchable).toBe(true);
  });

  it('dice perché un documento è fallito, non solo che è fallito', async () => {
    signedIn();

    const { body } = await call();

    expect(body.failures).toEqual([
      { id: 'd5', title: 'Bilancio.pdf', error: 'PDF is password protected', attempts: 3 }
    ]);
  });

  it('elenca le collezioni con qualcosa dentro, così `search_knowledge` sa cosa restringere', async () => {
    signedIn();

    const { body } = await call();

    expect(body.collections).toEqual({ commercial: 1, brand: 1 });
  });

  it('dice quali fonti sono collegate e quando hanno sincronizzato', async () => {
    signedIn();

    const { body } = await call();

    expect(body.sources).toEqual([
      {
        provider: 'notion',
        displayName: 'Wiki di prodotto',
        status: 'active',
        lastSyncAt: '2026-09-03T10:00:00Z',
        lastError: null,
        docsIngested: 18
      },
      {
        provider: 'google-drive',
        displayName: 'Drive marketing',
        status: 'error',
        lastSyncAt: '2026-08-30T09:00:00Z',
        lastError: 'folder no longer shared',
        docsIngested: 4
      }
    ]);
  });

  it('un brand senza niente non è "rotto": è vuoto, e lo dice', async () => {
    signedIn({ brand_documents: [], brand_doc_chunks: [], brand_knowledge_sources: [] });

    const { body } = await call();

    expect(body.documents.total).toBe(0);
    expect(body.searchable).toBe(false);
    expect(body.failures).toEqual([]);
    expect(body.sources).toEqual([]);
  });

  it('non rovescia mille guasti nella finestra di chi chiede', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `b${i}`,
      brand_id: 'brand-1',
      kind: 'document',
      title: `rotto-${i}`,
      status: 'failed',
      error: 'boom',
      chunk_count: 0,
      collection: null,
      attempts: 3
    }));
    signedIn({ ...TABLES, brand_documents: [...many, ...FOREIGN_DOCS] });

    const { body } = await call();

    expect(body.documents.failed).toBe(60);
    expect(body.failures.length).toBe(KNOWLEDGE_FAILURES_MAX);
  });

  it('gli stati dichiarati nel contratto sono quelli che la pipeline attraversa', () => {
    expect([...KNOWLEDGE_DOC_STATUSES]).toEqual([...DOC_STATUSES]);
  });
});
