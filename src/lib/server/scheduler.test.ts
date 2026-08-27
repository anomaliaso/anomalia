import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rankRecentWinners, runAutopilotForBrand, type AutopilotBrand } from './scheduler';
import { clearJobRosterCache } from './job-roster';

// ── Autopilot produce-gate tests ─────────────────────────────────────────────
// runAutopilotForBrand pulls in nearly the whole server, so the AI / network /
// email boundaries are stubbed at module level and the DB access is a permissive
// fake that returns empty data unless a test says otherwise.

vi.mock('./usage', () => ({
  remaining: vi.fn(async () => ({
    posts: 10,
    videos: 5,
    postsUsed: 0,
    videosUsed: 0,
    postsQuota: 10,
    videosCap: 5,
    credits: { remaining: 1000, periodEnd: new Date('2099-01-01T00:00:00Z') }
  })),
  addUsage: vi.fn(async () => {}),
  monthKey: () => '2026-06'
}));

vi.mock('./gtm', () => ({
  activeGtmBrief: vi.fn(async () => ''),
  loadActiveGtm: vi.fn(async () => null),
  reviewPhase: vi.fn(async () => ({ verdict: 'on_track', message: '' })),
  phasePerformanceDigest: vi.fn(() => ({})),
  currentPhaseIndex: vi.fn(() => null),
  proposeGtmDual: vi.fn(async () => ({ objective: null, phases_90d: [], phases_6m: [], phases: [], funnel: null }))
}));

vi.mock('./editorial-plan', () => ({
  loadActivePlan: vi.fn(async () => null),
  currentWeekIndex: vi.fn(() => null),
  weekStrategyBrief: vi.fn(() => ''),
  postsForWeek: vi.fn(() => 3),
  setWeekStatus: vi.fn(async () => {}),
  proposeNextCycle: vi.fn(async () => ({})),
  proposePlan: vi.fn(async () => ({
    strategy: null,
    voice: { personality: 'Test' },
    cadence: {},
    platform_mix: [],
    weeks: []
  })),
  activatePlan: vi.fn(async () => null),
  cadenceAllowed: vi.fn(() => []),
  selectFeaturableProducts: vi.fn((rows: unknown[]) => rows)
}));

vi.mock('$lib/server/growth-readiness', () => ({
  loadGrowthReadiness: vi.fn(async () => ({ ready: true, checks: [], blocking: [], warnings: [] })),
  growthReadinessMessage: vi.fn(() => '')
}));

vi.mock('./brand-context', () => ({
  rebuildBrandContext: vi.fn(async () => ''),
  genaiClient: vi.fn()
}));

vi.mock('./content-preview', () => ({
  generatePreview: vi.fn(async () => {}),
  planWeekStrategy: vi.fn(async () => ({ seeds: [] })),
  executeWeekStrategy: vi.fn(async () => ({ seeds: [] })),
  renderPreviewImages: vi.fn(async () => {}),
  normalizeWeeklyStrategy: vi.fn((s: unknown) => s),
  attachBrandMoodImages: vi.fn(async () => {}),
  enrichCtaWithUtm: vi.fn(async () => {}),
  loadPlannerMarketSignals: vi.fn(async () => ({ marketBrief: '', competitorThumbUrls: [] })),
  isProduceApproved: vi.fn(() => false),
  carouselMaxPerBatch: vi.fn(() => 1)
}));

vi.mock('./credits', () => ({
  getCreditsUsage: vi.fn(async () => ({
    posts: 0,
    videos: 0,
    remaining: 1000,
    periodEnd: new Date('2099-01-01T00:00:00Z')
  })),
  maybeSendCreditWarning: vi.fn(async () => {})
}));

type Row = Record<string, unknown>;
type DbEvent = { kind: 'insert' | 'update' | 'upsert'; table: string; payload: Row; opts?: unknown };

/** Chainable fake supabase: empty data everywhere except the tables a test overrides. */
function fakeSupabase(overrides: { accounts?: Row[]; optOuts?: Row[] } = {}) {
  const events: DbEvent[] = [];
  const resultFor = (table: string): Row[] => {
    if (table === 'social_accounts') return overrides.accounts ?? [];
    // Il gate del roster dentro runAutopilotForBrand legge gli opt-out con QUESTO client.
    if (table === 'brand_job_optouts') return overrides.optOuts ?? [];
    return [];
  };
  const builder = (table: string) => {
    const b = {
      select: () => b,
      eq: () => b,
      neq: () => b,
      is: () => b,
      or: () => b,
      not: () => b,
      in: () => b,
      lt: () => b,
      lte: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      range: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: { id: 'run-1' }, error: null }),
      insert: (payload: Row, opts?: unknown) => {
        events.push({ kind: 'insert', table, payload, opts });
        return b;
      },
      update: (payload: Row) => {
        events.push({ kind: 'update', table, payload });
        return b;
      },
      upsert: (payload: Row, opts?: unknown) => {
        events.push({ kind: 'upsert', table, payload, opts });
        return b;
      },
      then: (resolve: (v: { data: Row[]; count: number; error: null }) => void) =>
        resolve({ data: resultFor(table), count: 0, error: null })
    };
    return b;
  };
  return { client: { from: (t: string) => builder(t) } as unknown as SupabaseClient, events };
}

