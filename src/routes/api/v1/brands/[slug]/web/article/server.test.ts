import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET_ARTICLE } from '@anomalia/api-contracts';

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
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => adminDouble }));

import { GET, POST } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

const BRAND = { id: 'brand-1', slug: 'demo', timezone: 'Europe/Rome' };

const DRAFT: Row = {
  id: 'art-1',
  brand_id: BRAND.id,
  slug: 'guida-al-campeggio',
  title: 'Guida al campeggio',
  meta_title: 'Guida al campeggio | Demo',
  meta_description: 'Come si monta una tenda senza litigare.',
  body_md: '# Guida\n\nUn corpo che nessuno deve riscrivere.',
  status: 'draft',
  language: 'Italian',
  cover_image: 'https://cdn.test/cover.png',
  scheduled_for: null,
  published_at: null,
  translation_of: null,
  source: 'ai',
  version_seq: 3,
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-02T10:00:00.000Z',
  category: { id: 'cat-1', name: 'Outdoor', slug: 'outdoor' },
  author: { id: 'aut-1', name: 'Giulia', slug: 'giulia' },
  tags: [{ blog_tags: { id: 'tag-1', name: 'Tende', slug: 'tende' } }]
};

type World = {
  article: Row | null;
  categories: string[];
  authors: string[];
  tags: string[];
};

let world: World;
let updates: Row[] = [];
let tagInserts: string[][] = [];
let tagDeletes = 0;
let adminDouble: unknown;

function fakeSupabase() {
  const owned: Record<string, string[]> = {
    blog_categories: world.categories,
    blog_authors: world.authors,
    blog_tags: world.tags
  };

  const applied = () => Object.assign({}, ...updates) as Row;

  return {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let asked: string[] = [];
      const self: Record<string, unknown> = {};

      const listOwned = async () => ({
        data: asked.filter((id) => (owned[table] ?? []).includes(id)).map((id) => ({ id })),
        error: null
      });

      self.select = () => self;
      self.eq = (column: string, value: unknown) => {
        filters.push([column, value]);
        return self;
      };
      self.in = (_column: string, values: string[]) => {
        asked = values;
        return self;
      };
      self.maybeSingle = async () => {
        const row = world.article ? { ...world.article, ...applied() } : null;
        const matches =
          row && filters.every(([column, value]) => (column in row ? row[column] === value : true));
        return { data: matches ? row : null, error: null };
      };
      self.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => listOwned().then(ok, ko);
      self.update = (patch: Row) => {
        updates.push(patch);
        return self;
      };
      self.delete = () => {
        tagDeletes += 1;
        return self;
      };
      self.insert = async (rows: Row[]) => {
        tagInserts.push(rows.map((r) => String(r.tag_id)));
        return { error: null };
      };
      return self;
    }
  };
}

function authorize(slug = BRAND.slug) {
  const client = fakeSupabase();
  adminDouble = client;
  vi.mocked(authenticate).mockResolvedValue({
    supabase: client,
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { ...BRAND, slug }, error: null } as never);
}

