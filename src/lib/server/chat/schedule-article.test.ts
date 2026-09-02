import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The reported incident, end to end: at 17:00 Rome the user asks the chat to move a blog post to
 * "oggi alle 18". It used to come back with "18:00 has already passed" and land the article on the
 * NEXT day. The tool must now store today at 18:00 Rome (16:00 UTC).
 */

type Row = Record<string, unknown>;

const article: Row = { id: 'art-1', title: 'Guida al campeggio', status: 'draft' };
let updates: Row[] = [];

/** Minimal chainable Supabase double: select→eq→eq→maybeSingle and update→eq→eq. */
function fakeClient() {
  const chain = (result: unknown) => {
    const self: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'not', 'neq']) self[m] = () => self;
    self.maybeSingle = async () => result;
    self.then = undefined;
    return self;
  };
  return {
    from: (table: string) => ({
      select: () => chain({ data: table === 'brand_articles' ? article : null }),
      update: (patch: Row) => {
        updates.push(patch);
        const self: Record<string, unknown> = { error: null };
        self.eq = () => self;
        return self;
      }
    })
  };
}

vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => fakeClient() }));

beforeEach(() => {
  updates = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-08T15:00:00Z')); // 17:00 in Rome
});

afterEach(() => {
  vi.useRealTimers();
});

async function scheduleArticle(input: string) {
  const { createChatTools } = await import('$lib/agent/tools/index');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = createChatTools(fakeClient() as any, 'brand-1', 'Europe/Rome');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tools.schedule_article as any).execute(
    { article_id: 'art-1', scheduled_for: input },
    { toolCallId: 't1', messages: [] }
  );
}

describe('schedule_article at 17:00 Rome', () => {
  it('schedules "today at 18:00" for today, not tomorrow', async () => {
    const res = await scheduleArticle('2026-08-08T18:00');

    expect(res).toMatchObject({
      success: true,
      scheduled_for: '2026-08-08T16:00:00.000Z',
      scheduled_for_local: '2026-08-08 18:00 (Europe/Rome)'
    });
    expect(updates[0]).toMatchObject({ scheduled_for: '2026-08-08T16:00:00.000Z', status: 'approved' });
  });

  it('refuses a time that really is past, naming both clocks', async () => {
    const res = await scheduleArticle('2026-08-08T16:00');

    expect(res).toMatchObject({
      error: 'requested time is in the past',
      requested_local: '2026-08-08 16:00 (Europe/Rome)',
      now_local: '2026-08-08 17:00 (Europe/Rome)'
    });
    expect(updates).toHaveLength(0);
  });

  it('keeps an explicit UTC instant as UTC', async () => {
    const res = await scheduleArticle('2026-08-09T18:00:00Z');

    expect(res).toMatchObject({
      scheduled_for: '2026-08-09T18:00:00.000Z',
      scheduled_for_local: '2026-08-09 20:00 (Europe/Rome)'
    });
  });
});
