import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// L'accensione parla con il DB via il client che le viene passato; il realtime (dentro
// saveMessages) e l'admin di default si sostituiscono per non trascinare env e rete nei test.
vi.mock('$lib/server/supabase-admin', () => ({
  createAdminClient: () => {
    throw new Error('i test passano il client esplicitamente');
  }
}));
vi.mock('$lib/server/realtime', () => ({ broadcastToBrand: vi.fn(async () => {}) }));
// Env deterministica: il primo giro parte solo se ci sono base URL e segreto.
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('$env/dynamic/private', () => ({ env: { AUTOPILOT_SECRET: 'secret' } }));

import { igniteBrandTeam, reportToAgentThread } from './team-ignition';
import { ROSTER_JOBS, jobOwner } from './job-roster';

/**
 * Le proprietà che tengono in piedi l'accensione:
 *   1. idempotente — i webhook Stripe si ripetono: la seconda chiamata non crea una seconda squadra
 *   2. rispetta un "no" esplicito già salvato (radar.enabled === false resta false)
 *   3. un thread per agente PROPRIETARIO (non più uno per job), con il suo seed, UNA volta
 *   4. il resoconto di un giro finisce nel diario del suo proprietario, intestato alla routine
 *   5. un salvataggio fallito non fa fallire il lavoro (saveMessages ora ALZA)
 */

type Row = Record<string, unknown>;

/** Fake supabase minimale: brands/organizations/profiles fissi, chat_threads/messages in memoria. */
function fakeDb(opts: { contentPrefs?: Row; failMessageInsert?: boolean } = {}) {
  const state = {
    brand: { id: 'b1', slug: 'acme', org_id: 'org1', content_prefs: opts.contentPrefs ?? {} } as Row,
    threads: [] as Row[],
    messages: [] as Row[],
    brandUpdates: [] as Row[]
  };
  let nextId = 1;

  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      const chain = (fn: unknown) => Object.assign(b, fn);
      chain({
        select: () => b,
        limit: () => b,
        order: () => b,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return b;
        },
        maybeSingle: async () => {
          if (table === 'brands') return { data: state.brand, error: null };
          if (table === 'organizations') return { data: { owner_id: 'owner1' }, error: null };
          if (table === 'profiles') return { data: { locale: 'it' }, error: null };
          if (table === 'chat_threads') {
            // Come l'indice unico 0199: un thread per (brand, user, surface, surface_key).
            const hit = state.threads.find(
              (t) =>
                t.brand_id === filters.brand_id &&
                t.user_id === filters.user_id &&
                t.surface === filters.surface &&
                t.surface_key === filters.surface_key
            );
            return { data: hit ?? null, error: null };
          }
          return { data: null, error: null };
        },
        insert: (payload: Row | Row[]) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          return {
            select: () => ({
              single: async () => {
                if (table === 'chat_threads') {
                  const row = { ...rows[0], id: `t${nextId++}`, created_at: new Date().toISOString() };
                  state.threads.push(row);
                  return { data: row, error: null };
                }
                return { data: null, error: null };
              },
              then: (resolve: (v: unknown) => void) => {
                if (table === 'chat_messages') {
                  if (opts.failMessageInsert) {
                    resolve({ data: null, error: { message: 'row too big' } });
                    return;
                  }
                  const inserted = rows.map((r) => ({ ...r, id: `m${nextId++}` }));
                  state.messages.push(...inserted);
                  resolve({ data: inserted.map((r) => ({ id: r.id })), error: null });
                  return;
                }
                resolve({ data: [], error: null });
              }
            })
          };
        },
        update: (payload: Row) => {
          if (table === 'brands') state.brandUpdates.push(payload);
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        upsert: () => Promise.resolve({ data: null, error: null }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) })
      });
      return b;
    }
  } as unknown as SupabaseClient;

  return { client, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
});

