import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

import { GET, PUT } from './+server';
import { POST as ADD } from './sources/+server';
import { POST as REMOVE } from './sources/remove/+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

function fakeSupabase(sources: Row[] = [], failures: { insert?: string; delete?: string; update?: string } = {}) {
  const inserted: Row[] = [];
  const deleted: string[] = [];
  const updated: Row[] = [];
  const client = {
    from(table: string) {
      if (table === 'brand_news_sources') {
        const q: Record<string, unknown> = {};
        Object.assign(q, {
          select: () => q,
          order: async () => ({ data: sources }),
          eq: (col: string, val: string) => {
            if (col === 'id') deleted.push(val);
            return q;
          },
          insert: async (row: Row) => {
            inserted.push(row);
            return { error: failures.insert ? { message: failures.insert } : null };
          },
          delete: () => ({
            eq: (_c: string, id: string) => ({
              eq: async () => {
                deleted.push(id);
                return { error: failures.delete ? { message: failures.delete } : null };
              }
            })
          }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: sources })
        });
        return q;
      }
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        update: (row: Row) => {
          updated.push(row);
          return b;
        },
        eq: async () => ({ error: failures.update ? { message: failures.update } : null })
      });
      return b;
    }
  };
  return { client, inserted, deleted, updated };
}

let supabase: ReturnType<typeof fakeSupabase>;

const BRAND = { id: 'brand-1', slug: 'demo', plan: 'pro', content_prefs: null as Row | null };
const brandWith = (patch: Partial<typeof BRAND>) => ({ ...BRAND, ...patch });

