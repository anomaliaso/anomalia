import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import type { ApiKeyInfo } from '$lib/server/cli-auth';

/**
 * LE QUATTRO ROTTE CHE PIANIFICANO SPENDONO. Ognuna arriva a un modello — `proposePlan`,
 * `revisePlan`, `replanWeek`, `planWeekStrategy` — e nessuna delle quattro passava dal cancello:
 * una chiave di sola lettura le faceva partire, e un brand a crediti finiti pure. Sono le
 * etichette più care che abbiamo (`planStrategy`, `reviewSeeds`, `reviewCaptions`).
 *
 * `gateAiAction` e `checkApiKeyWriteAccess` restano quelli veri: il difetto era che la rotta non
 * li chiamava, e un mock del cancello non avrebbe potuto accorgersene.
 */

const gateCredits = vi.fn();
const proposeFirstPlan = vi.fn();
const revisePlan = vi.fn();
const replanWeek = vi.fn();
const planWeekStrategy = vi.fn();

class CreditsExhaustedError extends Error {}

vi.mock('$lib/server/access', () => ({ userCanEnter: async () => true }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({}) }));
vi.mock('$lib/server/credits', () => ({
  gateCredits: (...args: unknown[]) => gateCredits(...args),
  CreditsExhaustedError
}));
vi.mock('$lib/server/planner-inputs', () => ({
  proposeFirstPlan: (...args: unknown[]) => proposeFirstPlan(...args),
  plannerProfile: async () => ({}),
  planEvidence: async () => ({ benchmark: null, topPosts: [], strategyBrief: '', historyCount: 0 })
}));
vi.mock('$lib/server/editorial-plan', () => ({
  cadenceAllowed: () => [],
  loadActivePlan: async () => ({ id: 'plan-1', weeks: [{}] }),
  revisePlan: (...args: unknown[]) => revisePlan(...args),
  replanWeek: (...args: unknown[]) => replanWeek(...args),
  weekStrategyBrief: () => '',
  postsForWeek: () => 3,
  selectFeaturableProducts: () => []
}));
vi.mock('$lib/server/content-preview', () => ({
  planWeekStrategy: (...args: unknown[]) => planWeekStrategy(...args),
  carouselMaxPerBatch: () => 0,
  loadPlannerMarketSignals: async () => ({ marketBrief: '', competitorThumbUrls: [] })
}));
vi.mock('$lib/server/content-library', () => ({ attachBrandPages: async () => [] }));
vi.mock('$lib/server/gtm', () => ({ activeGtmBrief: async () => '' }));
vi.mock('$lib/server/rubrics', () => ({ loadApprovedRubrics: async () => [] }));
vi.mock('$lib/server/cli-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/cli-auth')>()),
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn()
}));

import { POST as propose } from './editorial-plan/propose/+server';
import { POST as revise } from './editorial-plan/revise/+server';
import { POST as replan } from './editorial-plan/replan-week/+server';
import { POST as planWeek } from './weekly-plan/plan/+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

const BRAND = { id: 'brand-1', org_id: 'org-1', slug: 'demo', name: 'Demo', plan: 'pro', timezone: 'Europe/Rome' };

const READ_ONLY_KEY: ApiKeyInfo = {
  id: 'key-1',
  name: 'read only',
  user_id: 'user-1',
  permissions: { brand_ids: '*', scopes: ['read'] }
};

type Handler = (event: unknown) => Promise<Response>;

const ROUTES = [
  { name: 'editorial-plan/propose', handler: propose as Handler, body: {}, spends: proposeFirstPlan },
  { name: 'editorial-plan/revise', handler: revise as Handler, body: { feedback: 'più prodotto' }, spends: revisePlan },
  { name: 'editorial-plan/replan-week', handler: replan as Handler, body: { week_index: 0, brief: 'x' }, spends: replanWeek },
  { name: 'weekly-plan/plan', handler: planWeek as Handler, body: { week_index: 0 }, spends: planWeekStrategy }
];

function call(route: (typeof ROUTES)[number], apiKey?: ApiKeyInfo) {
  const kit = createTestSupabase({ brands: [{ ...BRAND }], brand_kit: [], products: [], editorial_plans: [], gtm_plans: [], social_accounts: [], content_plans: [] });
  vi.mocked(authenticate).mockResolvedValue({
    supabase: kit.client,
    user: { id: 'user-1' },
    apiKey,
    error: null
  } as never);
  vi.mocked(loadBrandForUser).mockResolvedValue({ brand: BRAND, error: null } as never);

  const url = new URL(`https://anomalia.test/api/v1/brands/demo/${route.name}`);
  return route
    .handler({
      request: new Request(url, { method: 'POST', body: JSON.stringify(route.body) }),
      params: { slug: 'demo' },
      url
    })
    .then(async (res) => ({ res, body: await res.json() }));
}

beforeEach(() => {
  vi.clearAllMocks();
  gateCredits.mockResolvedValue(undefined);
});

describe('le rotte che pianificano passano dal cancello', () => {
  for (const route of ROUTES) {
    describe(route.name, () => {
      it('nega una API key di sola lettura, e non chiama il modello', async () => {
        const { res, body } = await call(route, READ_ONLY_KEY);

        expect(res.status).toBe(403);
        expect(body.error).toBe('API key is read-only');
        expect(route.spends).not.toHaveBeenCalled();
      });

      it('nega un brand senza crediti, e non chiama il modello', async () => {
        gateCredits.mockRejectedValue(new CreditsExhaustedError('no credits'));

        const { res, body } = await call(route);

        expect(res.status).toBe(402);
        expect(body.error).toBe('credits_exhausted');
        expect(route.spends).not.toHaveBeenCalled();
      });

      it('conta la spesa sul brand quando il cancello passa', async () => {
        await call(route);

        expect(gateCredits).toHaveBeenCalledWith('brand-1');
      });
    });
  }
});
