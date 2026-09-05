import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));
vi.mock('$lib/server/brand-context', () => ({ genaiClient: () => ({}) }));
vi.mock('$lib/server/editorial-plan', () => ({
  cadenceAllowed: () => [],
  loadActivePlan: async () => null,
  replanWeek: async () => ({}),
  weekStrategyBrief: () => '',
  postsForWeek: () => [],
  selectFeaturableProducts: () => []
}));
vi.mock('$lib/server/planner-inputs', () => ({
  plannerProfile: async () => ({}),
  planEvidence: async () => ({ benchmark: null, topPosts: [] })
}));
vi.mock('$lib/server/content-preview', () => ({
  planWeekStrategy: async () => {
    throw new Error('nessun piano');
  },
  carouselMaxPerBatch: () => 0,
  loadPlannerMarketSignals: async () => ({})
}));
vi.mock('$lib/server/content-library', () => ({ attachBrandPages: async () => [] }));

import { POST as saveBrief } from './editorial-plan/save-brief/+server';
import { POST as replanWeek } from './editorial-plan/replan-week/+server';
import { POST as planWeek } from './weekly-plan/plan/+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

const WEEK_REQUIRED = 'week_index is required';

const chainable = () => {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'insert', 'update', 'delete']) q[method] = () => q;
  q.maybeSingle = async () => ({ data: null, error: null });
  q.single = async () => ({ data: null, error: null });
  return q;
};

const call = (
  handler: unknown,
  path: string,
  body: Record<string, unknown>
): Promise<Response> =>
  (handler as (e: unknown) => Promise<Response>)({
    request: new Request(`https://example.test${path}`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    params: { slug: 'demo' }
  });

const ROUTES = [
  { name: 'save-brief', handler: saveBrief, path: '/editorial-plan/save-brief', body: { brief: 'x' } },
  { name: 'replan-week', handler: replanWeek, path: '/editorial-plan/replan-week', body: { brief: 'x' } },
  { name: 'weekly-plan/plan', handler: planWeek, path: '/weekly-plan/plan', body: {} }
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticate).mockResolvedValue({
    supabase: { from: chainable, storage: { from: () => ({ remove: async () => ({}) }) } },
    apiKey: null,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({
    brand: { id: 'brand-1', plan: 'pro', name: 'Demo' },
    error: null
  } as never);
});

describe('la settimana, sulle tre rotte che la prendono', () => {
  it('senza settimana risponde che manca', async () => {
    for (const route of ROUTES) {
      const res = await call(route.handler, route.path, route.body);
      expect(await res.json(), route.name).toEqual({ error: WEEK_REQUIRED });
      expect(res.status, route.name).toBe(400);
    }
  });

  it('accetta `week`, il nome che l’agente usa, oltre a `week_index`', async () => {
    for (const route of ROUTES) {
      for (const field of ['week', 'week_index']) {
        const res = await call(route.handler, route.path, { ...route.body, [field]: 0 });
        expect(await res.json(), `${route.name} ${field}`).not.toEqual({ error: WEEK_REQUIRED });
      }
    }
  });
});