const base = 'https://example.test/api/v1/brands/demo/settings/radar';
const call = (h: unknown, path: string, method: string, body?: unknown) =>
  (h as (e: unknown) => Promise<Response>)({
    request: new Request(`${base}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }),
    params: { slug: 'demo' }
  });

const read = () => call(GET, '', 'GET');
const setPlatform = (b: unknown) => call(PUT, '', 'PUT', b);
const add = (b: unknown) => call(ADD, '/sources', 'POST', b);
const remove = (b: unknown) => call(REMOVE, '/sources/remove', 'POST', b);

beforeEach(() => {
  vi.clearAllMocks();
  supabase = fakeSupabase();
  vi.mocked(authenticate).mockResolvedValue({ supabase: supabase.client, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: BRAND, error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
});

function withSources(rows: Row[], brand: Partial<typeof BRAND> = {}) {
  supabase = fakeSupabase(rows);
  vi.mocked(authenticate).mockResolvedValue({ supabase: supabase.client, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: brandWith(brand), error: null } as never);
}

describe('GET /settings/radar', () => {
  it('dice cosa il piano permette, non solo cosa è configurato', async () => {
    withSources([], { plan: 'starter' });

    const body = await (await read()).json();

    expect(body.allowed_kinds).toEqual(['gnews_query', 'rss', 'subreddit', 'reddit_query']);
    const threads = body.platforms.find((p: Row) => p.platform === 'threads');
    expect(threads).toMatchObject({ plan_locked: true, enabled: false });
  });

  it('su Pro le piattaforme dei lead non sono bloccate', async () => {
    const body = await (await read()).json();

    expect(body.platforms.find((p: Row) => p.platform === 'threads').plan_locked).toBe(false);
  });

  it('conta le fonti usate contro il tetto del piano', async () => {
    withSources([{ id: 's1', kind: 'subreddit', value: 'coffee', lang: 'auto', active: true }]);

    const body = await (await read()).json();

    expect(body.sources_used).toBe(1);
    expect(body.source_limit).toBeGreaterThan(0);
  });
});

describe('PUT /settings/radar', () => {
  it('accende una piattaforma senza toccare le altre preferenze', async () => {
    withSources([], { content_prefs: { language: 'it', radar: { platforms: { gnews: false } } } });

    const res = await setPlatform({ platform: 'reddit', enabled: true });

    expect(res.status).toBe(200);
    expect(supabase.updated[0]).toEqual({
      content_prefs: { language: 'it', radar: { platforms: { gnews: false, reddit: true } } }
    });
  });

  it('su un piano inferiore le piattaforme dei lead sono un rifiuto dichiarato', async () => {
    withSources([], { plan: 'starter' });

    const res = await setPlatform({ platform: 'linkedin', enabled: true });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('plan_required');
    expect(supabase.updated).toEqual([]);
  });

  it('rifiuta una piattaforma che il Radar non batte', async () => {
    const res = await setPlatform({ platform: 'instagram', enabled: true });

    expect(res.status).toBe(400);
    expect(supabase.updated).toEqual([]);
  });
});

describe('POST /settings/radar/sources', () => {
  it('salva un subreddit senza il suo "r/"', async () => {
    const res = await add({ kind: 'subreddit', value: 'r/coffee' });

    expect(res.status).toBe(200);
    expect(supabase.inserted[0]).toMatchObject({ kind: 'subreddit', value: 'coffee', lang: 'auto' });
  });

  it('una fonte che c è già non è un errore e non viene duplicata', async () => {
    withSources([{ id: 's1', kind: 'subreddit', value: 'coffee' }]);

    const body = await (await add({ kind: 'subreddit', value: 'r/coffee' })).json();

    expect(body.added).toBe(false);
    expect(supabase.inserted).toEqual([]);
  });

  it('un feed RSS che non è una URL è colpa di chi chiama', async () => {
    const res = await add({ kind: 'rss', value: 'il mio blog' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_value');
    expect(supabase.inserted).toEqual([]);
  });

  it('un tipo che il piano non ha è 403 con il piano nella risposta', async () => {
    withSources([], { plan: 'starter' });

    const res = await add({ kind: 'x_community', value: 'coffee' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'plan_required', kind: 'x_community', plan: 'starter' });
    expect(supabase.inserted).toEqual([]);
  });

  it('oltre il tetto del piano si ferma, e dice quanto è il tetto', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, kind: 'rss', value: `https://x.test/${i}` }));
    withSources(many, { plan: 'go' });

    const res = await add({ kind: 'rss', value: 'https://new.test/f' });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('source_limit');
    expect(body.limit).toBeGreaterThan(0);
    expect(supabase.inserted).toEqual([]);
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(new Response('read only', { status: 403 }) as never);

    const res = await add({ kind: 'rss', value: 'https://x.test/f' });

    expect(res.status).toBe(403);
    expect(supabase.inserted).toEqual([]);
  });
});

describe('POST /settings/radar/sources/remove', () => {
  it('toglie la fonte nominata dalla stessa coppia che l ha aggiunta', async () => {
    withSources([{ id: 's1', kind: 'subreddit', value: 'coffee' }]);

    const res = await remove({ kind: 'subreddit', value: 'r/coffee' });

    expect(res.status).toBe(200);
    expect(supabase.deleted).toContain('s1');
  });

  it('una coppia che non c è è 404, non un successo che non ha tolto niente', async () => {
    withSources([{ id: 's1', kind: 'subreddit', value: 'coffee' }]);

    const res = await remove({ kind: 'subreddit', value: 'tea' });

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
    expect(supabase.deleted).toEqual([]);
  });

  it('non tocca la fonte di un altro tipo con lo stesso valore', async () => {
    withSources([
      { id: 's1', kind: 'subreddit', value: 'coffee' },
      { id: 's2', kind: 'gnews_query', value: 'coffee' }
    ]);

    await remove({ kind: 'gnews_query', value: 'coffee' });

    expect(supabase.deleted).toEqual(['s2']);
  });

  it('si ferma prima di cancellare se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(new Response('read only', { status: 403 }) as never);

    const res = await remove({ kind: 'subreddit', value: 'coffee' });

    expect(res.status).toBe(403);
    expect(supabase.deleted).toEqual([]);
  });
});
