import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const zernio = vi.hoisted(() => ({
  deletePost: vi.fn(),
  getPostStatus: vi.fn()
}));

vi.mock('$lib/server/zernio', () => zernio);
vi.mock('$lib/server/publish', () => ({ publishApprovedPost: vi.fn() }));
vi.mock('$lib/server/brand-memory', () => ({ learnFromCaptionEdit: vi.fn() }));

import { cancelZernioForPost, deletePostCancellingZernio, editorActions, isMeaningfulCaptionEdit } from '$lib/server/post-editing';

// Il filtro fra refuso e riscrittura: sotto la soglia la coppia non insegna niente e non deve
// scacciare dal jsonb le riscritture vere (captionEditPairs tiene solo le ultime 5).
describe('isMeaningfulCaptionEdit', () => {
  it('rejects no-ops, typo fixes and tiny captions', () => {
    expect(isMeaningfulCaptionEdit('stessa caption', 'stessa caption')).toBe(false);
    expect(isMeaningfulCaptionEdit('', 'nuova caption lunga abbastanza')).toBe(false);
    expect(isMeaningfulCaptionEdit('qualcosa', 'corto')).toBe(false);
    expect(
      isMeaningfulCaptionEdit(
        'Tre resi su dieci partono da una taglia sbagliata, e la tabella è nella foto.',
        'Tre resi su dieci partono da una taglia sbagliata e la tabella è nella foto'
      )
    ).toBe(false);
  });

  it('accepts a real rewrite (different wording) and a hard cut (length delta)', () => {
    expect(
      isMeaningfulCaptionEdit(
        'Scopri come il nostro prodotto rivoluziona la tua routine quotidiana in modo semplice.',
        'La tabella taglie è nella seconda foto. Meno resi per tutti.'
      )
    ).toBe(true);
    const long = 'Una caption molto lunga che il proprietario ha tagliato drasticamente. '.repeat(3);
    expect(isMeaningfulCaptionEdit(long, long.slice(0, 60))).toBe(true);
  });
});

type Update = { table: string; patch: Record<string, unknown> };

function fakeSupabase(opts: { externalPostId?: string | null; postStatus?: string; logged?: boolean } = {}) {
  const externalPostId = opts.externalPostId ?? 'zernio-123';
  const postStatus = opts.postStatus ?? 'scheduled';
  const logged = opts.logged ?? true;
  const updates: Update[] = [];

  function from(table: string) {
    let operation: 'select' | 'update' = 'select';
    const query = {
      select() {
        operation = 'select' as const;
        return query;
      },
      update(patch: Record<string, unknown>) {
        operation = 'update' as const;
        updates.push({ table, patch });
        return query;
      },
      eq() { return query; },
      not() { return query; },
      async maybeSingle() {
        if (table === 'posts') return { data: { status: postStatus, external_post_id: externalPostId }, error: null };
        if (table === 'brands') return { data: { timezone: 'Europe/Rome' }, error: null };
        return { data: null, error: null };
      },
      then(resolve: (value: unknown) => void) {
        if (operation === 'update') return Promise.resolve(resolve({ error: null }));
        const data = table === 'publish_logs' && externalPostId && logged
          ? [{ external_post_id: externalPostId }]
          : [];
        return Promise.resolve(resolve({ data, error: null }));
      }
    };
    return query;
  }

  return { client: { from } as never, updates };
}

