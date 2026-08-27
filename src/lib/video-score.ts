/** Client-safe video QC badge. No server imports. */

export type VideoScoreVerdict = 'ship' | 'fix' | 'kill';
export type VideoScoreStatus = 'pending' | 'running' | 'ready' | 'failed';
export type VideoScoreStandard = 'organic' | 'ads';

export type VideoScoreIssue = {
  problem: string;
  fix: string;
};

export type VideoScoreBadge = {
  url: string;
  postId?: string | null;
  status: VideoScoreStatus;
  overall: number | null;
  verdict: VideoScoreVerdict | null;
  standard: VideoScoreStandard;
  /** One-paragraph why behind the score. */
  judgment?: string | null;
  /** Single-variable next test from the judge. */
  nextTest?: string | null;
  issues?: VideoScoreIssue[];
};

export type ReviewChatKind = 'apply' | 'hook' | 'reel' | 'visual';

export function formatVideoScore(overall: number): string {
  const n = Number(overall);
  if (!Number.isFinite(n)) return '–';
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function videoScoreTone(
  badge: Pick<VideoScoreBadge, 'status' | 'verdict'> | null | undefined
): 'ship' | 'fix' | 'kill' | 'pending' {
  if (!badge || badge.status === 'pending' || badge.status === 'running') return 'pending';
  if (badge.status === 'failed' || !badge.verdict) return 'pending';
  return badge.verdict;
}
