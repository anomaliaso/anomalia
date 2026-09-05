import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn()
}));

import { GET } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { COLLECTIONS } from '$lib/server/knowledge';
import { KNOWLEDGE_COLLECTIONS, KNOWLEDGE_EXCERPT_CHARS, KNOWLEDGE_HITS_MAX } from '@anomalia/api-contracts';

type Chunk = {
  id: string;
  brand_id: string;
  document_id: string;
  heading_path: string | null;
  content: string;
  title: string | null;
  collection?: string | null;
};

/**
 * Il finto Supabase imita le due RPC come le scrive il SQL vero: filtrano per `p_brand`, e la
 * ricerca testuale su `content`. Un fake che restituisce quello che gli dici non dimostra
 * l'isolamento — questo sì, perché il corpus in memoria contiene due brand.
 */
function fakeSupabase(chunks: Chunk[]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];

  const matching = (args: Record<string, unknown>) => {
    const needle = String(args.p_query ?? '').toLowerCase();
    const collection = args.p_collection as string | null;
    return chunks
      .filter((c) => c.brand_id === args.p_brand)
      .filter((c) => !collection || c.collection === collection)
      .filter((c) => !needle || c.content.toLowerCase().includes(needle))
      .slice(0, Number(args.p_limit ?? 8))
      .map((c) => ({
        id: c.id,
        document_id: c.document_id,
        heading_path: c.heading_path,
        content: c.content,
        score: 1,
        title: c.title
      }));
  };

  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'search_brand_chunks') return { data: matching(args), error: null };
      return { data: [], error: null };
    }
  };
}

const OWN: Chunk = {
  id: 'chunk-own',
  brand_id: 'brand-1',
  document_id: 'doc-own',
  heading_path: 'Garanzia',
  content: 'La garanzia del macinacaffè dura 24 mesi.',
  title: 'Condizioni'
};

const FOREIGN: Chunk = {
  id: 'chunk-foreign',
  brand_id: 'brand-2',
  document_id: 'doc-foreign',
  heading_path: 'Segreti',
  content: 'Il margine riservato del concorrente è del 62 percento.',
  title: 'Listino interno'
};

let supabase: ReturnType<typeof fakeSupabase>;

function signedIn(chunks: Chunk[] = [OWN, FOREIGN]) {
  supabase = fakeSupabase(chunks);
  vi.mocked(authenticate).mockResolvedValue({
    supabase,
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo Brand' },
    error: null
  } as never);
}

function call(query: Record<string, string>, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/knowledge/search`);
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

describe('GET /knowledge/search', () => {
  it('la ricerca non attraversa i brand: il documento di un altro non esce nemmeno cercandone il contenuto esatto', async () => {
    signedIn();

    const { res, body } = await call({ query: 'margine riservato del concorrente' });

    expect(res.status).toBe(200);
    expect(body.hits).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('62 percento');
    expect(JSON.stringify(body)).not.toContain('doc-foreign');
  });

  it('interroga sempre il brand risolto dallo slug, mai uno scelto da chi chiama', async () => {
    signedIn();

    await call({ query: 'garanzia', brand_id: 'brand-2', p_brand: 'brand-2' });

    for (const { args } of supabase.calls) {
      expect(args.p_brand).toBe('brand-1');
    }
  });

  it('restituisce i passi del proprio brand con la provenienza', async () => {
    signedIn();

    const { body } = await call({ query: 'garanzia' });

    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({
      chunkId: 'chunk-own',
      documentId: 'doc-own',
      title: 'Condizioni',
      headingPath: 'Garanzia',
      truncated: false
    });
    expect(body.hits[0].excerpt).toContain('24 mesi');
    expect(body.count).toBe(1);
  });

  it('taglia un passo lungo invece di rovesciarlo nella finestra di chi chiede', async () => {
    const long = { ...OWN, content: `${'a'.repeat(KNOWLEDGE_EXCERPT_CHARS + 500)} garanzia` };
    signedIn([long]);

    const { body } = await call({ query: 'garanzia' });

    expect(body.hits[0].excerpt.length).toBe(KNOWLEDGE_EXCERPT_CHARS);
    expect(body.hits[0].truncated).toBe(true);
  });

  it('rifiuta una domanda vuota invece di cercare il nulla', async () => {
    signedIn();

    const { res, body } = await call({ query: '  ' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('query_required');
  });

  it('applica il tetto dichiarato anche se chi chiama ne chiede di più', async () => {
    signedIn();

    await call({ query: 'garanzia', limit: '500' });

    const [{ args }] = supabase.calls;
    expect(Number(args.p_limit)).toBeLessThanOrEqual(KNOWLEDGE_HITS_MAX * 3);
  });

  it('scarta una collezione che non esiste invece di passarla al database', async () => {
    signedIn();

    await call({ query: 'garanzia', collection: 'inventata' });

    expect(supabase.calls[0].args.p_collection).toBeNull();
  });

  it('le collezioni dichiarate nel contratto sono quelle che il corpus conosce', () => {
    expect([...KNOWLEDGE_COLLECTIONS]).toEqual([...COLLECTIONS]);
  });
});
