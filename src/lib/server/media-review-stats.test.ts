import { describe, expect, it } from 'vitest';
import { summarizeMediaReviewRows } from './media-review-stats';

function row(
  over: Partial<{
    post_id: string | null;
    overall: number | null;
    verdict: string | null;
    judgment: string | null;
    status: string | null;
  }> = {}
) {
  return {
    post_id: 'p1',
    overall: 4,
    verdict: 'fix',
    judgment: 'Hook is weak',
    status: 'ready',
    ...over
  };
}

describe('summarizeMediaReviewRows', () => {
  it('counts unique posts and verdicts', () => {
    const s = summarizeMediaReviewRows([
      row({ post_id: 'a', overall: 8, verdict: 'ship' }),
      row({ post_id: 'b', overall: 4, verdict: 'fix' }),
      row({ post_id: 'c', overall: 2, verdict: 'kill' })
    ]);
    expect(s.scored).toBe(3);
    expect(s.ship).toBe(1);
    expect(s.fix).toBe(1);
    expect(s.kill).toBe(1);
    expect(s.weak).toBe(2);
    expect(s.avg).toBe(4.7);
  });

  it('keeps the lower score when a post has two reviews', () => {
    const s = summarizeMediaReviewRows([
      row({ post_id: 'p1', overall: 7, verdict: 'ship' }),
      row({ post_id: 'p1', overall: 3, verdict: 'kill' })
    ]);
    expect(s.scored).toBe(1);
    expect(s.kill).toBe(1);
    expect(s.weak).toBe(1);
    expect(s.avg).toBe(3);
  });

  it('buckets scores and lists weakest first', () => {
    const s = summarizeMediaReviewRows([
      row({ post_id: 'a', overall: 3.2, verdict: 'kill' }),
      row({ post_id: 'b', overall: 5.1, verdict: 'fix' }),
      row({ post_id: 'c', overall: 6.4, verdict: 'ship' }),
      row({ post_id: 'd', overall: 9, verdict: 'ship' })
    ]);
    expect(s.buckets).toEqual({ lt4: 1, lt6: 1, lt8: 1, high: 1 });
    expect(s.weakest.map((w) => w.postId)).toEqual(['a', 'b']);
  });

  it('counts pending and failed separately from scored', () => {
    const s = summarizeMediaReviewRows([
      row({ status: 'pending' }),
      row({ status: 'running' }),
      row({ status: 'failed' }),
      row({ post_id: 'ok', overall: 8, verdict: 'ship' })
    ]);
    expect(s.pending).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.scored).toBe(1);
  });

  it('treats ship below 6 as weak', () => {
    const s = summarizeMediaReviewRows([row({ overall: 5.5, verdict: 'ship' })]);
    expect(s.ship).toBe(1);
    expect(s.weak).toBe(1);
  });
});
