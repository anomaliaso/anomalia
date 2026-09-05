import { describe, it, expect, vi, beforeEach } from 'vitest';

const structured = vi.fn();
const gateCredits = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => undefined),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/cli-queries', () => ({ getCalendar: vi.fn() }));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError: class extends Error {}
}));
vi.mock('$lib/server/app-url', () => ({ appOrigin: () => 'https://anomalia.test' }));

import { GET, POST } from './+server';
import { POST as REVOKE } from './revoke/+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';
import { getCalendar } from '$lib/server/cli-queries';
import { hashShareToken } from '$lib/server/shared-views';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

const BRAND = { id: 'brand-1', slug: 'demo', name: 'Demo Brand', timezone: 'Europe/Rome', content_prefs: null };
const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.shared_views' in the schema cache" };

type Op = { table: string; method: string; args: unknown[] };

function fakeSupabase(results: Record<string, Result>) {
  const ops: Op[] = [];
  const client = {
    ops,
    from(table: string) {
      const q: Row = {};
      for (const method of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'lt', 'gt', 'is', 'or', 'order', 'limit', 'insert', 'update', 'delete', 'upsert']) {
        q[method] = (...args: unknown[]) => {
          ops.push({ table, method, args });
          return q;
        };
      }
      const settle = async () => results[table] ?? { data: null, error: null };
      q.single = settle;
      q.maybeSingle = settle;
      q.then = (onOk: (v: Result) => unknown, onErr?: (e: unknown) => unknown) => settle().then(onOk, onErr);
      return q;
    }
  };
  return client;
}

const WRITES = new Set(['insert', 'update', 'delete', 'upsert']);

function callWith(
  handler: (event: unknown) => Promise<Response>,
  opts: { method: 'GET' | 'POST'; path: string; body?: unknown; slug?: string; results?: Record<string, Result> }
) {
  const slug = opts.slug ?? 'demo';
  const client = fakeSupabase(opts.results ?? {});
  vi.mocked(authenticate).mockResolvedValue({
    supabase: client,
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { ...BRAND, slug }, error: null } as never);

  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}${opts.path}`);
  const request =
    opts.method === 'POST'
      ? new Request(url, { method: 'POST', body: JSON.stringify(opts.body ?? {}) })
      : new Request(url);

  return handler({ request, params: { slug }, url }).then(async (res) => ({
    res,
    body: await res.json(),
    ops: client.ops
  }));
}

const create = (body: unknown, results?: Record<string, Result>) =>
  callWith(POST as never, { method: 'POST', path: '/shares', body, results });

const list = (results?: Record<string, Result>) => callWith(GET as never, { method: 'GET', path: '/shares', results });

const revoke = (body: unknown, results?: Record<string, Result>) =>
  callWith(REVOKE as never, { method: 'POST', path: '/shares/revoke', body, results });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(undefined);
  vi.mocked(getCalendar).mockResolvedValue({
    posts: [
      {
        id: 'post-1',
        platform: 'linkedin',
        caption: 'copy visibile al cliente',
        media_url: null,
        scheduled_for: '2026-09-10T07:00:00.000Z',
        slot: null,
        status: 'approved',
        image_prompt: 'prompt interno'
      }
    ],
    year: 2026,
    month: 9,
    monthLabel: 'settembre 2026',
    prevYM: '2026-08',
    nextYM: '2026-10',
    timezone: 'Europe/Rome'
  } as never);
});

describe('POST /api/v1/brands/:slug/shares', () => {
  const ok = { shared_views: { data: { id: 'share-1' }, error: null } };

  it('consegna il link una volta e conserva solo l impronta del token', async () => {
    const { res, body, ops } = await create({ view: 'calendar', month: '2026-09' }, ok);

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.url).toBe(`https://anomalia.test/share/${body.token}`);

    const inserted = ops.find((o) => o.method === 'insert')?.args[0] as Row;
    expect(inserted.token_hash).toBe(hashShareToken(body.token));
    expect(JSON.stringify(inserted)).not.toContain(body.token);
  });

  it('congela lo snapshot: dentro la riga ci sono i campi dichiarati, non il post', async () => {
    const { ops } = await create({ view: 'calendar', month: '2026-09' }, ok);
    const inserted = ops.find((o) => o.method === 'insert')?.args[0] as Row;
    const snapshot = JSON.stringify(inserted.snapshot);

    expect(snapshot).not.toContain('prompt interno');
    expect(snapshot).not.toContain('post-1');
    expect(snapshot).toContain('copy visibile al cliente');
  });

  it('non chiama il modello e non tocca i crediti', async () => {
    await create({ view: 'calendar' }, ok);

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('senza mese usa quello corrente invece di rifiutare', async () => {
    const { res, body } = await create({ view: 'calendar' }, ok);

    expect(res.status).toBe(200);
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it.each([
    ['una vista che non esiste', { view: 'proposal' }],
    ['un campo non dichiarato', { view: 'calendar', segreto: 'x' }],
    ['un mese malformato', { view: 'calendar', month: 'settembre' }],
    ['niente', {}]
  ])('rifiuta %s prima di scrivere', async (_label, body) => {
    const { res, body: out, ops } = await create(body, ok);

    expect(res.status).toBe(400);
    expect(out.error).toBe('invalid_input');
    expect(ops.filter((o) => WRITES.has(o.method))).toEqual([]);
  });

  it('dice che la migration manca invece di un errore Postgres', async () => {
    const { res, body } = await create({ view: 'calendar' }, {
      shared_views: { data: null, error: MISSING_TABLE }
    });

    expect(res.status).toBe(500);
    expect(body.error).toBe('shares_not_migrated');
    expect(body.details).toContain('20260904120000_shared_views.sql');
  });

  it('rifiuta una richiesta senza autenticazione', async () => {
    vi.mocked(authenticate).mockResolvedValue({ error: new Response('Unauthorized', { status: 401 }) } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/shares');
    const res = await (POST as (e: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(401);
  });

  it('rifiuta un brand a cui il chiamante non accede', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      supabase: fakeSupabase({}),
      user: { id: 'user-1' },
      apiKey: undefined,
      error: null
    } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/altrui/shares');
    const res = await (POST as (e: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: JSON.stringify({ view: 'calendar' }) }),
      params: { slug: 'altrui' },
      url
    });

    expect(res.status).toBe(404);
  });

  it('rifiuta una API key di sola lettura senza creare niente', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
    );
    const { res, ops } = await create({ view: 'calendar' }, ok);

    expect(res.status).toBe(403);
    expect(ops.filter((o) => WRITES.has(o.method))).toEqual([]);
  });
});

