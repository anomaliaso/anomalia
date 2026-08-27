// Rank-delta helpers for the weekly recap's web/rank KPIs (P4). Pure, unit-tested, no I/O.
//
// Conventions (documented for both callers and the email copy):
// - A keyword with no snapshot in the window — or a snapshot whose position is null — is
//   "not found in the top-100 SERP", which we score as position 101 (one past the cutoff).
// - Before the FIRST snapshot ever existed the keyword is assumed to be at 101, so a keyword
//   that just entered the top 100 counts as an improvement: delta = 101 - position.
// - delta = first - last, positive = improved (moved UP the rankings).

export const NOT_FOUND_POSITION = 101;

export type RankSnapshot = {
  tracked_keyword_id: string;
  position: number | null;
  checked_at: string;
};

export type RankDelta = {
  /** Effective position at the start of the window (raw ?? 101; 101 for the pre-first-snapshot state). */
  first: number | null;
  /** Effective position at the end of the window (raw ?? 101). */
  last: number | null;
  /** first - last; positive = improved. Null only when there is no snapshot at all. */
  delta: number | null;
  /** Days actually covered between the first and last snapshot (0 when < 2 snapshots). */
  windowDays: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Simple rule: compare the first and last snapshot available, even when they are close
 * together — the `windowDays` option is only the nominal window the caller claims to report
 * over; the returned `windowDays` is the span the data actually covers (capped at the
 * nominal window). A single snapshot compares against the implicit not-found state (101).
 */
export function computeRankDelta(
  snapshots: RankSnapshot[],
  opts: { windowDays?: number } = {}
): RankDelta {
  const maxWindow = opts.windowDays ?? 30;
  const ordered = [...snapshots]
    .filter((s) => s.checked_at)
    .sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at));
  if (!ordered.length) return { first: null, last: null, delta: null, windowDays: 0 };

  const eff = (p: number | null | undefined): number =>
    p == null ? NOT_FOUND_POSITION : p;

  // One snapshot: the keyword was not found before it — first is the documented 101 baseline.
  if (ordered.length === 1) {
    const only = ordered[0];
    const last = eff(only.position);
    return { first: NOT_FOUND_POSITION, last, delta: NOT_FOUND_POSITION - last, windowDays: 0 };
  }

  const first = eff(ordered[0].position);
  const last = eff(ordered[ordered.length - 1].position);
  const actualDays = Math.max(
    0,
    Math.round(
      (Date.parse(ordered[ordered.length - 1].checked_at) -
        Date.parse(ordered[0].checked_at)) /
        DAY_MS
    )
  );
  return {
    first,
    last,
    delta: first - last,
    windowDays: Math.min(actualDays, maxWindow)
  };
}

export type KeywordSnapshots = {
  tracked_keyword_id: string;
  keyword: string;
  snapshots: RankSnapshot[];
};

export type WebKpis = {
  /** Keywords with at least one snapshot in the fetched window (i.e. with rank data). */
  tracked: number;
  /** Keywords whose position improved (delta > 0). */
  improved: number;
  /** Keywords whose position worsened (delta < 0). */
  worsened: number;
  /** Top 5 improved keywords, best mover first. */
  improvedList: string[];
};

export function buildWebKpis(snapshotsByKeyword: KeywordSnapshots[]): WebKpis {
  const deltas: { keyword: string; delta: number }[] = [];
  let tracked = 0;
  for (const k of snapshotsByKeyword) {
    if (!k.snapshots.length) continue;
    tracked += 1;
    const d = computeRankDelta(k.snapshots).delta;
    if (d == null) continue;
    deltas.push({ keyword: k.keyword, delta: d });
  }
  return {
    tracked,
    improved: deltas.filter((d) => d.delta > 0).length,
    worsened: deltas.filter((d) => d.delta < 0).length,
    improvedList: deltas
      .filter((d) => d.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5)
      .map((d) => d.keyword)
  };
}