const BRAND_ID = '00000000-0000-4000-8000-000000000001';

const brand: AutopilotBrand = {
  id: BRAND_ID,
  name: 'Acme',
  slug: 'acme',
  plan: 'starter',
  timezone: 'Europe/Rome',
  target_platforms: ['instagram'],
  content_prefs: {},
  autopilot_failure_count: 0,
  last_autopilot_run_at: null,
  activated_at: null,
  org_id: '00000000-0000-4000-8000-0000000000aa',
  zernio_profile_id: null,
  blog_config: null
};

beforeEach(() => {
  vi.clearAllMocks();
  // Gli opt-out del roster sono cached 60s per brand: senza reset un test inquina il successivo.
  clearJobRosterCache();
});

describe('runAutopilotForBrand — no_social_accounts gate', () => {
  it('skips production and records a daily-dedup warning incident when the brand has no active account', async () => {
    const { client, events } = fakeSupabase({ accounts: [] });

    const res = await runAutopilotForBrand(client, brand);

    expect(res.ran).toBe(false);
    expect(res.reason).toBe('no_social_accounts');
    expect(res.runId).toBe('run-1');

    // Incident: warning, daily dedup key, detected_on GENERATED ALWAYS — never in the payload.
    const incident = events.find((e) => e.kind === 'upsert' && e.table === 'incidents');
    expect(incident).toBeDefined();
    expect(incident?.payload.kind).toBe('no_social_accounts');
    expect(incident?.payload.severity).toBe('warning');
    expect(incident?.payload.brand_id).toBe(BRAND_ID);
    expect(incident?.payload).not.toHaveProperty('detected_on');
    expect(incident?.opts).toEqual({ onConflict: 'brand_id,kind,detected_on' });

    // Run marked completed (not failed) and the failure streak reset, like pending_backlog.
    const runUpdate = events.find((e) => e.kind === 'update' && e.table === 'scheduler_runs');
    expect(runUpdate?.payload.status).toBe('completed');
    expect(runUpdate?.payload.posts_created).toBe(0);

    const brandUpdate = events.find((e) => e.kind === 'update' && e.table === 'brands');
    expect(brandUpdate?.payload.autopilot_failure_count).toBe(0);
    expect(typeof brandUpdate?.payload.last_autopilot_run_at).toBe('string');
  });

  it('does NOT gate an export-only paid plan — zero accounts is what Go sells', async () => {
    // Go è venduto con socialsIncluded: 0 e la promessa "You publish. We prepare.", 15 post al
    // mese da esportare. Con il gate applicato anche a lui, il gate scattava a ogni run e un
    // cliente pagante non riceveva MAI un post: la condizione che doveva evitare lo spreco gli
    // toglieva esattamente ciò che aveva comprato.
    const { client, events } = fakeSupabase({ accounts: [] });

    const res = await runAutopilotForBrand(client, { ...brand, plan: 'go' });

    expect(res.reason).not.toBe('no_social_accounts');
    expect(events.some((e) => e.kind === 'upsert' && e.table === 'incidents')).toBe(false);
  });

  it('gates free/trial brands ancora prima: senza piano a pagamento il producer non parte', async () => {
    // La regola del lavoro schedulato (scheduledWorkAllowed, job-roster.ts) ora copre anche il
    // producer: un brand free non arriva nemmeno al gate degli account — niente run, niente costi.
    const { client, events } = fakeSupabase({ accounts: [] });

    const res = await runAutopilotForBrand(client, { ...brand, plan: null });

    expect(res.ran).toBe(false);
    expect(res.reason).toBe('no_plan');
    // Nessuna scrittura: il gate sta prima della creazione della scheduler_run.
    expect(events.length).toBe(0);
  });

  it("l'opt-out del roster sulla chiave 'autopilot' ferma il run (user_off)", async () => {
    const { client } = fakeSupabase({ accounts: [], optOuts: [{ job_key: 'autopilot' }] });

    const res = await runAutopilotForBrand(client, brand);

    expect(res.ran).toBe(false);
    expect(res.reason).toBe('user_off');
  });

  it('does not gate production when at least one active account exists', async () => {
    const { client, events } = fakeSupabase({
      accounts: [{ id: 'acc-1', platform: 'instagram', auto_publish: true, status: 'active' }]
    });

    const res = await runAutopilotForBrand(client, brand);

    expect(res.reason).not.toBe('no_social_accounts');
    expect(res.ran).toBe(true);
    expect(events.some((e) => e.kind === 'upsert' && e.table === 'incidents')).toBe(false);
  });
});

