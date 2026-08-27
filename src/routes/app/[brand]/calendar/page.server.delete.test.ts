import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Il cablaggio del calendario sulla delete sicura: deletePost e deleteSelected devono passare
 * da deletePostCancellingZernio (revoca Zernio PRIMA della riga — classe incidente scheduling
 * luglio 2026), e un fallimento di revoca deve arrivare all'utente, non sparire.
 */

const deletePostCancellingZernio = vi.fn();

vi.mock('$lib/server/post-editing', () => ({
  EDITOR_POST_COLS: 'id, status',
  decoratePosts: (p: unknown) => p,
  buildBusyDays: () => [],
  deletePostCancellingZernio: (...args: unknown[]) => deletePostCancellingZernio(...args),
  editorActions: {}
}));
vi.mock('$lib/server/publish', () => ({ publishApprovedPost: vi.fn(), syncDuePosts: vi.fn() }));
vi.mock('$lib/server/usage', () => ({ remaining: vi.fn() }));
vi.mock('$lib/server/token', () => ({ signApproveToken: vi.fn() }));
vi.mock('$lib/server/email', () => ({
  sendEmail: vi.fn(), approvalEmailHtml: vi.fn(), approvalEmailText: vi.fn(), approvalEmailSubject: vi.fn()
}));
vi.mock('$lib/server/video-requests', () => ({ founderVideoBudget: vi.fn(), listVideoRequests: vi.fn() }));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('$lib/server/video-review-store', () => ({ loadVideoScoreBadges: vi.fn(), mediaUrlHash: vi.fn() }));
vi.mock('$lib/server/page-cache', () => ({ cachedBrandPage: vi.fn() }));

import { actions } from './+page.server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSupabase(rows: Record<string, unknown>): any {
  return {
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        async maybeSingle() { return { data: rows[table] ?? null, error: null }; },
        then(resolve: (v: unknown) => void) {
          return Promise.resolve(resolve({ data: rows[table] ?? [], error: null }));
        }
      };
      return q;
    }
  };
}

function post(action: unknown, fields: Record<string, string>, supabase: unknown) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return (action as (event: unknown) => Promise<unknown>)({
    request: new Request('https://example.test/app/b/calendar', { method: 'POST', body: form }),
    params: { brand: 'b' },
    locals: { supabase }
  });
}

beforeEach(() => vi.clearAllMocks());

describe('calendar deletePost', () => {
  it('routes through the Zernio-cancelling delete and surfaces a failed cancel (row kept)', async () => {
    deletePostCancellingZernio.mockResolvedValue({
      ok: false, status: 502, message: 'Could not cancel the live schedule — the post was NOT deleted: boom'
    });

    const res = await post(actions.deletePost, { id: 'post-1' }, fakeSupabase({})) as
      { status: number; data: { error: string } };

    expect(deletePostCancellingZernio).toHaveBeenCalledWith(expect.anything(), 'post-1');
    expect(res.status).toBe(502);
    expect(res.data.error).toContain('NOT deleted');
  });
});

describe('calendar deleteSelected', () => {
  it('deletes each post via the cancelling helper and reports partial failures instead of ghosting them', async () => {
    const supabase = fakeSupabase({
      brands: { id: 'brand-1' },
      posts: [{ id: 'p1' }, { id: 'p2' }]
    });
    deletePostCancellingZernio
      .mockResolvedValueOnce({ ok: true, wasScheduled: true })
      .mockResolvedValueOnce({ ok: false, status: 502, message: 'the post was NOT deleted: still live' });

    const res = await post(actions.deleteSelected, { ids: 'p1,p2' }, supabase) as
      { status: number; data: { error: string; deletedSelected: number } };

    expect(deletePostCancellingZernio).toHaveBeenCalledTimes(2);
    expect(deletePostCancellingZernio).toHaveBeenNthCalledWith(1, expect.anything(), 'p1', 'brand-1');
    expect(res.status).toBe(502);
    expect(res.data.deletedSelected).toBe(1);
    expect(res.data.error).toContain('NOT deleted');
  });
});
