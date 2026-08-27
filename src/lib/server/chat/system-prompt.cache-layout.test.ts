import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildSystemPrompt, buildTurnVolatileBlock, wrapTurnContext } from './system-prompt';

type Row = Record<string, unknown>;

const BRAND_ROW: Row = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'prova',
  name: 'Brand di prova',
  website: 'https://x.test',
  plan: 'pro',
  status: 'active',
  timezone: 'Europe/Rome',
  target_platforms: ['instagram'],
  content_prefs: {},
  onboarding_state: null,
  setup_completed_at: '2026-01-01',
  org_id: null,
  activated_at: '2026-01-01T00:00:00Z',
  stripe_customer_id: null,
  stripe_subscription_id: null,
  autopilot_failure_count: 0,
  onboarding_completed_at: '2026-01-02T00:00:00Z',
  blog_config: null
};

function stubDb(tables: Record<string, Row[]>) {
  const chain = (table: string) => {
    const data = tables[table] ?? null;
    const node: Record<string, unknown> = {
      then: (res?: (v: unknown) => unknown) =>
        Promise.resolve({
          data,
          count: Array.isArray(data) ? data.length : 0,
          error: null
        }).then(res),
      maybeSingle: async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null }),
      single: async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null })
    };
    for (const m of ['select', 'eq', 'neq', 'not', 'gte', 'lte', 'in', 'is', 'order', 'limit', 'range', 'filter', 'or', 'contains', 'overlaps', 'update', 'insert', 'upsert', 'delete'])
      node[m] = () => node;
    return node;
  };
  return { from: (t: string) => chain(t), rpc: () => chain('__rpc__') };
}

function seededTables() {
  return {
    brands: [{ ...BRAND_ROW }],
    brand_kit: [{ category: 'SaaS', about: 'About di prova', target_audience: 'PMI', content_pillars: ['pilastro-a'], site_type: 'saas' }],
    posts: [
      { id: 'p1', platform: 'instagram', caption: 'Post di prova', status: 'scheduled', scheduled_for: null, slot: null, published_url: null, content_type: 'feed', pillar: null }
    ],
    social_accounts: [],
    brand_app_connections: [],
    brand_media: [
      { id: 'm1', kind: 'image', title: 'Foto di prova', description: null, tags: [], subjects: [], media_kind: 'photo', suggested_use: null, when_to_use: null, how_to_use: null, where_to_use: null, width: 100, height: 100, catalog_status: 'ready', file_name: 'foto.jpg', times_used: 0, last_used_at: null }
    ],
    ai_calls: [] as Row[]
  };
}

