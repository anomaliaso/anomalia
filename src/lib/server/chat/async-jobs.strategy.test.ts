import { describe, it, expect, vi, beforeEach } from 'vitest';

const proposeGtmDual = vi.fn();
const activateGtm = vi.fn().mockResolvedValue(true);
const getOnboardingState = vi.fn();
const canGenerate = vi.fn();
const saveOnboardingState = vi.fn();
const localeLanguageName = vi.fn((l: string) => (l === 'tr' ? 'Turkish' : l));
const genaiClient = vi.fn(() => ({}) as never);
const strategyBriefFromReport = vi.fn(() => '');
const rankRecentWinners = vi.fn(() => []);

vi.mock('$lib/server/gtm', () => ({ proposeGtmDual, activateGtm }));
vi.mock('$lib/server/onboarding', () => ({
  getOnboardingState,
  canGenerate,
  saveOnboardingState,
  approveStudioIfNeeded: vi.fn(async () => ({
    approved: false,
    already: true,
    state: { status: 'completed', phase: 'free_mode', sections: { studio: 'approved' } }
  })),
  SECTION_APPROVED_NEXT_PHASE: {
    studio: 'strategy_generation',
    strategy: 'editorial_plan_generation',
    editorial_plan: 'content_assets_request'
  }
}));
vi.mock('$lib/i18n/locale', () => ({ localeLanguageName }));
vi.mock('$lib/server/research', () => ({ genaiClient, strategyBriefFromReport }));
vi.mock('$lib/server/scheduler', () => ({ rankRecentWinners }));

function makeSupabase() {
  const insert = vi.fn().mockReturnValue({
    select: () => ({
      single: async () => ({ data: { id: 'gtm-1' }, error: null })
    })
  });
  const updateChain = {
    eq: vi.fn(function (this: unknown) {
      return this;
    }).mockResolvedValue({ error: null })
  };
  updateChain.eq.mockImplementation(() => ({
    eq: vi.fn().mockResolvedValue({ error: null })
  }));
  const update = vi.fn(() => updateChain);

  const from = vi.fn((table: string) => {
    if (table === 'brands') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                name: 'HepAntalya',
                target_platforms: ['instagram'],
                plan: 'pro',
                onboarding_state: {},
                timezone: 'Europe/Istanbul'
              }
            })
          })
        })
      };
    }
    if (table === 'brand_kit') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { category: 'super-app', about: 'city OS', ai_context: '' }
            })
          })
        })
      };
    }
    if (table === 'brand_strategy') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null })
          })
        })
      };
    }
    if (table === 'social_post_history') {
      return {
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [] })
          })
        })
      };
    }
    if (table === 'gtm_plans') {
      return { update, insert };
    }
    // The planner profile reads the whole Studio now (one shared plannerProfile, not two) — the
    // catalogue, the faces and the competitive set ride along with the kit.
    if (table === 'products' || table === 'people' || table === 'competitors') {
      const rows = { data: [] as unknown[] };
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = async () => rows;
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { from, insert, update };
}

describe('runGenerateStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOnboardingState.mockReturnValue({ status: 'completed', phase: 'free_mode', sections: {} });
    canGenerate.mockReturnValue(true);
    proposeGtmDual.mockResolvedValue({
      objective: 'Grow local users',
      phases_90d: [{ name: 'Launch' }],
      phases_6m: [{ name: 'Scale', objective: 'city coverage' }],
      phases: [{ name: 'Scale', objective: 'city coverage' }],
      funnel: { awareness: 1 }
    });
    activateGtm.mockResolvedValue(true);
  });

  it('forwards userId into proposeGtmDual (regression: bare userId ReferenceError)', async () => {
    const supabase = makeSupabase();
    const { runGenerateStrategy } = await import('./async-jobs');
    const result = await runGenerateStrategy(supabase as never, 'brand-1', 'user-42', {
      objective: 'local growth',
      locale: 'tr'
    });

    expect(result).toEqual({
      success: true,
      activated: true,
      objective: 'Grow local users',
      phases: [{ name: 'Scale', objective: 'city coverage' }],
      onboarding: false
    });
    expect(proposeGtmDual).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'HepAntalya' }),
      expect.objectContaining({
        brandId: 'brand-1',
        userId: 'user-42',
        objective: 'local growth',
        outputLanguage: 'Turkish',
        timezone: 'Europe/Istanbul'
      })
    );
    expect(activateGtm).toHaveBeenCalledWith(supabase, 'brand-1', 'gtm-1', 'Europe/Istanbul');
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_id: 'brand-1',
        status: 'proposed',
        funnel: { awareness: 1 }
      })
    );
  });
});