describe('verified Zernio cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  it('retries a transient delete race and confirms post_not_found', async () => {
    const { client } = fakeSupabase();
    zernio.deletePost
      .mockRejectedValueOnce(new Error('Zernio delete post 409: not committed'))
      .mockResolvedValueOnce(undefined);
    zernio.getPostStatus
      .mockResolvedValueOnce({ status: 'scheduled', url: null, error: null, scheduledFor: null })
      .mockRejectedValueOnce(new Error('Zernio 404: {"error":"post_not_found"}'));

    const pending = cancelZernioForPost(client, 'post-1');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ undeleted: [] });
    expect(zernio.deletePost).toHaveBeenCalledTimes(2);
  });

  it('returns the live id and stores the real Zernio error after all retries fail', async () => {
    const { client, updates } = fakeSupabase();
    zernio.deletePost.mockRejectedValue(new Error('Zernio delete post 503: upstream unavailable'));
    zernio.getPostStatus.mockResolvedValue({ status: 'scheduled', url: null, error: null, scheduledFor: null });

    const pending = cancelZernioForPost(client, 'post-1');
    await vi.runAllTimersAsync();
    const result = await pending;

    expect(zernio.deletePost).toHaveBeenCalledTimes(3);
    expect(result.undeleted).toEqual([{
      externalPostId: 'zernio-123',
      error: 'Zernio delete post 503: upstream unavailable; Zernio post is still scheduled'
    }]);
    expect(updates.find((u) => u.patch.status === 'revoked')?.patch.error)
      .toContain('Zernio delete post 503: upstream unavailable');
  });

  it('returns an action error with the Zernio id and does not clear the local schedule', async () => {
    const { client, updates } = fakeSupabase();
    zernio.deletePost.mockRejectedValue(new Error('Zernio delete post 500: race'));
    zernio.getPostStatus.mockResolvedValue({ status: 'scheduled', url: null, error: null, scheduledFor: null });
    const form = new FormData();
    form.set('id', 'post-1');

    const pending = (editorActions.cancelSchedule as never as (event: unknown) => Promise<unknown>)({
      request: new Request('https://example.test/app/brand/content?/cancelSchedule', { method: 'POST', body: form }),
      locals: { supabase: client }
    });
    await vi.runAllTimersAsync();
    const result = await pending as { status: number; data: { error: string } };

    expect(result.status).toBe(502);
    expect(result.data.error).toContain('zernio-123');
    expect(updates).not.toContainEqual(expect.objectContaining({
      table: 'posts',
      patch: expect.objectContaining({ external_post_id: null, scheduled_for: null })
    }));
  });

  it('accepts a terminal remote status as proof the copy is gone', async () => {
    const { client } = fakeSupabase();
    zernio.deletePost.mockResolvedValue(undefined);
    // Zernio can answer 200 with a torn-down status instead of 404. That is not "still live".
    zernio.getPostStatus.mockResolvedValue({ status: 'deleted', url: null, error: null, scheduledFor: null });

    const pending = cancelZernioForPost(client, 'post-1');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ undeleted: [] });
    expect(zernio.deletePost).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-published copy alone so repost still runs', async () => {
    // publish_logs holds no 'scheduled' row once the post went out; posts.external_post_id does
    // survive, and Zernio refuses to delete published copies — cancelling must not attempt it.
    const { client } = fakeSupabase({ postStatus: 'published', logged: false });

    const pending = cancelZernioForPost(client, 'post-1');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ undeleted: [] });
    expect(zernio.deletePost).not.toHaveBeenCalled();
    expect(zernio.getPostStatus).not.toHaveBeenCalled();
  });

  it('still falls back to posts.external_post_id while the post is scheduled', async () => {
    const { client } = fakeSupabase({ postStatus: 'scheduled', logged: false });
    zernio.deletePost.mockResolvedValue(undefined);
    zernio.getPostStatus.mockRejectedValue(new Error('Zernio 404: {"error":"post_not_found"}'));

    const pending = cancelZernioForPost(client, 'post-1');
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ undeleted: [] });
    expect(zernio.deletePost).toHaveBeenCalledWith('zernio-123');
  });
});