describe('GET /api/v1/brands/:slug/shares', () => {
  it('elenca le share del brand chiesto e non mostra mai un token', async () => {
    const { res, body, ops } = await list({
      shared_views: {
        data: [
          {
            id: 'share-1',
            view_type: 'calendar',
            snapshot: { month: '2026-09' },
            created_at: '2026-09-01T00:00:00.000Z',
            expires_at: null,
            revoked_at: null
          }
        ],
        error: null
      }
    });

    expect(res.status).toBe(200);
    expect(body.shares[0]).toEqual({
      id: 'share-1',
      view: 'calendar',
      month: '2026-09',
      status: 'live',
      created_at: '2026-09-01T00:00:00.000Z',
      expires_at: null,
      revoked_at: null
    });
    expect(JSON.stringify(body)).not.toContain('token');
    expect(ops).toContainEqual({ table: 'shared_views', method: 'eq', args: ['brand_id', 'brand-1'] });
  });

  it('non legge nessuna share di un altro brand: il filtro è sempre lo stesso', async () => {
    const { ops } = await list({ shared_views: { data: [], error: null } });

    expect(ops.filter((o) => o.method === 'eq')).toEqual([
      { table: 'shared_views', method: 'eq', args: ['brand_id', 'brand-1'] }
    ]);
  });
});

describe('POST /api/v1/brands/:slug/shares/revoke', () => {
  it('spegne il link e non tocca l appartenenza al brand', async () => {
    const { res, body, ops } = await revoke(
      { id: 'share-1' },
      { shared_views: { data: { id: 'share-1', revoked_at: '2026-09-04T00:00:00.000Z' }, error: null } }
    );

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, id: 'share-1', revoked_at: '2026-09-04T00:00:00.000Z' });
    expect(ops.filter((o) => WRITES.has(o.method)).map((o) => o.table)).toEqual(['shared_views']);
    expect(ops.some((o) => o.table === 'brand_members' || o.table === 'brands')).toBe(false);
  });

  it('una share che non è di questo brand non risulta', async () => {
    const { res, body } = await revoke({ id: 'share-di-un-altro' }, { shared_views: { data: null, error: null } });

    expect(res.status).toBe(404);
    expect(body.error).toBe('share_not_found');
  });

  it('rifiuta un corpo che il contratto non dichiara', async () => {
    const { res, body, ops } = await revoke({ id: 'share-1', anche: 'questo' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(ops.filter((o) => WRITES.has(o.method))).toEqual([]);
  });
});
