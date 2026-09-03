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
import { PLAN_CADENCES, PLAN_CYCLE_WEEKS } from '@anomalia/api-contracts';
import { CADENCES } from '$lib/server/editorial-plan';
import { PLAN_WEEKS } from '$lib/plans';

type Row = Record<string, unknown>;
type Op = { table: string; kind: 'insert' | 'update'; payload: Row; filters: Record<string, unknown> };

const EDITORIAL_PLAN_SOURCES = ['onboarding', 'revision', 'rollover', 'manual', 'analytics_review', 'autopilot'];
const EDITORIAL_PLAN_STATUSES = ['proposed', 'active', 'superseded', 'rejected'];

function fakeSupabase(insertFails = false): { client: unknown; ops: Op[] } {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      const op: Op = { table, kind: 'insert', payload: {}, filters: {} };
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
        single: async () =>
          insertFails ? { data: null, error: { message: 'boom' } } : { data: { id: 'plan-1' }, error: null },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
      };
      return q;
    }
  };
  return { client, ops };
}

const validPlan = () => ({
  strategy: 'Portare fuori il lavoro vero di chi monta le tastiere.',
  voice: { mood: 'diretto', tone: 'asciutto', goal: 'far provare', personality: 'un artigiano che spiega' },
  cadence: '3/week',
  platform_mix: [{ platform: 'Instagram', share: '70%', role: 'vetrina' }],
  weeks: [
    {
      theme: 'Il banco di lavoro',
      focus: 'Mostrare il montaggio a mano',
      content_mix: [{ type: 'behind the scenes', count: 3 }],
      rationale: 'La gente compra da chi vede lavorare'
    }
  ]
});

function call(body: unknown, slug = 'demo', insertFails = false) {
  const { client, ops } = fakeSupabase(insertFails);
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
  const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/editorial-plan/save`);
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

describe('POST /api/v1/brands/:slug/editorial-plan/save', () => {
  it('deposita il piano come proposta e dice dove rivederlo', async () => {
    const { res, body, ops } = await call(validPlan());

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      plan_id: 'plan-1',
      status: 'proposed',
      weeks: PLAN_WEEKS,
      review_url: 'https://anomalia.test/app/demo/editorial'
    });
    const inserted = ops.find((o) => o.kind === 'insert')!;
    expect(inserted.table).toBe('editorial_plans');
    expect(inserted.payload).toMatchObject({
      brand_id: 'brand-1',
      status: 'proposed',
      source: 'manual',
      cadence: '3/week',
      strategy: 'Portare fuori il lavoro vero di chi monta le tastiere.'
    });
  });

  it('scrive solo valori che il CHECK del database accetta', async () => {
    const { ops } = await call(validPlan());

    for (const op of ops.filter((o) => o.table === 'editorial_plans')) {
      if (op.payload.source !== undefined) {
        expect(EDITORIAL_PLAN_SOURCES).toContain(op.payload.source);
      }
      if (op.payload.status !== undefined) {
        expect(EDITORIAL_PLAN_STATUSES).toContain(op.payload.status);
      }
    }
  });

  it('un piano salvato è indistinguibile da uno generato: stessa riga, stesse chiavi', async () => {
    const { ops } = await call(validPlan());
    const inserted = ops.find((o) => o.kind === 'insert')!;

    expect(Object.keys(inserted.payload).sort()).toEqual(
      ['brand_id', 'cadence', 'gtm', 'platform_mix', 'source', 'status', 'strategy', 'voice', 'weeks'].sort()
    );
    const weeks = inserted.payload.weeks as Record<string, unknown>[];
    expect(weeks).toHaveLength(PLAN_WEEKS);
    expect(weeks[0]).toEqual({
      index: 0,
      week_start: null,
      theme: 'Il banco di lavoro',
      focus: 'Mostrare il montaggio a mano',
      content_mix: [{ type: 'behind the scenes', count: 3 }],
      rationale: 'La gente compra da chi vede lavorare',
      brief: null,
      products: null,
      status: 'upcoming'
    });
  });

  it('non tocca il piano attivo: supera solo la proposta pendente', async () => {
    const { ops } = await call(validPlan());
    const updates = ops.filter((o) => o.kind === 'update');

    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toEqual({ brand_id: 'brand-1', status: 'proposed' });
    expect(updates[0].payload).toEqual({ status: 'rejected' });
  });

  it('non chiama il modello e non tocca i crediti', async () => {
    await call(validPlan());

    expect(structured).not.toHaveBeenCalled();
    expect(gateAiAction).not.toHaveBeenCalled();
    expect(gateCredits).not.toHaveBeenCalled();
  });

  it('un insert fallito è un errore, non un falso successo', async () => {
    const { res, body } = await call(validPlan(), 'demo', true);

    expect(res.status).toBe(500);
    expect(body.error).toBe('insert_failed');
  });

  it.each([
    ['senza strategia', { strategy: '' }, 'strategy'],
    ['con una cadenza che non esiste', { cadence: '2/week' }, 'cadence'],
    ['senza piattaforme', { platform_mix: [] }, 'platform_mix'],
    ['senza settimane', { weeks: [] }, 'weeks']
  ])('rifiuta un piano %s nominando il campo, prima di scrivere', async (_label, patch, field) => {
    const { res, body, ops } = await call({ ...validPlan(), ...patch });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(body.details[0].path[0]).toBe(field);
    expect(ops).toEqual([]);
  });

  it('rifiuta un campo che il contratto non dichiara', async () => {
    const { res, body, ops } = await call({ ...validPlan(), campo_inventato: 'x' });

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_input');
    expect(ops).toEqual([]);
  });

  it('rifiuta una richiesta senza autenticazione', async () => {
    vi.mocked(authenticate).mockResolvedValue({ error: new Response('Unauthorized', { status: 401 }) } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/demo/editorial-plan/save');
    const res = await (POST as (event: unknown) => Promise<Response>)({
      request: new Request(url, { method: 'POST', body: '{}' }),
      params: { slug: 'demo' },
      url
    });

    expect(res.status).toBe(401);
  });

  it('rifiuta un brand a cui il chiamante non accede', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      supabase: fakeSupabase().client,
      user: { id: 'user-1' },
      apiKey: undefined,
      error: null
    } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
    } as never);
    const url = new URL('https://anomalia.test/api/v1/brands/altrui/editorial-plan/save');
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
    const { res, ops } = await call(validPlan());

    expect(res.status).toBe(403);
    expect(ops).toEqual([]);
  });
});

describe('le costanti del contratto e quelle del dominio', () => {
  it('dicono lo stesso numero di settimane e le stesse cadenze', () => {
    expect(PLAN_CYCLE_WEEKS).toBe(PLAN_WEEKS);
    expect([...PLAN_CADENCES]).toEqual([...CADENCES]);
  });
});