// La classe dell'incidente scheduling di luglio 2026: cancellare la riga di `posts` senza
// revocare Zernio lascia la schedulazione viva — il post sparisce dall'app e esce lo stesso.
// Queste prove fissano l'ordine (revoca → log → delete) e il fallimento sicuro (revoca KO →
// riga intatta) per il percorso condiviso da reject/calendario/piano/API.
describe('deletePostCancellingZernio (cancel-before-delete)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  type DelOp = { table: string; kind: string; payload?: Record<string, unknown> };

  function deletionFake(post: Record<string, unknown> | null) {
    const ops: DelOp[] = [];
    function from(table: string) {
      let kind = 'select';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select() { return q; },
        insert(payload: Record<string, unknown>) { kind = 'insert'; ops.push({ table, kind, payload }); return q; },
        delete() { kind = 'delete'; ops.push({ table, kind }); return q; },
        update(payload: Record<string, unknown>) { kind = 'update'; ops.push({ table, kind, payload }); return q; },
        eq() { return q; },
        not() { return q; },
        async maybeSingle() { return { data: table === 'posts' ? post : null, error: null }; },
        then(resolve: (v: unknown) => void) {
          if (kind !== 'select') return Promise.resolve(resolve({ error: null }));
          const data = table === 'publish_logs' && post?.external_post_id
            ? [{ external_post_id: post.external_post_id }]
            : [];
          return Promise.resolve(resolve({ data, error: null }));
        }
      };
      return q;
    }
    return { client: { from } as never, ops };
  }

  const scheduledPost = {
    id: 'post-1', brand_id: 'b1', platform: 'instagram',
    status: 'scheduled', external_post_id: 'zernio-123'
  };

  it('editorActions.reject: cancels Zernio BEFORE deleting, and logs only after the real cancel', async () => {
    const { client, ops } = deletionFake(scheduledPost);
    zernio.deletePost.mockImplementation(async () => { ops.push({ table: 'zernio', kind: 'cancel' }); });
    zernio.getPostStatus.mockRejectedValue(new Error('Zernio 404: {"error":"post_not_found"}'));
    const form = new FormData();
    form.set('id', 'post-1');

    const pending = (editorActions.reject as never as (event: unknown) => Promise<unknown>)({
      request: new Request('https://example.test/app/brand/content?/reject', { method: 'POST', body: form }),
      locals: { supabase: client }
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ rejected: true });

    const cancelAt = ops.findIndex((o) => o.table === 'zernio');
    const logAt = ops.findIndex((o) => o.table === 'publish_logs' && o.kind === 'insert');
    const deleteAt = ops.findIndex((o) => o.table === 'posts' && o.kind === 'delete');
    expect(cancelAt).toBeGreaterThanOrEqual(0);
    expect(logAt).toBeGreaterThan(cancelAt);
    expect(deleteAt).toBeGreaterThan(logAt);
    expect(ops[logAt].payload?.status).toBe('canceled');
  });

  it('calendar/plan deletePost path: a failed cancel leaves the row — and writes NO canceled log', async () => {
    const { client, ops } = deletionFake(scheduledPost);
    zernio.deletePost.mockRejectedValue(new Error('Zernio delete post 503: upstream unavailable'));
    zernio.getPostStatus.mockResolvedValue({ status: 'scheduled', url: null, error: null, scheduledFor: null });

    const pending = deletePostCancellingZernio(client, 'post-1');
    await vi.runAllTimersAsync();
    const res = await pending;

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(502);
      expect(res.message).toContain('NOT deleted');
    }
    expect(ops.some((o) => o.table === 'posts' && o.kind === 'delete')).toBe(false);
    expect(ops.some((o) => o.table === 'publish_logs' && o.kind === 'insert')).toBe(false);
  });

  it('refuses to delete a published post (deleting cannot un-publish)', async () => {
    const { client, ops } = deletionFake({ ...scheduledPost, status: 'published' });

    const res = await deletePostCancellingZernio(client, 'post-1');

    expect(res).toEqual({ ok: false, status: 400, message: expect.stringContaining('published') });
    expect(zernio.deletePost).not.toHaveBeenCalled();
    expect(ops.some((o) => o.kind === 'delete')).toBe(false);
  });

  it('bulk/API path: pending_user is a plain delete — no Zernio call, no fake canceled log', async () => {
    const { client, ops } = deletionFake({ ...scheduledPost, status: 'pending_user', external_post_id: null });

    const res = await deletePostCancellingZernio(client, 'post-1', 'b1');

    expect(res).toEqual({ ok: true, wasScheduled: false });
    expect(zernio.deletePost).not.toHaveBeenCalled();
    expect(ops.some((o) => o.table === 'publish_logs' && o.kind === 'insert')).toBe(false);
    expect(ops.some((o) => o.table === 'posts' && o.kind === 'delete')).toBe(true);
  });
});
