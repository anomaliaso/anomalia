import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `notify_user` manda email vere a persone vere. Quello che va tenuto fermo qui non è che
 * "funzioni": è che non parta due volte, che non parta troppe volte, e che non dica all'utente di
 * avergli mandato una push quando sul telefono non è arrivato niente.
 */

type Row = Record<string, unknown>;

let brand: Row | null;
let contacts: { userId: string; email: string; locale: string | null }[];
let recent: Row[];
let recentError: { message: string } | null;
let inserted: Row[];
let emailed: number;
let push: { sent: number; reached: number };

const notifyBrandContacts = vi.fn(async () => emailed);
const pushToBrandContacts = vi.fn(async () => push);

function fakeAdmin() {
  const chain = (result: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {};
    for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in']) self[m] = () => self;
    self.maybeSingle = async () => result;
    // La query sul log si await direttamente (niente maybeSingle): serve thenable.
    self.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, err);
    return self;
  };
  return {
    from: (table: string) => ({
      select: () =>
        chain(
          table === 'brands'
            ? { data: brand }
            : { data: recentError ? null : recent, error: recentError }
        ),
      insert: (row: Row) => {
        inserted.push(row);
        return {
          then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(ok, err)
        };
      }
    })
  };
}

vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => fakeAdmin() }));
vi.mock('$lib/server/scheduler', () => ({ brandContacts: async () => contacts }));
vi.mock('$lib/server/brand-notify', () => ({
  notifyBrandContacts: (...a: unknown[]) => notifyBrandContacts(...(a as [])),
  pushToBrandContacts: (...a: unknown[]) => pushToBrandContacts(...(a as []))
}));
vi.mock('$lib/server/email', () => ({
  agentNotifyEmailSubject: (_l: string, b: string, s: string) => `${b}: ${s}`,
  agentNotifyEmailHtml: () => '<p>html</p>',
  agentNotifyEmailText: () => 'text'
}));

const INPUT = {
  subject: 'Week 3 posts are ready',
  body: 'Nine posts are waiting for your approval.'
};

