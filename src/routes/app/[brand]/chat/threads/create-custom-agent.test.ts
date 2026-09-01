import { beforeEach, describe, expect, it, vi } from 'vitest';
import { threadIdentity } from '$lib/thread-identity';

const CUSTOM_AGENT_ID = '11111111-2222-3333-4444-555555555555';

const createThread = vi.fn(async () => ({
  id: 'thread-1',
  agent: 'content',
  custom_agent_id: null,
  created_at: 'now'
}));
const setThreadCustomAgent = vi.fn(async () => {});

vi.mock('$lib/server/chat/persistence', () => ({
  createThread: (...a: unknown[]) => createThread(...(a as [])),
  getThread: async () => null,
  listThreads: async () => [],
  listThreadSnippets: async () => ({}),
  renameThread: vi.fn(),
  deleteThread: vi.fn(),
  setThreadAgent: vi.fn(),
  setThreadCustomAgent: (...a: unknown[]) => setThreadCustomAgent(...(a as [])),
  setThreadModel: vi.fn()
}));

vi.mock('$lib/server/custom-agents-read', () => ({
  listCustomAgents: async () => [],
  getCustomAgent: async () => null,
  getCustomAgentsByIds: async (_c: unknown, _b: string, ids: string[]) =>
    ids.includes(CUSTOM_AGENT_ID)
      ? [{ id: CUSTOM_AGENT_ID, name: 'Scriba Fischietto', avatar_face: 'wink', avatar_color: '#2563eb' }]
      : []
}));

const { POST } = await import('./+server');

const t = (k: string) => ({ 'chat.agents.content.label': 'Content Creator' })[k] ?? k;

/** Fake Supabase: solo le catene che POST percorre (il brand, e i run dei custom agent). */
function makeSupabase() {
  const chain: Record<string, unknown> = {
    maybeSingle: async () => ({ data: { id: 'brand-1', plan: 'pro' } }),
    then: (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: [] })
  };
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.order = () => chain;
  return { from: () => chain };
}

function post(body: unknown) {
  const event = {
    request: { json: async () => body },
    params: { brand: 'demo' },
    locals: {
      supabase: makeSupabase(),
      safeGetSession: async () => ({ user: { id: 'u1' }, session: {} })
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (POST as any)(event) as Promise<Response>;
}

describe('POST /app/[brand]/chat/threads con un agente custom', () => {
  beforeEach(() => {
    createThread.mockClear();
    setThreadCustomAgent.mockClear();
  });

  it('il thread nasce già legato: la risposta lo dice', async () => {
    const res = await post({ agent: 'content', custom_agent_id: CUSTOM_AGENT_ID });
    const { thread } = await res.json();
    expect(setThreadCustomAgent).toHaveBeenCalled();
    expect(thread.custom_agent_id).toBe(CUSTOM_AGENT_ID);
  });

  it('la risposta porta già il nome e il volto dell’agente, non quelli dello specialista sotto', async () => {
    const res = await post({ agent: 'content', custom_agent_id: CUSTOM_AGENT_ID });
    const { thread } = await res.json();
    const who = threadIdentity(thread, t);
    expect(who.name).toBe('Scriba Fischietto');
    expect(who.face).toBe('wink');
    expect(who.color).toBe('#2563eb');
  });

  it('senza agente custom resta un thread normale: nessun legame, nessun avatar', async () => {
    const res = await post({ agent: 'content' });
    const { thread } = await res.json();
    expect(setThreadCustomAgent).not.toHaveBeenCalled();
    expect(thread.agents).toEqual([]);
    expect(threadIdentity(thread, t).name).toBe('Content Creator');
  });
});