const NOW = Date.parse('2026-06-08T00:00:00Z');

describe('rankRecentWinners', () => {
  it('prefers recent posts (last ~90d) and ranks them by engagement', () => {
    const posts = [
      { content: 'old viral', platform: 'ig', metrics: { engagementRate: 99 }, published_at: '2025-01-01T00:00:00Z' },
      { content: 'recent best', platform: 'ig', metrics: { engagementRate: 5 }, published_at: '2026-05-20T00:00:00Z' },
      { content: 'recent mid', platform: 'ig', metrics: { engagementRate: 3 }, published_at: '2026-05-25T00:00:00Z' },
      { content: 'recent low', platform: 'ig', metrics: { engagementRate: 1 }, published_at: '2026-06-01T00:00:00Z' }
    ];
    const out = rankRecentWinners(posts, NOW);
    expect(out.map((p) => p.content)).toEqual(['recent best', 'recent mid', 'recent low']); // old excluded
  });

  it('scores by likes + 2·comments when no engagementRate', () => {
    const posts = [
      { content: 'a', platform: null, metrics: { likes: 100, comments: 0 }, published_at: '2026-06-01T00:00:00Z' },
      { content: 'b', platform: null, metrics: { likes: 10, comments: 60 }, published_at: '2026-06-02T00:00:00Z' }, // 10+120=130
      { content: 'c', platform: null, metrics: { likes: 5, comments: 1 }, published_at: '2026-06-03T00:00:00Z' }
    ];
    expect(rankRecentWinners(posts, NOW).map((p) => p.content)).toEqual(['b', 'a', 'c']);
  });

  it('falls back to all posts when fewer than 3 are recent', () => {
    const posts = [
      { content: 'a', platform: null, metrics: { likes: 5 }, published_at: '2024-01-01T00:00:00Z' },
      { content: 'b', platform: null, metrics: { likes: 50 }, published_at: '2024-02-01T00:00:00Z' }
    ];
    expect(rankRecentWinners(posts, NOW).map((p) => p.content)).toEqual(['b', 'a']);
  });
});

// ── La guardia dell'overlap nel tick — proprietà sul sorgente ────────────────
// Il tick è un +server.ts (importa $env/dynamic/private): si legge, come per gli altri tick
// promossi in agent-turns.test.ts. La proprietà da blindare non è un dettaglio di stile — è
// l'incidente: dal 25 giugno all'8 agosto sei brand sono rimasti fermi perché un run 'pending'
// mai chiuso (function uccisa a 300s) faceva saltare il brand a ogni giro, per sempre, e il
// salto avveniva prima di qualunque scrittura: `scheduler_runs` vuota, zero loop_ticks,
// campanella pulita. Nessuno poteva accorgersene.
describe('autopilot tick — la guardia del pending non blocca per sempre', () => {
  const src = readFileSync('src/routes/api/v1/autopilot/tick/+server.ts', 'utf8');

  it('i run pending scaduti vengono chiusi come failed prima di contare gli in-flight', () => {
    const reap = src.indexOf('.lt(\'created_at\', staleCutoff)');
    const count = src.indexOf("{ count: 'exact', head: true }");
    expect(reap).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(reap);
  });

  it('il conteggio degli in-flight è limitato alla finestra (un pending vecchio non conta)', () => {
    expect(src).toContain(".eq('status', 'pending')\n      .gte('created_at', staleCutoff)");
  });

  it('un run scaduto alza il contatore di fallimenti, che è ciò che accende la campanella', () => {
    expect(src).toContain('autopilot_failure_count: (brand.autopilot_failure_count ?? 0) + 1');
  });

  it('il salto per overlap scrive un loop tick: ogni `continue` lascia una riga', () => {
    const tick = src.indexOf("reason: 'in_flight'");
    const skip = src.indexOf('pending run in flight');
    expect(tick).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(tick);
  });
});
