import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DOVE ATTERRA IL GIRO DI UNA ROUTINE — la proprietà che rende vero tutto il resto.
 *
 * Una routine con un proprietario scrive nel DIARIO del proprietario (il thread `surface='team'`
 * dove quell'agente lascia già i resoconti delle sue altre routine), non in un thread nuovo. Se
 * questo si rompe, la pagina continua a mostrare la routine sulla card giusta mentre il lavoro
 * finisce in una chat che nessuno apre: il difetto più silenzioso possibile.
 *
 * Il secondo controllo è meno ovvio e altrettanto importante: il diario di squadra appartiene
 * all'OWNER DEL BRAND, che può non essere chi ha scritto la routine. Il turno va accodato per il
 * proprietario del thread — con l'utente sbagliato i messaggi verrebbero scritti a nome di
 * qualcuno che quel thread non lo legge.
 */

const enqueue = vi.fn(async () => 'job-1');
const createThread = vi.fn(async () => ({ id: 'brand-new-thread', created_at: 'now' }));
const teamThread = vi.fn(async () => ({
  threadId: 'diario-analyst',
  userId: 'owner-del-brand',
  locale: 'it' as const,
  created: false
}));

vi.mock('$lib/server/chat/queue', () => ({
  enqueueQueuedChatTurn: (...a: unknown[]) => enqueue(...(a as [])),
  kickChatQueueWork: vi.fn(),
  threadHasActiveChatResponse: async () => false
}));
vi.mock('$lib/server/team-ignition', () => ({
  getOrCreateTeamThread: (...a: unknown[]) => teamThread(...(a as []))
}));
vi.mock('$lib/server/chat/persistence', () => ({
  createThread: (...a: unknown[]) => createThread(...(a as [])),
  getThread: async () => null,
  setThreadAgent: vi.fn()
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Fake Supabase: le sole catene che fireCustomAgentSchedule percorre. */
function db(tables: Record<string, Row[]>) {
  const updates: Row[] = [];
  return {
    updates,
    tables,
    client: {
      from: (name: string) => {
        const filters: Array<(r: Row) => boolean> = [];
        const rows = () => (tables[name] ?? []).filter((r) => filters.every((f) => f(r)));
        const api: Row = {
          select: () => api,
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), api),
          limit: () => api,
          maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
          update: (patch: Row) => {
            updates.push({ table: name, patch });
            return api;
          },
          insert: () => api,
          then: (res?: (v: unknown) => unknown) =>
            Promise.resolve(res ? res({ data: rows(), error: null }) : { data: rows(), error: null })
        };
        return api;
      }
    } as never
  };
}

const routine = {
  id: 'r1',
  brand_id: 'b1',
  // Chi ha SCRITTO la routine: un membro del progetto, non l'owner del brand.
  user_id: 'chi-ha-scritto',
  name: 'Recap del lunedì',
  prompt: 'Leggi le performance e scrivi cosa cambiare.',
  agent: 'team:analyst',
  days_of_week: [1],
  times: ['09:00'],
  enabled: true,
  reuse_thread: false,
  last_thread_id: null,
  last_job_id: null
} as Row;

beforeEach(() => {
  enqueue.mockClear();
  createThread.mockClear();
  teamThread.mockClear();
});

describe('fireCustomAgentSchedule — il giro finisce nel diario del proprietario', () => {
  it('routine di un agente di default: scrive nel suo thread di squadra, non in uno nuovo', async () => {
    const { fireCustomAgentSchedule } = await import('./custom-agents');
    const store = db({ profiles: [{ id: 'owner-del-brand', locale: 'it' }] });

    const res = await fireCustomAgentSchedule(store.client, routine as never, 'https://app.example');

    expect(res.ok).toBe(true);
    expect(res.ok && res.threadId).toBe('diario-analyst');
    // Il proprietario è quello scritto nella colonna `agent`, senza il prefisso.
    expect(teamThread).toHaveBeenCalledWith(expect.anything(), 'b1', 'analyst');
    // Nessun thread nuovo: era il difetto: una chat per giro, e il diario vuoto.
    expect(createThread).not.toHaveBeenCalled();
    // Accodato per il proprietario DEL THREAD, non per chi ha scritto la routine.
    expect(enqueue.mock.calls[0][1]).toMatchObject({
      threadId: 'diario-analyst',
      userId: 'owner-del-brand',
      scheduled: true
    });
  });

  it('routine di un custom agent: get-or-create sul suo diario, stessa superficie', async () => {
    const { fireCustomAgentSchedule } = await import('./custom-agents');
    const ownerId = '11111111-2222-3333-4444-555555555555';
    const store = db({
      // L'IDENTITÀ sta qui (0210); `custom_agent_schedules` tiene solo gli incarichi.
      custom_agents: [
        { id: ownerId, brand_id: 'b1', user_id: 'u-custom', name: 'Watcher', agent: 'content', enabled: true }
      ],
      chat_threads: [
        {
          id: 'diario-watcher',
          brand_id: 'b1',
          user_id: 'u-custom',
          surface: 'team',
          surface_key: `custom:${ownerId}`
        }
      ],
      profiles: [{ id: 'u-custom', locale: 'it' }]
    });

    const res = await fireCustomAgentSchedule(
      store.client,
      { ...routine, agent: `custom:${ownerId}` } as never,
      'https://app.example'
    );

    expect(res.ok && res.threadId).toBe('diario-watcher');
    expect(createThread).not.toHaveBeenCalled();
    expect(teamThread).not.toHaveBeenCalled();
  });

  it('senza proprietario non cambia niente: thread suo, com’è sempre stato', async () => {
    const { fireCustomAgentSchedule } = await import('./custom-agents');
    const store = db({ profiles: [{ id: 'chi-ha-scritto', locale: 'it' }] });

    const res = await fireCustomAgentSchedule(
      store.client,
      { ...routine, agent: 'content' } as never,
      'https://app.example'
    );

    expect(res.ok && res.threadId).toBe('brand-new-thread');
    expect(createThread).toHaveBeenCalled();
    expect(teamThread).not.toHaveBeenCalled();
    expect(enqueue.mock.calls[0][1]).toMatchObject({ userId: 'chi-ha-scritto' });
  });
});