async function notifyTool(ctx?: { threadId?: string; origin?: string }) {
  const { createNotifyTools } = await import('./notify-tools');
  const tools = createNotifyTools({
    brandId: 'b1',
    userId: 'u1',
    threadId: 'th1',
    origin: 'https://www.anomalia.so',
    ...ctx
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tools.notify_user as any).execute;
}

beforeEach(() => {
  vi.clearAllMocks();
  brand = { id: 'b1', slug: 'acme', name: 'Acme', org_id: 'org1' };
  contacts = [
    { userId: 'u1', email: 'owner@acme.com', locale: 'it' },
    { userId: 'u2', email: 'guest@acme.com', locale: 'en' }
  ];
  recent = [];
  recentError = null;
  inserted = [];
  emailed = 2;
  push = { sent: 3, reached: 2 };
});

describe('notify_user', () => {
  it('emails every project contact, pushes, and links back to the thread', async () => {
    const execute = await notifyTool();
    const res = await execute(INPUT, { toolCallId: 't1', messages: [] });

    expect(res.sent).toBe(true);
    expect(res.emailed).toBe(2);
    expect(res.recipients).toBe(2);
    expect(res.pushed).toBe(3);
    expect(res.pushEnabled).toBe(true);
    expect(res.url).toBe('https://www.anomalia.so/app/acme/chat/th1');

    expect(notifyBrandContacts).toHaveBeenCalledTimes(1);
    expect(pushToBrandContacts).toHaveBeenCalledTimes(1);
    const pushArgs = pushToBrandContacts.mock.calls[0] as unknown as [unknown, unknown, Row];
    expect(pushArgs[2].body).toBe(INPUT.subject);
    expect(pushArgs[2].title).toBe('Acme');
  });

  it('says plainly when no push was delivered, so the agent cannot promise one', async () => {
    push = { sent: 0, reached: 0 };
    const execute = await notifyTool();
    const res = await execute(INPUT, { toolCallId: 't1', messages: [] });
    expect(res.pushed).toBe(0);
    expect(res.pushEnabled).toBe(false);
    expect(res.note).toContain('No push');
  });

  it('uses its own push line when given one', async () => {
    const execute = await notifyTool();
    await execute({ ...INPUT, push_body: 'Nove post da approvare' }, { toolCallId: 't1', messages: [] });
    const pushArgs = pushToBrandContacts.mock.calls[0] as unknown as [unknown, unknown, Row];
    expect(pushArgs[2].body).toBe('Nove post da approvare');
  });

  it('links to a workbench page when asked, and refuses an unknown one', async () => {
    const execute = await notifyTool();
    const ok = await execute({ ...INPUT, path: '/calendar' }, { toolCallId: 't1', messages: [] });
    expect(ok.url).toBe('https://www.anomalia.so/app/acme/calendar');

    const bad = await execute({ ...INPUT, path: '/../secret' }, { toolCallId: 't2', messages: [] });
    expect(bad.error).toBe('invalid_path');
    // Un path rifiutato non deve consumare il budget del turno né mandare niente.
    expect(notifyBrandContacts).toHaveBeenCalledTimes(1);
  });

  it('stops after two notifications in one turn', async () => {
    const execute = await notifyTool();
    await execute(INPUT, { toolCallId: 't1', messages: [] });
    await execute({ ...INPUT, subject: 'Second thing happened' }, { toolCallId: 't2', messages: [] });
    const third = await execute({ ...INPUT, subject: 'Third thing' }, { toolCallId: 't3', messages: [] });
    expect(third.error).toBe('notify_limit_turn');
    expect(notifyBrandContacts).toHaveBeenCalledTimes(2);
  });

  it('drops an identical subject sent minutes ago instead of sending it twice', async () => {
    recent = [{ subject: INPUT.subject, created_at: new Date().toISOString() }];
    const execute = await notifyTool();
    const res = await execute(INPUT, { toolCallId: 't1', messages: [] });
    expect(res.skipped).toBe('duplicate');
    expect(notifyBrandContacts).not.toHaveBeenCalled();
  });

  it('lets the same subject through once the duplicate window has passed', async () => {
    recent = [{ subject: INPUT.subject, created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() }];
    const execute = await notifyTool();
    const res = await execute(INPUT, { toolCallId: 't1', messages: [] });
    expect(res.sent).toBe(true);
  });

  it('holds the hourly ceiling for the whole brand', async () => {
    recent = Array.from({ length: 6 }, (_, i) => ({
      subject: `n${i}`,
      created_at: new Date(Date.now() - i * 60_000).toISOString()
    }));
    const execute = await notifyTool();
    const res = await execute(INPUT, { toolCallId: 't1', messages: [] });
    expect(res.error).toBe('notify_limit_hour');
    expect(notifyBrandContacts).not.toHaveBeenCalled();
  });

  it('still sends when the log table is unavailable — only the hourly ceiling is lost', async () => {
    recentError = { message: 'relation "agent_notifications" does not exist' };
    const execute = await notifyTool();
    const res = await execute(INPUT, { toolCallId: 't1', messages: [] });
    expect(res.sent).toBe(true);
  });

  it('sends nothing when the project has no contacts', async () => {
    contacts = [];
    const execute = await notifyTool();
    const res = await execute(INPUT, { toolCallId: 't1', messages: [] });
    expect(res.error).toBe('no_recipients');
    expect(notifyBrandContacts).not.toHaveBeenCalled();
  });

  it('writes the audit row with what actually went out', async () => {
    const execute = await notifyTool();
    await execute(INPUT, { toolCallId: 't1', messages: [] });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      brand_id: 'b1',
      thread_id: 'th1',
      user_id: 'u1',
      subject: INPUT.subject,
      recipients: 2,
      emailed: 2,
      pushed: 3
    });
  });
});
