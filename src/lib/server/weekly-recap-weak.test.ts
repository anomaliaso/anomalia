import { describe, expect, it } from 'vitest';
import { pickWeakMediaReviews, WEAK_MEDIA_REVIEW_LIMIT } from './weekly-recap';

function row(
  over: Partial<{
    post_id: string | null;
    overall: number | null;
    verdict: string | null;
    kind: string | null;
    judgment: string | null;
    status: string | null;
  }> = {}
) {
  return {
    post_id: 'p1',
    overall: 4,
    verdict: 'fix',
    kind: 'video',
    judgment: 'Hook is weak',
    status: 'ready',
    ...over
  };
}

describe('pickWeakMediaReviews', () => {
  it('skips rows without a post_id', () => {
    expect(pickWeakMediaReviews([row({ post_id: null }), row({ post_id: '' })])).toEqual([]);
  });

  it('skips non-ready rows', () => {
    expect(pickWeakMediaReviews([row({ status: 'pending' }), row({ status: 'failed' })])).toEqual([]);
  });

  it('skips ship scores at or above 6', () => {
    expect(pickWeakMediaReviews([row({ overall: 6, verdict: 'ship' })])).toEqual([]);
    expect(pickWeakMediaReviews([row({ overall: 8.2, verdict: 'ship' })])).toEqual([]);
  });

  it('includes ship scores below 6', () => {
    const out = pickWeakMediaReviews([row({ overall: 5.9, verdict: 'ship' })]);
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe('ship');
    expect(out[0].overall).toBe(5.9);
  });

  it('includes fix/kill even with a high score', () => {
    const out = pickWeakMediaReviews([
      row({ post_id: 'a', overall: 8, verdict: 'fix' }),
      row({ post_id: 'b', overall: 9, verdict: 'kill' })
    ]);
    expect(out.map((r) => r.postId).sort()).toEqual(['a', 'b']);
  });

  it('keeps the lowest score when a post has organic + ads reviews', () => {
    const out = pickWeakMediaReviews([
      row({ post_id: 'p1', overall: 5.4, verdict: 'fix', kind: 'video' }),
      row({ post_id: 'p1', overall: 3.1, verdict: 'kill', kind: 'video' })
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].overall).toBe(3.1);
    expect(out[0].verdict).toBe('kill');
  });

  it('caps at 3, lowest score first', () => {
    const out = pickWeakMediaReviews([
      row({ post_id: 'a', overall: 4, verdict: 'fix' }),
      row({ post_id: 'b', overall: 2, verdict: 'kill' }),
      row({ post_id: 'c', overall: 5, verdict: 'ship' }),
      row({ post_id: 'd', overall: 3, verdict: 'fix' })
    ]);
    expect(out).toHaveLength(WEAK_MEDIA_REVIEW_LIMIT);
    expect(out.map((r) => r.postId)).toEqual(['b', 'd', 'a']);
  });

  it('treats unknown verdict as weak only when the score is below 6', () => {
    expect(pickWeakMediaReviews([row({ overall: 8, verdict: 'maybe' })])).toEqual([]);
    const out = pickWeakMediaReviews([row({ overall: 4, verdict: 'maybe' })]);
    expect(out).toHaveLength(1);
    expect(out[0].verdict).toBe('fix');
  });

  it('attaches captions from the map', () => {
    const out = pickWeakMediaReviews(
      [row({ post_id: 'p1' })],
      new Map([['p1', 'Hello from the caption']])
    );
    expect(out[0].caption).toBe('Hello from the caption');
  });
});
