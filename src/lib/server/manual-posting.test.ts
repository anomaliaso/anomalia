import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishApprovedPost = vi.fn();
const structured = vi.fn();

vi.mock('$lib/server/publish', () => ({
  publishApprovedPost: (...args: unknown[]) => publishApprovedPost(...args)
}));
vi.mock('$lib/server/research', () => ({
  structured: (...args: unknown[]) => structured(...args)
}));
vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: (_brandId: string, fn: () => unknown) => fn()
}));
vi.mock('$lib/server/brand-media', () => ({
  publishLibraryImageAsPostMedia: vi.fn()
}));

import { createManualPost } from './manual-posting';

const TZ = 'Europe/Rome';

type Row = Record<string, unknown>;

function fakeSupabase(): { client: SupabaseLike; rows: Row[] } {
  const rows: Row[] = [];
  const client = {
    from() {
      const q = {
        insert(row: Row) {
          rows.push(row);
          return q;
        },
        select: () => q,
        eq: () => q,
        single: async () => ({ data: { id: 'post-1' }, error: null }),
        maybeSingle: async () => ({ data: { id: 'post-1', ...rows[0] }, error: null })
      };
      return q;
    }
  };
  return { client: client as unknown as SupabaseLike, rows };
}

type SupabaseLike = Parameters<typeof createManualPost>[0]['supabase'];

function create(input: Parameters<typeof createManualPost>[0]['input']) {
  const { client, rows } = fakeSupabase();
  return createManualPost({
    supabase: client,
    userId: 'user-1',
    brandId: 'brand-1',
    timezone: TZ,
    input
  }).then((result) => ({ result, rows }));
}

beforeEach(() => {
  vi.clearAllMocks();
  publishApprovedPost.mockResolvedValue({ scheduled: 1, failed: 0 });
});

describe('createManualPost', () => {
  it('un draft resta senza data e non passa dalla pubblicazione', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy scritto a mano',
      mode: 'draft'
    });

    expect(result).toEqual({ ok: true, id: 'post-1', status: 'pending_user', slot: null });
    expect(rows[0].status).toBe('pending_user');
    expect(rows[0].scheduled_for).toBeNull();
    expect(rows[0].slot).toBeNull();
    expect(publishApprovedPost).not.toHaveBeenCalled();
  });

  // 2030-05-16 è un giovedì; le 09:00 di Roma in maggio (CEST, UTC+2) sono le 07:00 UTC.
  it('lo scheduling fissa istante e slot sull orologio del brand, poi pubblica', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy scritto a mano',
      mode: 'schedule',
      date: '2030-05-16',
      time: '09:00'
    });

    expect(rows[0].scheduled_for).toBe('2030-05-16T07:00:00.000Z');
    expect(rows[0].slot).toBe('Thu 09:00');
    expect(rows[0].status).toBe('pending_user');
    expect(publishApprovedPost).toHaveBeenCalledTimes(1);
    expect(publishApprovedPost.mock.calls[0][3]).toEqual({ now: false });
    expect(result).toMatchObject({ ok: true, status: 'scheduled' });
  });

  it('la pubblicazione immediata non fissa nessuna data', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy scritto a mano',
      mode: 'now'
    });

    expect(rows[0].scheduled_for).toBeNull();
    expect(rows[0].slot).toBeNull();
    expect(publishApprovedPost.mock.calls[0][3]).toEqual({ now: true });
    expect(result).toMatchObject({ ok: true, status: 'published' });
  });

  it('una data già passata viene rifiutata', async () => {
    const { result, rows } = await create({
      platforms: ['linkedin'],
      caption: 'copy scritto a mano',
      mode: 'schedule',
      date: '2020-01-01',
      time: '09:00'
    });

    expect(result).toEqual({ ok: false, error: 'too_soon' });
    expect(rows).toEqual([]);
  });

  it('non chiama mai il modello: la copy arriva già scritta', async () => {
    await create({ platforms: ['linkedin'], caption: 'copy scritto a mano', mode: 'draft' });

    expect(structured).not.toHaveBeenCalled();
  });
});
