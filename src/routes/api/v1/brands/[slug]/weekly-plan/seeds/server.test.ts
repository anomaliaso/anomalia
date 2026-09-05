import { describe, it, expect, vi, beforeEach } from 'vitest';

const structured = vi.fn();
const gateCredits = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null),
  gateAiAction: vi.fn()
}));
vi.mock('$lib/server/research', () => ({
  structured: (...args: unknown[]) => structured(...args),
  benchmarkDigest: vi.fn()
}));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError: class extends Error {}
}));
vi.mock('$lib/server/app-url', () => ({ appOrigin: () => 'https://anomalia.test' }));

import { POST } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';

type Row = Record<string, unknown>;
type Op = { table: string; kind: 'insert' | 'update'; payload: Row; filters: Record<string, unknown> };
type World = { activePlanId: string | null; draftId: string | null; writeFails: boolean };

function fakeSupabase(world: World): { client: unknown; ops: Op[] } {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      const op: Op = { table, kind: 'insert', payload: {}, filters: {} };
      const rows = () => {
        if (table === 'editorial_plans') {
          return world.activePlanId ? [{ id: world.activePlanId }] : [];
        }
        return world.draftId ? [{ id: world.draftId }] : [];
      };
      const q = {
        insert(payload: Row) {
          op.kind = 'insert';
          op.payload = payload;
          ops.push(op);
          return q;
        },
        update(payload: Row) {
          op.kind = 'update';
          op.payload = payload;
          ops.push(op);
          return q;
        },
        select: () => q,
        eq(column: string, value: unknown) {
          op.filters[column] = value;
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () =>
          world.writeFails ? { data: null, error: { message: 'boom' } } : { data: { id: 'draft-new' }, error: null },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(
            op.kind === 'update' && world.writeFails
              ? { data: null, error: { message: 'boom' } }
              : { data: rows(), error: null }
          ).then(resolve)
      };
      return q;
    }
  };
  return { client, ops };
}

const validSeeds = () => ({
  week_index: 1,
  theme: 'Il banco di lavoro',
  rationale: 'La gente compra da chi vede lavorare',
  do_dont: 'Niente superlativi',
  seeds: [
    {
      platform: 'Instagram',
      angle: 'Il primo switch che monti storto',
      format: 'carousel',
      slide_count: 4,
      day: 'Tue',
      time: '09:00',
      pillar: 'dietro le quinte'
    }
  ]
});

