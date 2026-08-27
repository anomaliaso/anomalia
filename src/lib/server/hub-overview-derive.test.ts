import { describe, it, expect } from 'vitest';
import { derivePostCounts, deriveUpcomingBlogs } from './hub-overview';

// These two replace six PostgREST round trips (migration 0206). The risk of moving counting
// from SQL into JS is that a predicate quietly drifts from the one it replaced, so the tests
// below are written against the SQL they stand in for.

describe('derivePostCounts', () => {
  it('counts each status independently', () => {
    const c = derivePostCounts([
      { status: 'pending_user' },
      { status: 'pending_user' },
      { status: 'scheduled' },
      { status: 'published' },
      { status: 'published' },
      { status: 'published' }
    ]);
    expect(c).toEqual({ pending: 2, scheduled: 1, published: 3, radarReview: 0 });
  });

  it('ignores statuses Overview does not show', () => {
    const c = derivePostCounts([{ status: 'failed' }, { status: 'approved' }, { status: 'draft' }]);
    expect(c).toEqual({ pending: 0, scheduled: 0, published: 0, radarReview: 0 });
  });

  it('counts radar review as source=radar AND needs_attention AND status<>published', () => {
    const c = derivePostCounts([
      { status: 'pending_user', source: 'radar', needs_attention: true }, // counts
      { status: 'scheduled', source: 'radar', needs_attention: true }, // counts
      { status: 'published', source: 'radar', needs_attention: true }, // excluded: published
      { status: 'pending_user', source: 'radar', needs_attention: false }, // excluded: not flagged
      { status: 'pending_user', source: 'scheduler', needs_attention: true } // excluded: not radar
    ]);
    expect(c.radarReview).toBe(2);
  });

  it('treats a radar post as both pending and needing review — the two are separate figures', () => {
    const c = derivePostCounts([{ status: 'pending_user', source: 'radar', needs_attention: true }]);
    expect(c.pending).toBe(1);
    expect(c.radarReview).toBe(1);
  });

  it('does not count a truthy-but-not-true needs_attention', () => {
    // The SQL predicate is `needs_attention = true`; NULL must not pass.
    const c = derivePostCounts([
      { status: 'pending_user', source: 'radar', needs_attention: null },
      { status: 'pending_user', source: 'radar' }
    ]);
    expect(c.radarReview).toBe(0);
  });

  it('survives null/empty input', () => {
    expect(derivePostCounts(null)).toEqual({ pending: 0, scheduled: 0, published: 0, radarReview: 0 });
    expect(derivePostCounts([])).toEqual({ pending: 0, scheduled: 0, published: 0, radarReview: 0 });
  });
});

describe('deriveUpcomingBlogs', () => {
  const NOW = '2026-08-20T12:00:00.000Z';

  it('keeps only approved articles whose slot is still ahead', () => {
    const r = deriveUpcomingBlogs(
      [
        { id: 'a', status: 'approved', scheduled_for: '2026-08-21T09:00:00.000Z' },
        { id: 'b', status: 'approved', scheduled_for: '2026-08-19T09:00:00.000Z' }, // past
        { id: 'c', status: 'approved', scheduled_for: null }, // no slot
        { id: 'd', status: 'draft', scheduled_for: '2026-08-22T09:00:00.000Z' } // still needs a human
      ],
      NOW
    );
    expect(r.count).toBe(1);
    expect(r.previews.map((p) => p.id)).toEqual(['a']);
  });

  it('orders soonest first and caps the preview without capping the count', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`,
      status: 'approved',
      // descending input, so a stable-but-unsorted implementation would fail this
      scheduled_for: `2026-09-${String(28 - i).padStart(2, '0')}T09:00:00.000Z`
    }));
    const r = deriveUpcomingBlogs(rows, NOW);
    expect(r.count).toBe(8);
    expect(r.previews).toHaveLength(5);
    expect(r.previews.map((p) => p.id)).toEqual(['a7', 'a6', 'a5', 'a4', 'a3']);
  });

  it('maps cover_image onto cover_url and normalises missing fields', () => {
    const r = deriveUpcomingBlogs(
      [{ id: 'a', status: 'approved', scheduled_for: '2026-08-21T09:00:00.000Z', cover_image: '/x.png' }],
      NOW
    );
    expect(r.previews[0]).toEqual({
      id: 'a',
      title: null,
      cover_url: '/x.png',
      scheduled_for: '2026-08-21T09:00:00.000Z'
    });
  });

  it('treats a slot exactly at now as still upcoming, matching gte in SQL', () => {
    const r = deriveUpcomingBlogs([{ id: 'a', status: 'approved', scheduled_for: NOW }], NOW);
    expect(r.count).toBe(1);
  });

  it('survives null/empty input', () => {
    expect(deriveUpcomingBlogs(null, NOW)).toEqual({ count: 0, previews: [] });
  });
});