describe('igniteBrandTeam', () => {
  it('crea UN thread per agente PROPRIETARIO (content/analyst/web), con il seed, e lancia il primo giro', async () => {
    const { client, state } = fakeDb();
    const res = await igniteBrandTeam('b1', client);

    const owners = [...new Set(ROSTER_JOBS.map((j) => jobOwner(j.key)))];
    expect(res.ignited).toBe(true);
    expect(res.threadsCreated).toBe(owners.length);
    // Il thread porta l'id VERO dello specialista (faccia e prompt del composer), e il marcatore
    // di squadra sta su surface/surface_key — mai più un tag 'job:<key>'.
    expect(state.threads.map((t) => t.agent).sort()).toEqual([...owners].sort());
    expect(state.threads.every((t) => t.surface === 'team' && t.surface_key === t.agent)).toBe(true);
    // Ogni thread ha il suo messaggio di presentazione (statico, in lingua dell'owner).
    expect(state.messages).toHaveLength(owners.length);
    expect(state.messages.every((m) => m.role === 'assistant')).toBe(true);
    // Primo giro: i quattro tick con valore su un brand appena nato, via ?brand=<slug>.
    const urls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/geo/tick?brand=acme'))).toBe(true);
    expect(urls.filter((u) => u.includes('brand=acme'))).toHaveLength(4);
  });

  it('è idempotente: la seconda chiamata non crea nulla e non rilancia il primo giro', async () => {
    const { client, state } = fakeDb();
    await igniteBrandTeam('b1', client);
    const threadsAfterFirst = state.threads.length;
    const messagesAfterFirst = state.messages.length;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockClear();

    const res = await igniteBrandTeam('b1', client);

    expect(res.threadsCreated).toBe(0);
    expect(state.threads).toHaveLength(threadsAfterFirst);
    expect(state.messages).toHaveLength(messagesAfterFirst);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accende il radar di default, ma un "no" esplicito già salvato resta un no', async () => {
    const on = fakeDb();
    await igniteBrandTeam('b1', on.client);
    const radarUpdate = on.state.brandUpdates.find((u) => u.content_prefs);
    expect(
      (radarUpdate?.content_prefs as { radar: { enabled: boolean } }).radar.enabled
    ).toBe(true);

    // L'utente aveva già detto no: l'accensione non lo scavalca.
    const off = fakeDb({ contentPrefs: { radar: { enabled: false } } });
    await igniteBrandTeam('b1', off.client);
    expect(off.state.brandUpdates.find((u) => u.content_prefs)).toBeUndefined();
  });
});

describe('autopilot_enabled è ritirato', () => {
  it('nessun decisore lo legge più: solo commenti possono nominarlo', async () => {
    // La colonna resta nel DB (e nei payload passivi di CLI/nav), ma NIENTE deve più decidere in
    // base ad essa: è il flag che è rimasto false per mesi su un brand pagante senza che nessuno
    // se ne accorgesse. Il producer vive sul roster ('autopilot' in brand_job_optouts).
    const { readFileSync } = await import('node:fs');
    const files = [
      'src/lib/server/scheduler.ts',
      'src/lib/server/settings-actions.ts',
      'src/lib/server/reconciliation.ts',
      'src/lib/server/brand-doctor.ts',
      'src/routes/api/v1/autopilot/tick/+server.ts'
    ];
    for (const f of files) {
      const offending = readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => l.includes('autopilot_enabled'))
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        // L'id stabile del gate del doctor si chiama così da sempre: è un'etichetta, non una lettura.
        .filter((l) => !l.includes("id: 'autopilot_enabled'"));
      expect(offending, `${f} legge ancora autopilot_enabled`).toEqual([]);
    }
  });
});

describe('reportToAgentThread', () => {
  it('il resoconto finisce nel diario del PROPRIETARIO, intestato alla routine', async () => {
    const { client, state } = fakeDb();
    await igniteBrandTeam('b1', client);
    const webThread = state.threads.find((t) => t.agent === 'web');
    const analystThread = state.threads.find((t) => t.agent === 'analyst');

    await reportToAgentThread(client, 'b1', { job: 'geo', citability: 72, techScore: 80 });
    await reportToAgentThread(client, 'b1', { job: 'seo', initiatives: 3 });

    // geo e seo sono entrambe routine del Web Specialist: stesso thread, due voci di diario,
    // ognuna col nome della SUA routine in testa (il thread si legge come un giornale di lavoro).
    const entries = state.messages.filter((m) => m.thread_id === webThread!.id);
    expect(entries).toHaveLength(3); // seed + 2 report
    expect(String(entries[1]?.content)).toMatch(/^\*\*Controllo visibilità AI\*\* — /);
    expect(String(entries[1]?.content)).toContain('72/100');
    expect(String(entries[2]?.content)).toMatch(/^\*\*Revisione SEO\*\* — /);
    // …e il diario di un altro agente resta com'era (solo il suo seed).
    expect(state.messages.filter((m) => m.thread_id === analystThread!.id)).toHaveLength(1);
  });

  it('ogni job del roster ha un proprietario nella squadra, e NESSUNO gira come agente nullo', () => {
    for (const j of ROSTER_JOBS) {
      // Anomalia esclusa di proposito: una routine che gira "senza specializzazione" gira col set
      // pieno di tool e non compare sulla card di nessuno — il lavoro ricorrente ha un mestiere.
      expect(['content', 'ugc', 'motion', 'web', 'analyst'], j.key).toContain(jobOwner(j.key));
    }
  });

  it('un salvataggio fallito NON alza: il lavoro è già stato fatto', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = fakeDb({ failMessageInsert: true });
    // saveMessages alza sull'errore di insert (per il seed e per il report): qui non deve uscire.
    await expect(
      reportToAgentThread(client, 'b1', { job: 'library', pages: 12 })
    ).resolves.toBeUndefined();
  });
});
