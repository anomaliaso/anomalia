import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AUTOMATION_CADENCES, AUTOMATION_JOBS, AUTOMATION_STATES } from '@anomalia/api-contracts';
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
  jobRunCounts,
  clearJobRosterCache,
  jobEnabledForBrand,
  jobPausedForBrand,
  rosterForPrompt,
  setJobEnabled,
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

describe('il roster che un agente puo comandare', () => {
  it('e esattamente quello che il prodotto fa girare', () => {
    // Il contratto non puo' importare `$lib`, quindi l'elenco vive anche li'. Un lavoro aggiunto
    // qui e non di la' sarebbe accendibile dal browser e invisibile a `set_automation`; uno
    // aggiunto solo di la' sarebbe un tool che accende qualcosa che non gira.
    expect([...AUTOMATION_JOBS]).toEqual(ROSTER_JOBS.map((j) => j.key));
  });

  it('ogni cadenza e ogni stato che il roster produce e un valore che il contratto dichiara', () => {
    for (const job of ROSTER_JOBS) {
      expect(AUTOMATION_CADENCES, job.key).toContain(job.cadence);
    }
    expect([...AUTOMATION_STATES].sort()).toEqual(['failed', 'never', 'off', 'ok', 'skipped']);
  });
});

describe('jobRunCounts — quante volte un lavoro ha davvero girato', () => {
  function ticksAdmin(rows: { loop: string; outcome: string }[] | null, throws = false) {
    const filters = { loop: [] as string[], outcome: [] as string[], since: '' };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: () => q,
      in: (col: string, vals: string[]) => {
        if (col === 'outcome') filters.outcome = vals;
        else filters.loop = vals;
        return q;
      },
      gte: (_col: string, val: string) => {
        filters.since = val;
        return q;
      },
      limit: () => (throws ? Promise.reject(new Error('no table')) : Promise.resolve({ data: rows }))
    });
    return {
      admin: { from: () => q } as unknown as SupabaseClient,
      filters
    };
  }

  it('conta un lavoro per volta, non tutti insieme', async () => {
    const { admin } = ticksAdmin([
      { loop: 'seo', outcome: 'ok' },
      { loop: 'seo', outcome: 'failed' },
      { loop: 'geo', outcome: 'ok' }
    ]);
    const counts = await jobRunCounts(admin, 'b1', '2026-08-05T00:00:00.000Z');
    expect(counts.get('seo')).toBe(2);
    expect(counts.get('geo')).toBe(1);
  });

  it('non conta un giro fermato da un gate: non ha speso niente', async () => {
    // Contare gli `skipped` direbbe «questo lavoro ti costa» di un lavoro che non ha mai
    // chiamato un modello — e la cifra servirebbe proprio a decidere se accenderlo.
    const { admin, filters } = ticksAdmin([]);
    await jobRunCounts(admin, 'b1', '2026-08-05T00:00:00.000Z');
    expect(filters.outcome).toEqual(['ok', 'failed']);
  });

  it('guarda solo dentro la finestra che le viene chiesta', async () => {
    const { admin, filters } = ticksAdmin([]);
    await jobRunCounts(admin, 'b1', '2026-08-05T00:00:00.000Z');
    expect(filters.since).toBe('2026-08-05T00:00:00.000Z');
  });

  it('un lavoro che non ha mai girato non compare, e vale zero', async () => {
    const { admin } = ticksAdmin([{ loop: 'seo', outcome: 'ok' }]);
    const counts = await jobRunCounts(admin, 'b1', '2026-08-05T00:00:00.000Z');
    expect(counts.get('library') ?? 0).toBe(0);
  });

  it('la tabella assente non porta giù la lettura: zero conteggi, non un errore', async () => {
    const { admin } = ticksAdmin(null, true);
    await expect(jobRunCounts(admin, 'b1', '2026-08-05T00:00:00.000Z')).resolves.toEqual(new Map());
  });
});

/**
 * IL WATCHDOG SI SPEGNE DA SOLO, MA NON SI RIARMA DA SOLO.
 *
 * Tre giri falliti di fila e lo scheduler scrive un opt-out `actor: 'watchdog'` sul roster: il
 * producer appare spento su /agents e si riaccende da lì. Ma `autopilot_failure_count` resta a
 * 3, e la soglia è `>=`: riacceso, il PRIMO fallimento successivo lo rispegne — un solo
 * tentativo invece di tre — e l'avviso «autopilot disattivato» resta acceso finché un giro non
 * riesce. La pagina Impostazioni › Autopilot azzerava il contatore riaccendendo; cancellata
 * quella, il reset vive qui, dove passano ENTRAMBE le superfici che riaccendono: /agents e
 * `set_automation`.
 */
describe('riaccendere un lavoro', () => {
  function recordingAdmin() {
    const writes: { table: string; payload: Record<string, unknown> }[] = [];
    const admin = {
      from: (table: string) => ({
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        upsert: () => Promise.resolve({ error: null }),
        update: (payload: Record<string, unknown>) => {
          writes.push({ table, payload });
          return { eq: () => Promise.resolve({ error: null }) };
        }
      })
    } as unknown as SupabaseClient;
    return { admin, writes };
  }

  it("azzera la serie di fallimenti dell'autopilot, o il watchdog rispegne al primo giro storto", async () => {
    const { admin, writes } = recordingAdmin();

    expect(await setJobEnabled(admin, { brandId: 'b1', jobKey: 'autopilot', enabled: true })).toEqual({ ok: true });
    expect(writes).toEqual([{ table: 'brands', payload: { autopilot_failure_count: 0 } }]);
  });

  it('non azzera niente spegnendo: il contatore serve proprio a chi ha spento', async () => {
    const { admin, writes } = recordingAdmin();

    await setJobEnabled(admin, { brandId: 'b1', jobKey: 'autopilot', enabled: false });
    expect(writes).toEqual([]);
  });

  it("non tocca il contatore per un lavoro che non e' l'autopilot", async () => {
    const { admin, writes } = recordingAdmin();

    await setJobEnabled(admin, { brandId: 'b1', jobKey: 'seo', enabled: true });
    expect(writes).toEqual([]);
  });

  it('non scrive niente se il lavoro non esiste', async () => {
    const { admin, writes } = recordingAdmin();

    expect(await setJobEnabled(admin, { brandId: 'b1', jobKey: 'inventato', enabled: true })).toEqual({
      ok: false,
      error: 'unknown_job'
    });
    expect(writes).toEqual([]);
  });
});
