import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * L'AGENTE E LE SUE ROUTINE SONO DUE COSE — e queste sono le cose che devono restare vere.
 *
 * Prima un "custom agent" ERA una riga di `custom_agent_schedules`: nome, faccia, brief, giorni,
 * orari ed `enabled` insieme. Quindi non poteva avere due routine, non poteva esistere senza una
 * routine, e c'era un solo interruttore per due decisioni diverse ("questo agente non lavora più"
 * e "questo incarico non serve più"). La 0210 le separa; qui si verifica che la separazione
 * produca davvero i quattro comportamenti per cui esiste.
 */

const enqueue = vi.fn(async () => 'job-1');

vi.mock('$lib/server/chat/queue', () => ({
  enqueueQueuedChatTurn: (...a: unknown[]) => enqueue(...(a as [])),
  kickChatQueueWork: vi.fn(),
  threadHasActiveChatResponse: async () => false
}));
vi.mock('$lib/server/team-ignition', () => ({
  getOrCreateTeamThread: async () => ({ threadId: 't', userId: 'u', locale: 'it', created: false })
}));
vi.mock('$lib/server/chat/persistence', () => ({
  createThread: async () => ({ id: 'nuovo', created_at: 'now' }),
  getThread: async () => null,
  setThreadAgent: vi.fn()
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Fake Supabase: le sole catene che questo modulo percorre, con update/delete veri. */
function db(tables: Record<string, Row[]>) {
  const make = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let pending: { op: 'update'; patch: Row } | { op: 'delete' } | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const settle = () => {
      if (pending?.op === 'update') {
        const hit = rows();
        for (const r of hit) Object.assign(r, pending.patch);
        return { data: hit[0] ?? null, error: null };
      }
      if (pending?.op === 'delete') {
        const gone = new Set(rows());
        tables[table] = (tables[table] ?? []).filter((r) => !gone.has(r));
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    };
    const api: Row = {
      select: () => api,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), api),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c] ?? '') <= v), api),
      order: () => api,
      limit: () => api,
      update: (patch: Row) => ((pending = { op: 'update', patch }), api),
      delete: () => ((pending = { op: 'delete' }), api),
      insert: () => api,
      maybeSingle: async () => settle(),
      then: (res?: (v: unknown) => unknown) => {
        const out = settle();
        return Promise.resolve(res ? res(out) : out);
      }
    };
    return api;
  };
  return { tables, client: { from: make } as never };
}

const AGENT_ID = '11111111-2222-3333-4444-555555555555';

function brandWithTwoRoutines() {
  return db({
    custom_agents: [
      {
        id: AGENT_ID,
        brand_id: 'b1',
        user_id: 'u1',
        name: 'Watcher',
        prompt: 'Sorveglia il campo.',
        agent: 'content',
        enabled: true
      }
    ],
    custom_agent_schedules: [
      routineRow('r-mattina', ['09:00']),
      routineRow('r-sera', ['19:00'])
    ],
    chat_threads: [
      { id: 'diario', brand_id: 'b1', user_id: 'u1', surface: 'team', surface_key: `custom:${AGENT_ID}` }
    ],
    profiles: [{ id: 'u1', locale: 'it' }],
    brands: [{ id: 'b1', timezone: 'Europe/Rome', status: 'active', plan: 'pro' }],
    chat_jobs: []
  });
}

function routineRow(id: string, times: string[]): Row {
  return {
    id,
    brand_id: 'b1',
    user_id: 'u1',
    name: `Giro ${id}`,
    prompt: 'Fai il giro e lascia due righe.',
    agent: `custom:${AGENT_ID}`,
    enabled: true,
    days_of_week: [1],
    times,
    reuse_thread: false,
    next_run_at: '2020-01-01T00:00:00.000Z',
    last_thread_id: null,
    last_job_id: null,
    last_error: null
  };
}

beforeEach(() => enqueue.mockClear());

