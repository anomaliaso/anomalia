import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// jobPausedForBrand legge il piano e gli opt-out con il client admin, e registra il salto in
// loop_ticks: entrambi sostituiti qui, con vi.hoisted perché le factory di vi.mock sono issate.
const gateState = vi.hoisted(() => ({
  admin: null as unknown,
  ticks: [] as Record<string, unknown>[]
}));
vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => gateState.admin
}));
vi.mock('$lib/server/loop-ticks', () => ({
  recordLoopTick: (t: Record<string, unknown>) => {
    gateState.ticks.push(t);
  }
}));

import {
  brandRoster,
  clearJobRosterCache,
  jobEnabledForBrand,
  jobPausedForBrand,
  rosterForPrompt,
  scheduledWorkAllowed,
  translatableReason,
  ROSTER_JOBS,
  type RosterJob
} from './job-roster';

/**
 * Le tre proprietà che tengono in piedi il roster, e che sono anche i tre modi in cui questa cosa
 * potrebbe rompere il prodotto in silenzio:
 *   1. nessuna riga = acceso (un lavoro nuovo non ha bisogno di backfill)
 *   2. una riga = spento davvero (altrimenti l'interruttore è finto)
 *   3. tabella assente = acceso (i deploy NON applicano le migration)
 */

// Ricalca la catena vera: .from().select().eq() → { data, error }.
function fakeAdmin(res: { data?: { job_key: string }[]; error?: { message: string } }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: res.data ?? null, error: res.error ?? null })
      })
    })
  } as unknown as SupabaseClient;
}

beforeEach(() => clearJobRosterCache());

describe('jobEnabledForBrand', () => {
  it('è acceso quando il brand non ha nessuna riga di opt-out', async () => {
    expect(await jobEnabledForBrand('b1', 'geo', fakeAdmin({ data: [] }))).toBe(true);
  });

  it('è spento quando esiste la riga di opt-out per QUEL lavoro', async () => {
    const admin = fakeAdmin({ data: [{ job_key: 'geo' }] });
    expect(await jobEnabledForBrand('b1', 'geo', admin)).toBe(false);
    // e non spegne gli altri: l'opt-out è per lavoro, non per brand
    expect(await jobEnabledForBrand('b1', 'seo', admin)).toBe(true);
  });

  it('degrada ad ACCESO quando la tabella non esiste (migration non ancora applicata)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = fakeAdmin({ error: { message: 'relation "brand_job_optouts" does not exist' } });
    expect(await jobEnabledForBrand('b1', 'geo', missing)).toBe(true);
  });

  it('degrada ad ACCESO anche se il client esplode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = {
      from: () => {
        throw new Error('no network');
      }
    } as unknown as SupabaseClient;
    expect(await jobEnabledForBrand('b1', 'geo', boom)).toBe(true);
  });

  it('legge una volta sola per brand: un tick che scorre N lavori non fa N query', async () => {
    let calls = 0;
    const counting = {
      from: () => ({
        select: () => ({
          eq: () => {
            calls++;
            return Promise.resolve({ data: [], error: null });
          }
        })
      })
    } as unknown as SupabaseClient;
    for (const job of ROSTER_JOBS) await jobEnabledForBrand('b1', job.key, counting);
    expect(calls).toBe(1);
  });
});

describe('translatableReason', () => {
  it('lascia passare i codici noti', () => {
    expect(translatableReason('no_plan')).toBe('no_plan');
  });

  it('scarta i messaggi d\'errore grezzi: a schermo non deve finire inglese non tradotto', () => {
    expect(translatableReason('TypeError: fetch failed')).toBeNull();
    expect(translatableReason(null)).toBeNull();
  });
});

