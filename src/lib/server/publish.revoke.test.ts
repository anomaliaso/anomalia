import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revokePublishedPost } from './publish';
import { deletePost } from './zernio';

vi.mock('./zernio', () => ({ deletePost: vi.fn() }));

const deletePostMock = vi.mocked(deletePost);

type Row = Record<string, unknown>;
type Update = { table: string; payload: Row; filters: Array<[string, unknown]> };

/** Chainable fake supabase: publishes `logs` from the publish_logs select, captures every update. */
function fakeSupabase(logs: Row[]) {
  const updates: Update[] = [];
  const thenable = (table: string, payload: Row) => {
    const filters: Array<[string, unknown]> = [];
    const b = {
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push([col, vals]);
        return b;
      },
      then: (resolve: (v: { error: null }) => void) => {
        updates.push({ table, payload, filters: [...filters] });
        return resolve({ error: null });
      }
    };
    return b;
  };
  const builder = (table: string) => {
    const b = {
      select: () => b,
      eq: () => b,
      not: () => b,
      in: () => b,
      update: (payload: Row) => thenable(table, payload),
      then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: logs, error: null })
    };
    return b;
  };
  return {
    client: { from: (table: string) => builder(table) } as unknown as SupabaseClient,
    updates
  };
}

const LIVE_LOGS: Row[] = [
  { id: 'log-1', external_post_id: 'zernio-1' },
  { id: 'log-2', external_post_id: 'zernio-2' }
];

beforeEach(() => {
  deletePostMock.mockReset();
});

describe('revokePublishedPost', () => {
  it('revokes a published post: deletes Zernio copies, resets to pending_user, marks logs revoked', async () => {
    const { client, updates } = fakeSupabase(LIVE_LOGS);

    const res = await revokePublishedPost(client, { id: 'post-1', status: 'published' });

    expect(res).toEqual({ ok: true, status: 'pending_user', deleted: 2, failed: [] });
    expect(deletePostMock).toHaveBeenCalledTimes(2);
    expect(deletePostMock).toHaveBeenCalledWith('zernio-1');
    expect(deletePostMock).toHaveBeenCalledWith('zernio-2');

    const postUpdate = updates.find((u) => u.table === 'posts');
    expect(postUpdate?.payload.status).toBe('pending_user');
    expect(postUpdate?.payload.external_post_id).toBeNull();
    expect(postUpdate?.payload.published_url).toBeNull();
    expect(typeof postUpdate?.payload.revoked_at).toBe('string');
    expect(postUpdate?.filters).toEqual([['id', 'post-1']]);

    const logUpdate = updates.find((u) => u.table === 'publish_logs');
    expect(logUpdate?.payload.status).toBe('revoked');
    expect(logUpdate?.filters).toContainEqual(['post_id', 'post-1']);
  });

  it('also revokes a scheduled post', async () => {
    const { client } = fakeSupabase(LIVE_LOGS);
    const res = await revokePublishedPost(client, { id: 'post-1', status: 'scheduled' });
    expect(res.ok).toBe(true);
    expect(deletePostMock).toHaveBeenCalledTimes(2);
  });

  it('records the reason on the publish_logs rows when provided', async () => {
    const { client, updates } = fakeSupabase(LIVE_LOGS);
    await revokePublishedPost(client, { id: 'post-1', status: 'published' }, { reason: 'wrong image' });
    const logUpdate = updates.find((u) => u.table === 'publish_logs');
    expect(logUpdate?.payload.error).toBe('Revoked by user: wrong image');
  });

  it('keeps revoking when a Zernio delete fails (best-effort per account)', async () => {
    deletePostMock.mockRejectedValueOnce(new Error('Zernio delete post 500'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, updates } = fakeSupabase(LIVE_LOGS);

    const res = await revokePublishedPost(client, { id: 'post-1', status: 'published' });

    expect(res.ok).toBe(true);
    expect(deletePostMock).toHaveBeenCalledTimes(2);
    expect(updates.find((u) => u.table === 'posts')?.payload.status).toBe('pending_user');
    warn.mockRestore();
  });

  it('rejects a pending_user post with not_publishable and touches nothing', async () => {
    const { client, updates } = fakeSupabase(LIVE_LOGS);

    const res = await revokePublishedPost(client, { id: 'post-1', status: 'pending_user' });

    expect(res).toEqual({ ok: false, error: 'not_publishable' });
    expect(deletePostMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('rejects unknown/absent statuses too', async () => {
    const { client } = fakeSupabase(LIVE_LOGS);
    expect((await revokePublishedPost(client, { id: 'p', status: null })).ok).toBe(false);
    expect((await revokePublishedPost(client, { id: 'p', status: 'failed' })).ok).toBe(false);
    expect(deletePostMock).not.toHaveBeenCalled();
  });
});