function read(id: string, slug = BRAND.slug) {
  authorize(slug);
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/web/article?id=${id}`);
  return (GET as (event: unknown) => Promise<Response>)({
    request: new Request(url),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

function write(body: unknown, slug = BRAND.slug) {
  authorize(slug);
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/web/article`);
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(undefined);
  world = { article: { ...DRAFT }, categories: ['cat-1', 'cat-2'], authors: ['aut-1'], tags: ['tag-1', 'tag-2'] };
  updates = [];
  tagInserts = [];
  tagDeletes = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-08T15:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/v1/brands/:slug/web/article', () => {
  it.each(['draft', 'planned', 'approved', 'published'])(
    'restituisce il record completo di un articolo %s, non solo il sommario',
    async (status) => {
      world.article = { ...DRAFT, status };

      const { res, body } = await read('art-1');

      expect(res.status).toBe(200);
      expect(GET_ARTICLE.output.safeParse(body).success).toBe(true);
      expect(body.article).toMatchObject({
        id: 'art-1',
        status,
        title: DRAFT.title,
        body_md: DRAFT.body_md,
        meta_title: DRAFT.meta_title,
        meta_description: DRAFT.meta_description,
        cover_image: DRAFT.cover_image,
        language: 'Italian',
        category: { id: 'cat-1', name: 'Outdoor', slug: 'outdoor' },
        author: { id: 'aut-1', name: 'Giulia', slug: 'giulia' },
        tags: [{ id: 'tag-1', name: 'Tende', slug: 'tende' }]
      });
    }
  );

  it('un articolo di un altro brand non si legge', async () => {
    world.article = { ...DRAFT, brand_id: 'brand-di-un-altro' };

    const { res, body } = await read('art-1');

    expect(res.status).toBe(404);
    expect(body.error).toBe('article_not_found');
  });

  it('porta la data sull orologio del brand, non su quello del server', async () => {
    world.article = { ...DRAFT, status: 'approved', scheduled_for: '2026-08-09T16:00:00.000Z' };

    const { body } = await read('art-1');

    expect(body.article.scheduled_for).toBe('2026-08-09T16:00:00.000Z');
    expect(body.article.scheduled_for_local).toBe('2026-08-09 18:00 (Europe/Rome)');
  });

  it('rifiuta una richiesta senza autenticazione', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      error: new Response('Unauthorized', { status: 401 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/web/article?id=art-1');
    const res = await (GET as (event: unknown) => Promise<Response>)({
      request: new Request(url),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(401);
  });

  it('rifiuta un brand a cui il chiamante non accede', async () => {
    authorize();
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/altrui/web/article?id=art-1');
    const res = await (GET as (event: unknown) => Promise<Response>)({
      request: new Request(url),
      params: { slug: 'altrui' },
      url
    });

    expect(res.status).toBe(404);
  });

  it('rifiuta una richiesta senza id invece di restituire un articolo a caso', async () => {
    authorize();
    const url = new URL('https://anomalia.test/api/v1/brands/demo/web/article');
    const res = await (GET as (event: unknown) => Promise<Response>)({
      request: new Request(url),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/brands/:slug/web/article', () => {
  it('cambiare il titolo non tocca nessun altro campo', async () => {
    const { res, body } = await write({ id: 'art-1', title: 'Guida al campeggio, rivista' });

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]).sort()).toEqual(['title', 'updated_at']);
    expect(body.updated_fields).toEqual(['title']);
    expect(body.article).toMatchObject({
      title: 'Guida al campeggio, rivista',
      body_md: DRAFT.body_md,
      meta_title: DRAFT.meta_title,
      meta_description: DRAFT.meta_description,
      cover_image: DRAFT.cover_image,
      status: 'draft'
    });
  });

  it('il corpo arriva così come è stato scritto: nessuno lo riformatta', async () => {
    const body_md = '# Titolo\n\n<script>alert(1)</script>\n\nTesto **grassetto**.';

    const { body } = await write({ id: 'art-1', body_md });

    expect(updates[0].body_md).toBe(body_md);
    expect(body.article.body_md).toBe(body_md);
  });

  it('non chiama nessun modello e non tocca i crediti', async () => {
    await write({ id: 'art-1', title: 'x', body_md: 'y', meta_description: 'z' });

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('un articolo già pubblicato non si modifica di nascosto', async () => {
    world.article = { ...DRAFT, status: 'published', published_at: '2026-08-01T10:00:00.000Z' };

    const { res, body } = await write({ id: 'art-1', title: 'Titolo nuovo' });

    expect(res.status).toBe(409);
    expect(body.error).toBe('article_published');
    expect(updates).toEqual([]);
  });

  it('un articolo di un altro brand non si scrive', async () => {
    world.article = { ...DRAFT, brand_id: 'brand-di-un-altro' };

    const { res, body } = await write({ id: 'art-1', title: 'Titolo nuovo' });

    expect(res.status).toBe(404);
    expect(body.error).toBe('article_not_found');
    expect(updates).toEqual([]);
  });

  it('una categoria di un altro brand è rifiutata nominando il campo', async () => {
    const { res, body } = await write({ id: 'art-1', category_id: 'cat-di-un-altro-brand' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('category_not_found');
    expect(updates).toEqual([]);
  });

  it('un autore di un altro brand è rifiutato nominando il campo', async () => {
    const { res, body } = await write({ id: 'art-1', author_id: 'aut-di-un-altro-brand' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('author_not_found');
    expect(updates).toEqual([]);
  });

  it('un tag di un altro brand ferma tutta la scrittura', async () => {
    const { res, body } = await write({ id: 'art-1', tag_ids: ['tag-1', 'tag-di-un-altro-brand'] });

    expect(res.status).toBe(400);
    expect(body.error).toBe('tags_not_found');
    expect(updates).toEqual([]);
    expect(tagDeletes).toBe(0);
  });

  it('i tag passati sostituiscono quelli attuali, non si sommano', async () => {
    const { res } = await write({ id: 'art-1', tag_ids: ['tag-2'] });

    expect(res.status).toBe(200);
    expect(tagDeletes).toBe(1);
    expect(tagInserts).toEqual([['tag-2']]);
  });

  it('una lista vuota toglie ogni tag senza reinserirne', async () => {
    const { res } = await write({ id: 'art-1', tag_ids: [] });

    expect(res.status).toBe(200);
    expect(tagDeletes).toBe(1);
    expect(tagInserts).toEqual([]);
  });

  it('datare un draft lo porta ad approved, e lo dice', async () => {
    const { res, body } = await write({ id: 'art-1', scheduled_for: '2026-08-09T18:00' });

    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({
      scheduled_for: '2026-08-09T16:00:00.000Z',
      status: 'approved'
    });
    expect(body.updated_fields).toContain('status');
  });

  it('rifiuta una data che non è una data, senza scrivere niente', async () => {
    const { res, body } = await write({ id: 'art-1', scheduled_for: 'domani alle 18' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_scheduled_for');
    expect(updates).toEqual([]);
  });

  it('un segnaposto planned non resta senza slot', async () => {
    world.article = { ...DRAFT, status: 'planned', scheduled_for: '2026-09-01T08:00:00.000Z' };

    const { res, body } = await write({ id: 'art-1', scheduled_for: null });

    expect(res.status).toBe(409);
    expect(body.error).toBe('planned_needs_slot');
    expect(updates).toEqual([]);
  });

  it('la lingua di una traduzione non si sposta da qui', async () => {
    world.article = { ...DRAFT, translation_of: 'art-originale' };

    const { res, body } = await write({ id: 'art-1', language: 'es' });

    expect(res.status).toBe(409);
    expect(body.error).toBe('translation_locked');
    expect(updates).toEqual([]);
  });

  it('la lingua è scritta col nome che il blog legge', async () => {
    const { res } = await write({ id: 'art-1', language: 'es' });

    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ language: 'Spanish' });
  });

  it('rifiuta una lingua che il blog non pubblica', async () => {
    const { res, body } = await write({ id: 'art-1', language: 'xx' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_language');
    expect(updates).toEqual([]);
  });

  it('una richiesta senza nessun campo da cambiare non passa per il database', async () => {
    const { res, body } = await write({ id: 'art-1' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('no_changes');
    expect(updates).toEqual([]);
  });

  it('rifiuta un campo che il contratto non dichiara, invece di scartarlo in silenzio', async () => {
    const { res, body } = await write({ id: 'art-1', campo_che_non_esiste: 'x' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(updates).toEqual([]);
  });

  it('rifiuta una API key di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
    );

    const { res } = await write({ id: 'art-1', title: 'Titolo nuovo' });

    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it('rifiuta una richiesta senza autenticazione', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      error: new Response('Unauthorized', { status: 401 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/web/article');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(401);
  });

  it('rifiuta un brand a cui il chiamante non accede', async () => {
    authorize();
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/altrui/web/article');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'altrui' },
      url
    });

    expect(res.status).toBe(404);
  });
});
