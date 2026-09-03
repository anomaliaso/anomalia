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

import { GET } from './+server';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;

function fakeSupabase(tables: Record<string, Row[]> = {}) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] === value);
          return q;
        },
        in: () => q,
        gte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null })
      };
      return q;
    }
  };
}

function call(query: Record<string, string>, slug = 'demo') {
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/creation-kit`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return (GET as (event: unknown) => Promise<Response>)({
    request: new Request(url),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json() }));
}

function signedIn(tables: Record<string, Row[]> = {}) {
  vi.mocked(authenticate).mockResolvedValue({
    supabase: fakeSupabase(tables),
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug: 'demo', name: 'Demo Brand', timezone: 'Europe/Rome', content_prefs: {} },
    error: null
  } as never);
}

const JOB = { goal: 'launch the espresso grinder', platforms: 'linkedin', format: 'text_post' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /creation-kit', () => {
  it('restituisce un kit selezionato per il lavoro richiesto', async () => {
    signedIn();

    const { res, body } = await call(JOB);

    expect(res.status).toBe(200);
    expect(body.job).toEqual({ goal: JOB.goal, platforms: ['linkedin'], format: 'text_post' });
    expect(body.constraints.platforms[0].platform).toBe('linkedin');
    expect(body.template.id).toBeTruthy();
    expect(body.versions.kit).toBeGreaterThan(0);
    expect(body.size_bytes).toBeLessThanOrEqual(body.budget_bytes);
  });

  it('non chiama nessun modello e non addebita nessun credito', async () => {
    signedIn();

    const { res } = await call(JOB);

    expect(res.status).toBe(200);
    expect(structured).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
  });

  it('accetta più piattaforme separate da virgola e le normalizza', async () => {
    signedIn();

    const { body } = await call({ ...JOB, platforms: 'LinkedIn, x , linkedin' });

    expect(body.constraints.platforms.map((p: Row) => p.platform)).toEqual(['linkedin', 'x']);
  });

  it('rifiuta un input fuori contratto invece di indovinare', async () => {
    signedIn();

    const missing = await call({ goal: 'x', platforms: 'linkedin' });
    const unknownField = await call({ ...JOB, tone: 'ironico' });
    const badFormat = await call({ ...JOB, format: 'poster' });

    expect(missing.res.status).toBe(400);
    expect(missing.body.error).toBe('invalid_input');
    expect(unknownField.res.status).toBe(400);
    expect(badFormat.res.status).toBe(400);
  });

  it('una lista di piattaforme fatta di sole virgole non passa per vuota', async () => {
    signedIn();

    const { res, body } = await call({ ...JOB, platforms: ' , , ' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('no_platforms');
  });

  it('senza autenticazione non tocca il brand', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    } as never);

    const { res } = await call(JOB);

    expect(res.status).toBe(401);
    expect(loadBrandForUser).not.toHaveBeenCalled();
  });

  it('un brand non accessibile passa dall’errore di loadBrandForUser', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      supabase: fakeSupabase(),
      user: { id: 'user-1' },
      apiKey: undefined,
      error: null
    } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);

    const { res } = await call(JOB, 'altrui');

    expect(res.status).toBe(404);
  });
});