const harnessCalls: Array<{ system: string; messages: Array<{ role: string; content: unknown }> }> = [];
vi.mock('$lib/server/harness', () => ({
  harnessGenerateText: vi.fn(async (_meta: unknown, args: { system: string; messages: never[] }) => {
    harnessCalls.push({ system: args.system, messages: args.messages });
    return { text: 'Fatto.', steps: [], totalUsage: {} };
  })
}));
vi.mock('./tools', () => ({ createChatTools: () => ({}) }));
vi.mock('./subagents', () => ({ withSubagentTools: (t: unknown) => t }));
vi.mock('./sandbox-tools', () => ({
  withSandboxTools: (t: unknown) => ({ tools: t, close: async () => undefined })
}));
vi.mock('./strategist-tools', () => ({ withStrategistTools: (t: unknown) => t }));
vi.mock('$lib/server/custom-agent-persona', () => ({
  getCustomAgentPersona: vi.fn(async () => null),
  customAgentSystemBlock: () => ''
}));
vi.mock('$lib/server/chat/artifacts', () => ({
  listThreadArtifacts: vi.fn(async () => []),
  formatArtifactsForPrompt: () => ''
}));
vi.mock('./compaction', () => ({ maybeCompactThread: vi.fn(async () => undefined) }));
vi.mock('$lib/server/brand-memory', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  extractMemoryFromChat: vi.fn(async () => undefined)
}));
vi.mock('$lib/server/ai-log', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  logAiCall: () => undefined,
  withBrandContext: (_id: string, fn: () => unknown) => fn()
}));
vi.mock('./model', () => ({
  resolveChatModel: () => ({ model: {}, modelId: 'test-model', provider: 'test', tier: 'auto', callOptions: {} }),
  takeKieUsage: () => ({})
}));
vi.mock('./rate-limits', () => ({
  getChatRateUsage: vi.fn(async () => ({ ok: true })),
  chatCreditsBlocked: vi.fn(async () => false)
}));
vi.mock('./goal', () => ({
  closeGoal: vi.fn(async () => null),
  goalBriefing: () => '',
  goalNudge: () => '',
  goalTurnNotice: () => '',
  goalWorthyRequest: () => false,
  loadOpenGoal: vi.fn(async () => null),
  setThreadGoal: vi.fn(async () => null),
  settleGoalForTurn: vi.fn(async () => null),
  succeededToolNames: vi.fn(() => []),
  refusedToolNames: vi.fn(() => []),
  trackGoalSettlement: () => undefined
}));
vi.mock('./mid-turn-mailbox', () => ({
  createMidTurnMailbox: () => ({ prepareStep: async () => ({}), absorbedCount: () => 0 })
}));
vi.mock('$lib/server/hydrate-chat-documents', () => ({ hydrateChatDocuments: vi.fn(async () => []) }));
vi.mock('$lib/server/web-push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));
vi.mock('./unread', () => ({ markThreadRead: vi.fn(async () => undefined) }));

let db: { tables: Record<string, Row[]>; client: unknown };
const savedAssistant: Array<{ threadId: string; opts?: { speaker?: string } }> = [];
vi.mock('./persistence', () => ({
  getThread: vi.fn(async (_sb: unknown, threadId: string) =>
    db.tables.chat_threads.find((t) => t.id === threadId) ?? null
  ),
  loadHistory: vi.fn(async (_sb: unknown, _b: string, _u: string, threadId: string) =>
    db.tables.chat_messages
      .filter((m) => m.thread_id === threadId)
      .map((m) => ({ role: m.role, content: m.content }))
  ),
  saveMessages: vi.fn(
    async (
      _sb: unknown,
      brandId: string,
      userId: string,
      messages: Array<{ role: string; content: unknown }>,
      threadId: string,
      opts?: { speaker?: string }
    ) => {
      for (const m of messages) {
        if (m.role === 'user') {
          db.tables.chat_messages.push({
            thread_id: threadId,
            brand_id: brandId,
            user_id: userId,
            role: 'user',
            content: String(m.content),
            name: opts?.speaker ?? null,
            superseded: false,
            created_at: new Date().toISOString()
          });
        } else {
          savedAssistant.push({ threadId, opts });
        }
      }
      return ['m1'];
    }
  ),
  renameThread: vi.fn(async () => undefined),
  assistantContentFromSteps: (_steps: unknown[], text?: string) =>
    text ? [{ type: 'text', text }] : []
}));

const { processNextQueuedChatJob } = await import('./queue');

function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { chat_messages: [], chat_threads: [], chat_jobs: [] };
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let autoId = 0;

  function build(name: string, mode: 'select' | 'update', patch?: Row) {
    const table = (tables[name] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    const run = () => {
      const hits = table.filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
      return hits;
    };
    const api: Row = {
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), api),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), api),
      contains: () => api,
      not: () => api,
      is: () => api,
      or: () => api,
      filter: () => api,
      order: () => api,
      limit: () => api,
      range: () => api,
      select: () => api,
      single: async () => ({ data: run()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res?: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve(res ? res({ data: run(), error: null }) : { data: run(), error: null })
    };
    return api;
  }

  return {
    tables,
    client: {
      rpc: async () => ({ data: 0, error: null }),
      from: (name: string) => ({
        select: () => build(name, 'select'),
        update: (patch: Row) => build(name, 'update', patch),
        insert: (row: Row | Row[]) => {
          const rows = (Array.isArray(row) ? row : [row]).map((r) => ({
            id: `${name}-${++autoId}`,
            created_at: new Date().toISOString(),
            ...r
          }));
          (tables[name] ??= []).push(...rows);
          return {
            select: () => ({
              single: async () => ({ data: rows[0], error: null }),
              maybeSingle: async () => ({ data: rows[0], error: null })
            }),
            then: (res?: (v: { error: null }) => unknown) =>
              Promise.resolve(res ? res({ error: null }) : { error: null })
          };
        }
      })
    }
  };
}

beforeEach(() => {
  harnessCalls.length = 0;
  savedAssistant.length = 0;
});

describe('STABILITÀ — il system prompt non cambia fra due turni dello stesso thread', () => {
  it('due costruzioni consecutive con i soli crediti consumati restano byte-identiche', async () => {
    const tables = seededTables();
    const dbUnit = stubDb(tables);

    const first = await buildSystemPrompt(dbUnit as never, { ...BRAND_ROW }, 'it', null);

    tables.ai_calls.push({ cost_usd: 0.02 }, { cost_usd: 0.05 });

    const second = await buildSystemPrompt(dbUnit as never, { ...BRAND_ROW }, 'it', null);

    expect(second).toBe(first);
  });
});

