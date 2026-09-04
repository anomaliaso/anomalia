import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));

const tables = vi.hoisted(() => ({
  current: {} as Record<string, Record<string, unknown>[]>,
  inserted: [] as Record<string, unknown>[],
  deleted: [] as string[],
  patched: [] as Record<string, unknown>[],
  insertFails: null as string | null,
  deleteFails: null as string | null
}));

vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const rows = tables.current[table] ?? [];
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        order: async () => ({ data: rows }),
        eq: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null }),
        single: async () => ({
          data: tables.insertFails ? null : { id: 'new-1' },
          error: tables.insertFails ? { message: tables.insertFails } : null
        }),
        insert: (row: Record<string, unknown>) => {
          tables.inserted.push({ table, ...row });
          return q;
        },
        delete: () => {
          const d: Record<string, unknown> = {};
          Object.assign(d, {
            eq: (col: string, val: string) => {
              if (col === 'id') tables.deleted.push(val);
              return d;
            },
            then: (r: (v: unknown) => unknown) =>
              r({ error: tables.deleteFails ? { message: tables.deleteFails } : null })
          });
          return d;
        },
        then: (r: (v: unknown) => unknown) => r({ data: rows })
      });
      return q;
    }
  })
}));

vi.mock('$lib/server/blog-settings', async (original) => {
  const actual = await original<typeof import('$lib/server/blog-settings')>();
  return {
    ...actual,
    patchBlogConfig: async (_id: string, patch: Record<string, unknown>) => {
      tables.patched.push(patch);
      return { error: null };
    }
  };
});

import { GET, PUT } from './+server';
import { POST as ADD } from './terms/+server';
import { POST as REMOVE } from './terms/remove/+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

const BRAND = { id: 'brand-1', slug: 'demo', plan: 'pro' };

