import { describe, expect, it } from 'vitest';
import { buildWebKpis, computeRankDelta, NOT_FOUND_POSITION, type RankSnapshot } from './rank-delta';

const snap = (position: number | null, checked_at: string): RankSnapshot => ({
  tracked_keyword_id: 'k1',
  position,
  checked_at
});

describe('computeRankDelta', () => {
  it('returns nulls when there are no snapshots', () => {
    expect(computeRankDelta([])).toEqual({ first: null, last: null, delta: null, windowDays: 0 });
  });

  it('computes a positive delta when the keyword improved', () => {
    const d = computeRankDelta([
      snap(10, '2026-07-01T08:00:00Z'),
      snap(3, '2026-07-29T08:00:00Z')
    ]);
    expect(d.first).toBe(10);
    expect(d.last).toBe(3);
    expect(d.delta).toBe(7); // first - last, positive = improved
    expect(d.windowDays).toBe(28);
  });

  it('computes a negative delta when the keyword worsened', () => {
    const d = computeRankDelta([
      snap(3, '2026-07-01T08:00:00Z'),
      snap(12, '2026-07-29T08:00:00Z')
    ]);
    expect(d.delta).toBe(-9);
  });

  it('uses first and last snapshot even when close together, reporting the covered window', () => {
    const d = computeRankDelta([
      snap(5, '2026-07-01T08:00:00Z'),
      snap(4, '2026-07-02T08:00:00Z')
    ]);
    expect(d.delta).toBe(1);
    expect(d.windowDays).toBe(1);
  });

  it('uses the not-found convention (101) before the first snapshot', () => {
    const d = computeRankDelta([snap(31, '2026-07-29T08:00:00Z')]);
    expect(d.first).toBe(NOT_FOUND_POSITION);
    expect(d.last).toBe(31);
    expect(d.delta).toBe(NOT_FOUND_POSITION - 31);
  });

  it('treats a null position as not found (101)', () => {
    const d = computeRankDelta([
      snap(null, '2026-07-01T08:00:00Z'),
      snap(8, '2026-07-29T08:00:00Z')
    ]);
    expect(d.delta).toBe(NOT_FOUND_POSITION - 8);
  });
});

describe('buildWebKpis', () => {
  const kw = (
    id: string,
    keyword: string,
    snapshots: RankSnapshot[]
  ): { tracked_keyword_id: string; keyword: string; snapshots: RankSnapshot[] } => ({
    tracked_keyword_id: id,
    keyword,
    snapshots
  });

  it('counts improved/worsened and lists top 5 improved keywords by delta', () => {
    const by = [
      kw('a', 'acme pricing', [snap(20, '2026-07-01T00:00:00Z'), snap(4, '2026-07-29T00:00:00Z')]),
      kw('b', 'acme reviews', [snap(5, '2026-07-01T00:00:00Z'), snap(15, '2026-07-29T00:00:00Z')]),
      // not found → top 100: +89
      kw('c', 'acme alternatives', [snap(null, '2026-07-01T00:00:00Z'), snap(12, '2026-07-29T00:00:00Z')]),
      // single snapshot: enters top 100 from the 101 baseline: +71
      kw('e', 'acme login', [snap(30, '2026-07-29T00:00:00Z')]),
      // no snapshots: not counted as tracked
      kw('d', 'acme blog', [])
    ];
    const k = buildWebKpis(by);
    expect(k.tracked).toBe(4);
    expect(k.improved).toBe(3);
    expect(k.worsened).toBe(1);
    expect(k.improvedList).toEqual(['acme alternatives', 'acme login', 'acme pricing']);
  });

  it('returns zeros when nothing is tracked', () => {
    expect(buildWebKpis([])).toEqual({ tracked: 0, improved: 0, worsened: 0, improvedList: [] });
  });
});