describe('un agente, più routine', () => {
  it('spegnere una routine non tocca né l’altra né l’agente', async () => {
    const { setCustomAgentScheduleEnabled } = await import('./custom-agents');
    const store = brandWithTwoRoutines();

    const ok = await setCustomAgentScheduleEnabled(store.client, {
      brandId: 'b1',
      id: 'r-sera',
      enabled: false,
      timezone: 'Europe/Rome'
    });

    expect(ok).toBe(true);
    const byId = Object.fromEntries(store.tables.custom_agent_schedules.map((r) => [r.id, r]));
    expect(byId['r-sera'].enabled).toBe(false);
    expect(byId['r-mattina'].enabled).toBe(true);
    expect(store.tables.custom_agents[0].enabled).toBe(true);
  });

  it('spegnere l’AGENTE sospende tutte le sue routine senza cambiarne lo stato', async () => {
    const { setCustomAgentEnabled, fireCustomAgentSchedule } = await import('./custom-agents');
    const store = brandWithTwoRoutines();

    expect(await setCustomAgentEnabled(store.client, { brandId: 'b1', id: AGENT_ID, enabled: false })).toBe(true);

    for (const row of store.tables.custom_agent_schedules) {
      const res = await fireCustomAgentSchedule(store.client, row as never, 'https://app.example');
      expect(res.ok).toBe(false);
      expect(!res.ok && res.error).toBe('agent_paused');
    }
    // Nessun turno accodato, e le routine restano ACCESE: riaccendendo l'agente riparte quello
    // che girava prima, senza dover ricordare a mano cosa era attivo.
    expect(enqueue).not.toHaveBeenCalled();
    expect(store.tables.custom_agent_schedules.every((r) => r.enabled === true)).toBe(true);

    // …e riacceso, riparte: il gate è l'unica cosa che le teneva ferme.
    await setCustomAgentEnabled(store.client, { brandId: 'b1', id: AGENT_ID, enabled: true });
    const again = await fireCustomAgentSchedule(
      store.client,
      store.tables.custom_agent_schedules[0] as never,
      'https://app.example'
    );
    expect(again.ok).toBe(true);
  });

  it('il tick salta le routine di un agente spento senza rimetterle in testa alla coda', async () => {
    const { setCustomAgentEnabled, tickCustomAgentSchedules } = await import('./custom-agents');
    const store = brandWithTwoRoutines();
    await setCustomAgentEnabled(store.client, { brandId: 'b1', id: AGENT_ID, enabled: false });

    const res = await tickCustomAgentSchedules(store.client, 'https://app.example', new Date('2024-05-06T08:00:00Z'));

    expect(res.fired).toBe(0);
    expect(res.skipped).toBe(2);
    for (const r of store.tables.custom_agent_schedules) {
      expect(r.last_error).toBe('agent_paused');
      // next_run_at è avanzato: una routine sospesa non deve affamare le altre a ogni tick.
      expect(String(r.next_run_at) > '2024-05-06T08:00:00.000Z').toBe(true);
    }
  });

  it('licenziare un agente porta via i suoi incarichi, non li lascia a girare invisibili', async () => {
    const { deleteCustomAgent } = await import('./custom-agents');
    const store = brandWithTwoRoutines();
    // Una routine di un ALTRO proprietario non deve essere toccata.
    store.tables.custom_agent_schedules.push({ ...routineRow('r-analyst', ['07:00']), agent: 'team:analyst' });

    expect(await deleteCustomAgent(store.client, { brandId: 'b1', id: AGENT_ID })).toBe(true);
    expect(store.tables.custom_agents).toHaveLength(0);
    expect(store.tables.custom_agent_schedules.map((r) => r.id)).toEqual(['r-analyst']);
  });
});

/**
 * LA TRANSIZIONE, SIMULATA. La 0210 non si applica da qui (in questo progetto le migration si
 * applicano a mano), quindi si verifica la sola proprietà da cui dipende tutto il resto: l'id si
 * RIUSA, così ogni chiave `custom:<uuid>` già scritta — il diario `surface_key`, il thread legato
 * dal composer, la pila di avatar — continua a indicare la stessa persona.
 */
describe('0210 — le righe esistenti diventano agente + prima routine', () => {
  const SQL = readFileSync('supabase/migrations/0210_custom_agents.sql', 'utf8');

  it('la migration riusa l’id e ripunta le foreign key che ora significano "l’agente"', () => {
    // Il passo 2 seleziona `s.id` invece di lasciare che il default generi un uuid nuovo: senza
    // questo, ogni chiave `custom:<uuid>` già scritta punterebbe nel vuoto.
    expect(SQL).toMatch(/insert into public\.custom_agents \([\s\S]*?\n\s*id,/);
    expect(SQL).toMatch(/select\s*\n\s*s\.id,/);
    expect(SQL).toContain("set agent = 'custom:' || s.id::text");
    expect(SQL).toContain('references public.custom_agents(id)');
    // Idempotente: riapplicarla non duplica niente.
    expect(SQL).toContain('on conflict (id) do nothing');
  });
});
