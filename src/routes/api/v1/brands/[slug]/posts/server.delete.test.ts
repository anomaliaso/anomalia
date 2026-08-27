import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il bulk-delete della CLI (`DELETE /posts?status=`): per scheduled/approved ogni post deve
 * passare dalla revoca Zernio prima della delete (classe incidente scheduling luglio 2026);
 * chi non si riesce a revocare resta nel DB e viene riportato, non eliminato alla cieca.
 */

const deletePostCancellingZernio = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
  authenticate: vi.fn(),
  loadBrandForUser: vi.fn(),
  checkApiKeyWriteAccess: vi.fn(() => null)
}));
vi.mock('$lib/server/cli-queries', () => ({ getPosts: vi.fn() }));
vi.mock('$lib/server/post-editing', () => ({
  deletePostCancellingZernio: (...args: unknown[]) => deletePostCancellingZernio(...args)
}));

import { DELETE } from './+server';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

type Op = { table: string; kind: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSupabase(rows: Record<string, unknown[]>): { client: any; ops: Op[] } {
  const ops: Op[] = [];
  const client = {
    from(table: string) {
      let kind = 'select';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        delete: () => { kind = 'delete'; ops.push({ table, kind }); return q; },
        eq: () => q,
        then(resolve: (v: unknown) => void) {
          return Promise.resolve(resolve({ data: rows[table] ?? [], error: null }));
        }
      };
      return q;
    }
  };
  return { client, ops };
}

beforeEach(() => vi.clearAllMocks());

describe('DELETE /api/v1/brands/:slug/posts?status=scheduled', () => {
  it('cancels Zernio per post, keeps the uncancellable ones and answers 502 with the survivors', async () => {
    const { client, ops } = fakeSupabase({ posts: [{ id: 'p1' }, { id: 'p2' }] });
    vi.mocked(authenticate).mockResolvedValue({ supabase: client, apiKey: null, error: null } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);
    deletePostCancellingZernio
      .mockResolvedValueOnce({ ok: true, wasScheduled: true })
      .mockResolvedValueOnce({ ok: false, status: 502, message: 'the post was NOT deleted: still live' });

    const res = await (DELETE as (event: unknown) => Promise<Response>)({
      request: new Request('https://example.test/api/v1/brands/b/posts?status=scheduled', { method: 'DELETE' }),
      params: { slug: 'b' },
      url: new URL('https://example.test/api/v1/brands/b/posts?status=scheduled')
    });
    const body = await res.json();

    expect(deletePostCancellingZernio).toHaveBeenCalledTimes(2);
    expect(deletePostCancellingZernio).toHaveBeenNthCalledWith(1, client, 'p1', 'brand-1');
    expect(res.status).toBe(502);
    expect(body.deleted).toBe(1);
    expect(body.failed).toEqual([{ id: 'p2', error: expect.stringContaining('NOT deleted') }]);
    // Nessuna delete di massa per gli scheduled: passano tutti dal helper, uno a uno.
    expect(ops.filter((o) => o.kind === 'delete')).toEqual([]);
  });

  it('still bulk-deletes pending_user directly (draft-only, no live schedule to revoke)', async () => {
    const { client, ops } = fakeSupabase({ posts: [{ id: 'p1' }] });
    vi.mocked(authenticate).mockResolvedValue({ supabase: client, apiKey: null, error: null } as never);
    vi.mocked(loadBrandForUser).mockResolvedValue({ brand: { id: 'brand-1' }, error: null } as never);

    const res = await (DELETE as (event: unknown) => Promise<Response>)({
      request: new Request('https://example.test/api/v1/brands/b/posts', { method: 'DELETE' }),
      params: { slug: 'b' },
      url: new URL('https://example.test/api/v1/brands/b/posts')
    });
    const body = await res.json();

    expect(deletePostCancellingZernio).not.toHaveBeenCalled();
    expect(ops.filter((o) => o.kind === 'delete')).toEqual([{ table: 'posts', kind: 'delete' }]);
    expect(body).toEqual({ ok: true, deleted: 1 });
  });
});
