import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('$lib/server/zernio', () => ({ deletePost: vi.fn(), getPostStatus: vi.fn() }));
vi.mock('$lib/server/brand-memory', () => ({ learnFromCaptionEdit: vi.fn(async () => {}) }));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }) }) }));

import { applyPostEdits, deletePostCancellingZernio } from '$lib/server/post-editing';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { brandOwnerId, recordPostVerdict } from '$lib/server/post-verdict';

type Row = Record<string, unknown>;

/**
 * Finto supabase che risponde con la riga chiesta e RACCOGLIE gli insert: il verdetto è una riga
 * nuova, quindi è l'insert — non l'update — a dire se il segnale è stato registrato.
 */
function fakeSupabase(rows: Record<string, Row | null> = {}) {
  const inserted: Array<{ table: string; payload: Row }> = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'not', 'or', 'order', 'limit', 'update', 'delete']) {
      b[m] = () => b;
    }
    b.insert = (payload: Row | Row[]) => {
      for (const row of Array.isArray(payload) ? payload : [payload]) inserted.push({ table, payload: row });
      return { then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }) };
    };
    b.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
    b.single = async () => ({ data: rows[table] ?? null, error: null });
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null });
    return b;
  };
  return { client: { from: builder } as unknown as SupabaseClient, inserted };
}

const verdicts = (inserted: Array<{ table: string; payload: Row }>) =>
  inserted.filter((i) => i.table === 'post_verdicts').map((i) => i.payload);

const approvable = (over: Partial<ApprovablePost> = {}): ApprovablePost => ({
  id: 'p1',
  brand_id: 'b1',
  platform: 'instagram',
  caption: 'Una caption vera che non è un segnaposto.',
  media_url: 'https://cdn.test/img.jpg',
  slot: 'monday-09:00',
  scheduled_for: null,
  content_type: 'image',
  ...over
});

beforeEach(() => vi.clearAllMocks());

describe('recordPostVerdict', () => {
  it('writes one row naming the post, the brand, the person and the verdict', async () => {
    const { client, inserted } = fakeSupabase();

    await recordPostVerdict(client, {
      postId: 'p1',
      brandId: 'b1',
      actorId: 'u1',
      verdict: 'approved'
    });

    expect(verdicts(inserted)).toEqual([
      {
        post_id: 'p1',
        brand_id: 'b1',
        user_id: 'u1',
        verdict: 'approved',
        caption_before: null,
        caption_after: null
      }
    ]);
  });

  it('keeps the before→after pair of an edit — the difference is the signal', async () => {
    const { client, inserted } = fakeSupabase();

    await recordPostVerdict(client, {
      postId: 'p1',
      brandId: 'b1',
      actorId: 'u1',
      verdict: 'edited',
      captionBefore: 'Quello che abbiamo scritto noi.',
      captionAfter: 'Quello che pubblica lui.'
    });

    expect(verdicts(inserted)[0]).toMatchObject({
      verdict: 'edited',
      caption_before: 'Quello che abbiamo scritto noi.',
      caption_after: 'Quello che pubblica lui.'
    });
  });
});

describe('brandOwnerId', () => {
  it('resolves brand → org → owner, so an email approval has a person behind it', async () => {
    const { client } = fakeSupabase({ brands: { org_id: 'o1' }, organizations: { owner_id: 'u9' } });

    await expect(brandOwnerId(client, 'b1')).resolves.toBe('u9');
  });

  it('returns null when the brand has no organisation', async () => {
    const { client } = fakeSupabase({ brands: null });

    await expect(brandOwnerId(client, 'b1')).resolves.toBeNull();
  });
});

describe('il verdetto passa dalle strozzature condivise', () => {
  it('approving a draft records "approved" for that person', async () => {
    const { client, inserted } = fakeSupabase({ posts: { video_render_status: null, status: 'pending_user', brand_id: 'b1' } });

    await publishApprovedPost(client, approvable(), 'Europe/Rome', { by: 'u1' });

    expect(verdicts(inserted)).toEqual([
      expect.objectContaining({ post_id: 'p1', brand_id: 'b1', user_id: 'u1', verdict: 'approved' })
    ]);
  });

  it('records nothing when the autopilot publishes: no person, no verdict', async () => {
    const { client, inserted } = fakeSupabase({ posts: { video_render_status: null, status: 'pending_user', brand_id: 'b1' } });

    await publishApprovedPost(client, approvable(), 'Europe/Rome');

    expect(verdicts(inserted)).toEqual([]);
  });

  it('records nothing when the post was not a draft: a reschedule is not an approval', async () => {
    const { client, inserted } = fakeSupabase({ posts: { video_render_status: null, status: 'scheduled', brand_id: 'b1' } });

    await publishApprovedPost(client, approvable(), 'Europe/Rome', { by: 'u1' });

    expect(verdicts(inserted)).toEqual([]);
  });

  it('editing the caption records "edited" with what we wrote and what the user wrote', async () => {
    const { client, inserted } = fakeSupabase({
      posts: { brand_id: 'b1', caption: 'Quello che abbiamo scritto noi.', source: 'plan', media_url: null, media_urls: null }
    });

    await applyPostEdits(client, 'p1', { caption: 'Quello che pubblica lui.' }, { by: 'u1' });

    expect(verdicts(inserted)).toEqual([
      expect.objectContaining({
        verdict: 'edited',
        caption_before: 'Quello che abbiamo scritto noi.',
        caption_after: 'Quello che pubblica lui.'
      })
    ]);
  });

  it('records nothing when the edit leaves the caption alone', async () => {
    const { client, inserted } = fakeSupabase({
      posts: { brand_id: 'b1', caption: 'Identica.', source: 'plan', media_url: null, media_urls: null }
    });

    await applyPostEdits(client, 'p1', { caption: 'Identica.' }, { by: 'u1' });

    expect(verdicts(inserted)).toEqual([]);
  });

  it('discarding a draft records "discarded" — the row dies, the verdict does not', async () => {
    const { client, inserted } = fakeSupabase({
      posts: { id: 'p1', brand_id: 'b1', platform: 'instagram', status: 'pending_user' }
    });

    const res = await deletePostCancellingZernio(client, 'p1', undefined, 'u1');

    expect(res).toEqual({ ok: true, wasScheduled: false });
    expect(verdicts(inserted)).toEqual([
      expect.objectContaining({ post_id: 'p1', brand_id: 'b1', user_id: 'u1', verdict: 'discarded' })
    ]);
  });
});