describe('brandRoster', () => {
  // Due letture in parallelo: opt-out e ultimi loop_ticks. Nessun join, nessuna colonna nuova
  // su tabelle condivise.
  function rosterAdmin(optOuts: string[], ticks: { loop: string; outcome: string; reason: string | null; created_at: string }[]) {
    return {
      from: (table: string) =>
        table === 'brand_job_optouts'
          ? {
              select: () => ({ eq: () => Promise.resolve({ data: optOuts.map((job_key) => ({ job_key })), error: null }) })
            }
          : {
              select: () => ({
                eq: () => ({
                  in: () => ({
                    order: () => ({ limit: () => Promise.resolve({ data: ticks, error: null }) })
                  })
                })
              })
            }
    } as unknown as SupabaseClient;
  }

  it('tiene separati i tre stati: spento da te / non è girato / è fallito', async () => {
    const rows = await brandRoster(
      rosterAdmin(
        ['geo'],
        [
          { loop: 'geo', outcome: 'skipped', reason: 'user_off', created_at: '2026-08-20T08:00:00Z' },
          { loop: 'seo', outcome: 'skipped', reason: 'no_plan', created_at: '2026-08-20T09:00:00Z' },
          { loop: 'library', outcome: 'failed', reason: 'TypeError: fetch failed', created_at: '2026-08-20T10:00:00Z' },
          { loop: 'weekly_recap', outcome: 'ok', reason: null, created_at: '2026-08-20T11:00:00Z' }
        ]
      ),
      'b1'
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(by.geo.state).toBe('off');
    expect(by.geo.enabled).toBe(false);

    expect(by.seo.state).toBe('skipped');
    expect(by.seo.reason).toBe('no_plan'); // il PERCHÉ, non un generico "non gira"

    expect(by.library.state).toBe('failed');
    expect(by.library.reason).toBeNull(); // il messaggio grezzo non arriva alla UI

    expect(by.weekly_recap.state).toBe('ok');
    expect(by.analytics_review.state).toBe('never'); // nessun tick ≠ fallito
  });

  it('un lavoro riacceso non resta appeso al proprio tick "user_off"', async () => {
    const rows = await brandRoster(
      rosterAdmin([], [{ loop: 'geo', outcome: 'skipped', reason: 'user_off', created_at: '2026-08-20T08:00:00Z' }]),
      'b1'
    );
    const geo = rows.find((r) => r.key === 'geo')!;
    expect(geo.enabled).toBe(true);
    expect(geo.state).toBe('never');
  });
});

describe('scheduledWorkAllowed — senza piano a pagamento il lavoro schedulato non parte', () => {
  it('free (null / stringa vuota) = fermo; piano pagato = si lavora', () => {
    expect(scheduledWorkAllowed(null)).toBe(false);
    expect(scheduledWorkAllowed('')).toBe(false);
    expect(scheduledWorkAllowed(undefined)).toBe(false);
    expect(scheduledWorkAllowed('starter')).toBe(true);
    expect(scheduledWorkAllowed('pro')).toBe(true);
  });
});

describe('jobPausedForBrand — il gate del piano davanti a ogni tick del roster', () => {
  function gateAdmin(opts: { plan?: string | null; planError?: boolean; optOuts?: string[] }) {
    return {
      from: (table: string) =>
        table === 'brands'
          ? {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    opts.planError
                      ? Promise.resolve({ data: null, error: { message: 'boom' } })
                      : Promise.resolve({ data: { plan: opts.plan ?? null }, error: null })
                })
              })
            }
          : {
              select: () => ({
                eq: () =>
                  Promise.resolve({ data: (opts.optOuts ?? []).map((job_key) => ({ job_key })), error: null })
              })
            }
    } as unknown as SupabaseClient;
  }

  beforeEach(() => {
    clearJobRosterCache();
    gateState.ticks = [];
    gateState.admin = gateAdmin({});
  });

  it('brand free: salta e registra `no_plan` — il roster su /agents dice PERCHÉ la squadra è ferma', async () => {
    expect(await jobPausedForBrand('geo', 'b-free', null)).toBe(true);
    expect(gateState.ticks).toEqual([
      { loop: 'geo', brandId: 'b-free', outcome: 'skipped', reason: 'no_plan' }
    ]);
  });

  it('brand pagante: lavora (nessun tick di salto)', async () => {
    expect(await jobPausedForBrand('geo', 'b-paid', 'starter')).toBe(false);
    expect(gateState.ticks).toEqual([]);
  });

  it('senza piano in mano lo legge da sé: free letto dal db = fermo', async () => {
    gateState.admin = gateAdmin({ plan: null });
    expect(await jobPausedForBrand('seo', 'b-db-free')).toBe(true);
    expect(gateState.ticks[0]?.reason).toBe('no_plan');
  });

  it('lettura del piano fallita = nel dubbio si lavora (mai fermare i paganti per un errore di rete)', async () => {
    gateState.admin = gateAdmin({ planError: true });
    expect(await jobPausedForBrand('seo', 'b-unknown')).toBe(false);
    expect(gateState.ticks).toEqual([]);
  });

  it("l'opt-out dell'utente resta distinto: pagante ma spento = `user_off`", async () => {
    gateState.admin = gateAdmin({ optOuts: ['geo'] });
    expect(await jobPausedForBrand('geo', 'b-paid-off', 'pro')).toBe(true);
    expect(gateState.ticks[0]?.reason).toBe('user_off');
  });
});

describe('rosterForPrompt — la squadra nel prompt viene dal registro, non da una lista ricopiata', () => {
  it('ogni lavoro di ROSTER_JOBS compare', () => {
    const text = rosterForPrompt();
    for (const job of ROSTER_JOBS) expect(text).toContain(`- ${job.key} (${job.cadence})`);
  });

  it('cambiare il registro cambia il prompt: una voce nuova appare senza toccare altro', () => {
    const jobs = [...ROSTER_JOBS, { key: 'made_up_job', cadence: 'daily' } as unknown as RosterJob];
    const text = rosterForPrompt(jobs);
    expect(text).toContain('- made_up_job (daily): made_up_job'); // blurb assente → cade sul nome
  });
});