function call(body: unknown, world: Partial<World> = {}, slug = 'demo') {
  const full: World = { activePlanId: 'plan-1', draftId: null, writeFails: false, ...world };
  const { client, ops } = fakeSupabase(full);
  vi.mocked(authenticate).mockResolvedValue({
    supabase: client,
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', slug, timezone: 'Europe/Rome', plan: 'pro' },
    error: null
  } as never);
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/weekly-plan/seeds`);
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
    params: { slug },
    url
  }).then(async (res) => ({ res, body: await res.json(), ops }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkApiKeyWriteAccess).mockReturnValue(undefined);
});

describe('POST /api/v1/brands/:slug/weekly-plan/seeds', () => {
  it('deposita le righe come bozza della settimana, attaccate al piano attivo', async () => {
    const { res, body, ops } = await call(validSeeds());

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      draft_id: 'draft-new',
      week_index: 1,
      seeds_saved: 1,
      editorial_plan_id: 'plan-1',
      replaced: false,
      review_url: 'https://anomalia.test/app/demo/plan'
    });
    const inserted = ops.find((o) => o.kind === 'insert')!;
    expect(inserted.table).toBe('content_plans');
    expect(inserted.payload).toMatchObject({
      brand_id: 'brand-1',
      status: 'draft',
      source: 'manual',
      editorial_plan_id: 'plan-1',
      editorial_week: 1
    });
  });

  it('salva la forma che la lettura settimanale sa già leggere', async () => {
    const { ops } = await call(validSeeds());
    const stored = ops.find((o) => o.kind === 'insert')!.payload.seeds as Record<string, unknown>;

    expect(stored.theme).toBe('Il banco di lavoro');
    expect(stored.rationale).toBe('La gente compra da chi vede lavorare');
    expect(stored.doDont).toBe('Niente superlativi');
    const seeds = stored.seeds as Record<string, unknown>[];
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      platform: 'instagram',
      platforms: ['instagram'],
      format: 'carousel',
      slide_count: 4,
      angle: 'Il primo switch che monti storto',
      day: 'Tue',
      time: '09:00'
    });
    expect(typeof seeds[0].id).toBe('string');
  });

  it('senza piano attivo le righe stanno in piedi da sole', async () => {
    const { body, ops } = await call(validSeeds(), { activePlanId: null });

    expect(body.editorial_plan_id).toBeNull();
    expect(ops.find((o) => o.kind === 'insert')!.payload).toMatchObject({
      editorial_plan_id: null,
      editorial_week: 1
    });
  });

  it('sostituisce la bozza in revisione invece di nasconderla dietro una seconda', async () => {
    const { body, ops } = await call(validSeeds(), { draftId: 'draft-esistente' });

    expect(body.replaced).toBe(true);
    expect(body.draft_id).toBe('draft-esistente');
    expect(ops.some((o) => o.kind === 'insert')).toBe(false);
    const updated = ops.find((o) => o.kind === 'update')!;
    expect(updated.table).toBe('content_plans');
    expect(updated.filters).toMatchObject({ id: 'draft-esistente', brand_id: 'brand-1' });
    expect(updated.payload).toMatchObject({ editorial_week: 1, editorial_plan_id: 'plan-1' });
  });

  it('non chiama il modello e non tocca i crediti', async () => {
    await call(validSeeds());

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('una scrittura fallita è un errore, non un falso successo', async () => {
    const { res, body } = await call(validSeeds(), { writeFails: true });

    expect(res.status).toBe(500);
    expect(body.error).toBe('save_failed');
  });

  it.each([
    ['una settimana fuori dal ciclo', { week_index: 4 }, 'week_index'],
    ['senza tema', { theme: '' }, 'theme'],
    ['senza righe', { seeds: [] }, 'seeds']
  ])('rifiuta %s nominando il campo, prima di scrivere', async (_label, patch, field) => {
    const { res, body, ops } = await call({ ...validSeeds(), ...patch });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(body.details[0].path[0]).toBe(field);
    expect(ops).toEqual([]);
  });

  it('nomina la riga senza piattaforma invece di scartarla in silenzio', async () => {
    const { res, body, ops } = await call({
      ...validSeeds(),
      seeds: [{ platform: '', angle: 'un angolo' }]
    });

    expect(res.status).toBe(400);
    expect(body.details[0].path).toEqual(['seeds', 0, 'platform']);
    expect(ops).toEqual([]);
  });

  it('rifiuta un campo che il contratto non dichiara', async () => {
    const { res, body, ops } = await call({ ...validSeeds(), campo_inventato: 'x' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(ops).toEqual([]);
  });

  it('rifiuta una richiesta senza autenticazione', async () => {
    vi.mocked(authenticate).mockResolvedValue({ error: new Response('Unauthorized', { status: 401 }) } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/weekly-plan/seeds');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(401);
  });

  it('rifiuta un brand a cui il chiamante non accede', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      supabase: fakeSupabase({ activePlanId: null, draftId: null, writeFails: false }).client,
      user: { id: 'user-1' },
      apiKey: undefined,
      error: null
    } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/altrui/weekly-plan/seeds');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'altrui' },
      url
    });

    expect(res.status).toBe(404);
  });

  it('rifiuta una API key di sola lettura', async () => {
    vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
      new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
    );
    const { res, ops } = await call(validSeeds());

    expect(res.status).toBe(403);
    expect(ops).toEqual([]);
  });
});