describe('ARRIVO DEL VOLATILE — busta sull’ultimo messaggio utente, system pulito', () => {
  it('il system non porta più crediti, orologio né notifiche', async () => {
    const dbUnit = stubDb(seededTables());
    const p = await buildSystemPrompt(dbUnit as never, { ...BRAND_ROW }, 'it', null);

    expect(p).not.toContain('## CAPACITY & LIMITS');
    expect(p).not.toContain('## NOW (live clock');
    expect(p).not.toContain('## NOTIFICATIONS');
  });

  it('il blocco volatile porta crediti, orologio e notifiche per intero', async () => {
    const dbUnit = stubDb(seededTables());
    const vol = await buildTurnVolatileBlock(dbUnit as never, { ...BRAND_ROW }, 'it');

    expect(vol).toContain('## CAPACITY & LIMITS');
    expect(vol).toContain('AI credits this billing period:');
    expect(vol).toContain('## NOW (live clock');
    expect(vol).toContain('## NOTIFICATIONS');
  });

  it('la busta avvolge il testo utente senza sostituirlo', () => {
    const wrapped = wrapTurnContext('BLOCCO-VOLATILE-DI-PROVA', 'ciao dal test');
    expect(wrapped.startsWith('[CONTESTO OPERATIVO DEL TURNO]')).toBe(true);
    expect(wrapped).toContain('BLOCCO-VOLATILE-DI-PROVA');
    expect(wrapped.endsWith('ciao dal test')).toBe(true);
    expect(wrapTurnContext('', 'solo testo')).toBe('solo testo');
  });
});

describe('NESSUNA PERDITA — le sezioni stabili restano nel system prompt', () => {
  it('l’inventario delle sezioni sopravvive al trasloco del volatile', async () => {
    const dbUnit = stubDb(seededTables());
    const p = await buildSystemPrompt(dbUnit as never, { ...BRAND_ROW }, 'it', null);

    for (const header of [
      'You are Anomalia',
      '## NAVIGATION',
      '## EU AI ACT',
      '## BRAND\n',
      '## SUBSCRIPTION',
      '## SOCIAL CONNECTIONS',
      '## MEDIA LIBRARY',
      '## RECENT POSTS',
      '## PRODUCT DEMO ACCOUNT'
    ]) {
      expect(p, header).toContain(header);
    }
  });
});

describe('INTERCETTA CODA — il modello riceve la busta sul messaggio nuovo, il system resta stabile', () => {
  it('CAPACITY e clock stanno nell’ultimo messaggio user, non nel system', async () => {
    db = makeDb({
      brands: [{ ...BRAND_ROW }],
      chat_threads: [
        { id: 'th-1', brand_id: BRAND_ROW.id, user_id: 'user-1', agent: null, custom_agent_id: null, title: 'Chat' }
      ],
      chat_jobs: [
        {
          id: 'job-1',
          brand_id: BRAND_ROW.id,
          user_id: 'user-1',
          thread_id: 'th-1',
          tool_name: 'chat_response',
          status: 'pending',
          created_at: new Date().toISOString(),
          input_params: { user_message: 'cosa posso fare oggi?', locale: 'it', origin: '' }
        }
      ]
    });

    const res = await processNextQueuedChatJob(db.client as never, '');
    expect(res.processed).toBe(true);
    expect(harnessCalls.length).toBe(1);

    const { system, messages } = harnessCalls[0];
    expect(system).toContain('You are Anomalia');
    expect(system).not.toContain('## CAPACITY & LIMITS');
    expect(system).not.toContain('## NOW (live clock');

    const last = messages[messages.length - 1];
    expect(last.role).toBe('user');
    const text = typeof last.content === 'string' ? last.content : '';
    expect(text).toContain('[CONTESTO OPERATIVO DEL TURNO]');
    expect(text).toContain('## CAPACITY & LIMITS');
    expect(text).toContain('## NOW (live clock');
    expect(text.endsWith('cosa posso fare oggi?')).toBe(true);

    const persisted = db.tables.chat_messages.find(
      (m) => m.role === 'user' && String(m.content).includes('cosa posso fare oggi?')
    );
    expect(persisted).toBeTruthy();
    expect(String(persisted?.content)).not.toContain('[CONTESTO OPERATIVO DEL TURNO]');
  });
});