const base = 'https://example.test/api/v1/brands/demo/settings/blog';
const call = (h: unknown, path: string, method: string, body?: unknown) =>
  (h as (e: unknown) => Promise<Response>)({
    request: new Request(`${base}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }),
    params: { slug: 'demo' }
  });

const read = () => call(GET, '', 'GET');
const write = (b: unknown) => call(PUT, '', 'PUT', b);
const add = (b: unknown) => call(ADD, '/terms', 'POST', b);
const remove = (b: unknown) => call(REMOVE, '/terms/remove', 'POST', b);

beforeEach(() => {
  vi.clearAllMocks();
  tables.current = { brands: [{ blog_config: {} }] };
  tables.inserted = [];
  tables.deleted = [];
  tables.patched = [];
  tables.insertFails = null;
  tables.deleteFails = null;
  vi.mocked(authenticate).mockResolvedValue({ supabase: {}, apiKey: null, error: null } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: BRAND, error: null } as never);
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(null as never);
});

describe('GET /settings/blog', () => {
  it('porta i limiti del piano e le scelte ammesse, non solo la configurazione', async () => {
    const body = await (await read()).json();

    expect(body.limits.articles_per_week_max).toBeGreaterThan(0);
    expect(body.choices.fonts).toContain('serif');
    expect(body.choices.layouts).toEqual(['navbar', 'sidebar']);
    expect(body.choices.locales).toContain('it');
  });

  it('senza una cadenza scelta risponde null, non il default del piano spacciato per scelta', async () => {
    const body = await (await read()).json();

    expect(body.config.articles_per_week).toBeNull();
  });

  it('senza una lingua scelta non ne inventa una', async () => {
    const body = await (await read()).json();

    expect(body.config.default_locale).toBeNull();
  });
});

describe('PUT /settings/blog', () => {
  it('cambia solo i campi nominati', async () => {
    const res = await write({ title: 'Il blog del caffè' });

    expect(res.status).toBe(200);
    expect(tables.patched[0]).toEqual({ title: 'Il blog del caffè' });
  });

  it('una richiesta senza campi è 400 dichiarato', async () => {
    const res = await write({});

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_fields');
    expect(tables.patched).toEqual([]);
  });

  it('rifiuta un font che il sito non sa rendere, invece di ripiegare in silenzio', async () => {
    const res = await write({ font: 'comic-sans' });

    expect(res.status).toBe(400);
    expect(tables.patched).toEqual([]);
  });

  it('rifiuta una lingua che il blog non serve e dice quali erano ammesse', async () => {
    // Scartarla lascerebbe l'agente convinto di aver acceso una traduzione che non esiste.
    const res = await write({ locales: ['it', 'klingon'] });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unknown_locale');
    expect(body.unknown).toEqual(['klingon']);
    expect(tables.patched).toEqual([]);
  });

  it('riduce la cadenza al tetto del piano e riporta ciò che ha salvato', async () => {
    const body = await (await write({ articles_per_week: 999 })).json();

    const saved = tables.patched[0].articlesPerWeek as number;
    expect(saved).toBeLessThan(999);
    expect(body.config.articles_per_week).toBe(saved);
  });

  it('si ferma prima di scrivere se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(new Response('read only', { status: 403 }) as never);

    const res = await write({ title: 'x' });

    expect(res.status).toBe(403);
    expect(tables.patched).toEqual([]);
  });
});

describe('POST /settings/blog/terms', () => {
  it('deriva lo slug dal nome, accenti compresi', async () => {
    const body = await (await add({ term: 'category', name: 'Caffè Speciale' })).json();

    expect(body.slug).toBe('caffe-speciale');
    expect(tables.inserted[0]).toMatchObject({ table: 'blog_categories', slug: 'caffe-speciale' });
  });

  it('un nome che si riduce a niente non diventa una riga senza slug', async () => {
    const res = await add({ term: 'tag', name: '???' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('empty_slug');
    expect(tables.inserted).toEqual([]);
  });

  it('uno slug già preso è 409, non una seconda riga', async () => {
    tables.current.blog_tags = [{ id: 't1' }];

    const res = await add({ term: 'tag', name: 'Espresso' });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('slug_taken');
    expect(tables.inserted).toEqual([]);
  });

  it('rifiuta un campo che quella lista non ha, invece di scartarlo', async () => {
    const res = await add({ term: 'tag', name: 'Espresso', bio: 'una biografia' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('field_not_for_term');
    expect(body.accepts).toEqual([]);
    expect(tables.inserted).toEqual([]);
  });

  it('un autore prende bio e ruolo, una categoria la descrizione', async () => {
    await add({ term: 'author', name: 'Ada', bio: 'Scrive di caffè', role: 'editor' });
    expect(tables.inserted[0]).toMatchObject({
      table: 'blog_authors',
      bio: 'Scrive di caffè',
      role: 'editor'
    });

    tables.inserted = [];
    await add({ term: 'category', name: 'Guide', description: 'Come si fa' });
    expect(tables.inserted[0]).toMatchObject({ table: 'blog_categories', description: 'Come si fa' });
  });

  it('non scrive un avatar: è un file, e da qui non passa', async () => {
    const res = await add({ term: 'author', name: 'Ada', avatar_url: 'https://x.test/a.png' });

    expect(res.status).toBe(400);
    expect(tables.inserted).toEqual([]);
  });
});

describe('POST /settings/blog/terms/remove', () => {
  it('conta gli articoli toccati PRIMA di cancellare', async () => {
    tables.current.blog_categories = [{ id: 'c1' }];
    tables.current.brand_articles = [{ id: 'a1' }, { id: 'a2' }];

    const body = await (await remove({ term: 'category', id: 'c1' })).json();

    expect(body.articles_affected).toBe(2);
    expect(tables.deleted).toContain('c1');
  });

  it('una voce che non è del brand è 404, non una cancellazione altrui', async () => {
    tables.current.blog_categories = [];

    const res = await remove({ term: 'category', id: 'c1' });

    expect(res.status).toBe(404);
    expect(tables.deleted).toEqual([]);
  });

  it('un tag si conta sulla tabella di mezzo, non sugli articoli', async () => {
    tables.current.blog_tags = [{ id: 't1' }];
    tables.current.brand_article_tags = [{ id: 'x1' }];

    const body = await (await remove({ term: 'tag', id: 't1' })).json();

    expect(body.articles_affected).toBe(1);
  });

  it('si ferma prima di cancellare se la chiave è di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(new Response('read only', { status: 403 }) as never);

    const res = await remove({ term: 'category', id: 'c1' });

    expect(res.status).toBe(403);
    expect(tables.deleted).toEqual([]);
  });
});
