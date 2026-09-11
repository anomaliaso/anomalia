import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestSupabase, type TestSupabase } from '$lib/testkit/supabase';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => undefined)
}));
vi.mock('$lib/server/research', () => ({ structured: vi.fn(), benchmarkDigest: vi.fn() }));

const activatePlan = vi.fn();
vi.mock('$lib/server/editorial-plan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/editorial-plan')>()),
  activatePlan: (...args: unknown[]) => activatePlan(...args)
}));

import { POST } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

const BRAND = { id: 'brand-1', slug: 'demo', name: 'Demo', plan: 'pro', timezone: 'Europe/Rome' };

const WEEK = {
  index: 0,
  theme: 'Il banco di lavoro',
  focus: 'Mostrare il montaggio a mano',
  content_mix: [{ type: 'behind the scenes', count: 3 }],
  rationale: 'La gente compra da chi vede lavorare'
};

const PROPOSED = {
  id: 'plan-new',
  brand_id: 'brand-1',
  status: 'proposed',
  strategy: 'Il lavoro vero, in vetrina.',
  voice: { mood: 'diretto', tone: 'asciutto', goal: 'far provare', personality: 'un artigiano' },
  cadence: '3/week',
  platform_mix: [{ platform: 'instagram', share: '70%', role: 'vetrina' }],
  gtm: null,
  weeks: [WEEK],
  created_at: '2026-09-10T09:00:00.000Z'
};

const ACTIVE = {
  id: 'plan-old',
  brand_id: 'brand-1',
  status: 'active',
  strategy: 'Il piano di prima.',
  voice: { mood: 'tiepido', tone: 'generico', goal: 'esserci', personality: 'nessuna' },
  cadence: '5/week',
  platform_mix: [],
  gtm: null,
  weeks: [],
  created_at: '2026-08-01T09:00:00.000Z'
};

function seed(): TestSupabase {
  return createTestSupabase({
    editorial_plans: [{ ...ACTIVE }, { ...PROPOSED }],
    brands: [{ id: 'brand-1', content_prefs: { mood: 'tiepido', frequency: '5/week' } }]
  });
}

function call(prepare?: (kit: TestSupabase) => void) {
  const kit = seed();
  prepare?.(kit);
  vi.mocked(authenticate).mockResolvedValue({
    supabase: kit.client,
    user: { id: 'user-1' },
    apiKey: undefined,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: BRAND, error: null } as never);

  const url = new URL('https://anomalia.test/api/v1/brands/demo/editorial-plan/approve');
  return (POST as (event: unknown) => Promise<Response>)({
    request: new Request(url, { method: 'POST' }),
    params: { slug: 'demo' },
    url
  }).then(async (res) => ({ res, body: await res.json(), kit }));
}

const planById = (kit: TestSupabase, id: string) =>
  kit.tables.get('editorial_plans')?.find((row) => row.id === id);

beforeEach(async () => {
  vi.clearAllMocks();
  const real = await vi.importActual<typeof import('$lib/server/editorial-plan')>(
    '$lib/server/editorial-plan'
  );
  activatePlan.mockImplementation(real.activatePlan);
});

describe('POST /api/v1/brands/:slug/editorial-plan/approve', () => {
  it('attiva la proposta, supera il piano vecchio e sincronizza le preferenze', async () => {
    const { res, body, kit } = await call();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(planById(kit, 'plan-new')?.status).toBe('active');
    expect(planById(kit, 'plan-old')?.status).toBe('superseded');
    expect(kit.tables.get('brands')?.[0].content_prefs).toMatchObject({
      mood: 'diretto',
      frequency: '3/week'
    });
  });

  it('una scrittura fallita non diventa ok: true', async () => {
    const { res, body } = await call((kit) =>
      kit.failNext(
        'editorial_plans',
        'duplicate key value violates unique constraint "editorial_plans_active_uniq"',
        'update'
      )
    );

    expect(res.ok).toBe(false);
    expect(body.ok).not.toBe(true);
    expect(body.error).toContain('editorial_plans_active_uniq');
  });

  it('un piano che sparisce fra la lettura e l attivazione non diventa ok: true', async () => {
    activatePlan.mockResolvedValue(null);

    const { res, body, kit } = await call();

    expect(res.ok).toBe(false);
    expect(body.ok).not.toBe(true);
    expect(planById(kit, 'plan-old')?.status).toBe('active');
  });

  it('sincronizza le preferenze dal piano normalizzato, una volta sola', async () => {
    const { kit } = await call();
    const writes = kit.calls.filter((c) => c.table === 'brands' && c.op === 'update');

    expect(writes).toHaveLength(1);
    expect(planById(kit, 'plan-new')?.weeks?.[0]).toHaveProperty('week_start');
  });
});
