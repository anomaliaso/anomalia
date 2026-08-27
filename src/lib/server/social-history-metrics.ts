// Aggregate engagement from social_post_history.
//
// This module never queries the table — callers pass rows. Rows can come from scrapecreators
// (organic scrape) and zernio (Anomalia-published analytics). The same Instagram post often exists
// twice with different external_post_id values — we dedupe by platform URL shortcode (or
// published_at+content) and prefer zernio, which carries views/impressions that scrapecreators
// Instagram does not.
//
// LEARNING-POINT CONTRACT: AI learning points (winning patterns, history digest, recap engagement)
// must pass ONLY zernio rows (source='zernio', see own-post-history.ts). scrapecreators rows are
// pre-app/competitor data, not the brand's current performance — callers of this module that feed
// the AI should filter source='zernio' at query time. The dedupe below stays a general utility
// (e.g. for the analytics page, which intentionally shows the full merged picture).

export type HistoryMetricKey = 'views' | 'likes' | 'comments' | 'shares';

export type SocialHistoryRow = {
  id?: string;
  source?: string | null;
  platform?: string | null;
  platform_post_url?: string | null;
  content?: string | null;
  published_at?: string | null;
  thumbnail_url?: string | null;
  /** Archived copy in brand-knowledge — prefer signed URL over expired CDN thumbnail_url. */
  thumbnail_path?: string | null;
  metrics?: Record<string, unknown> | null;
};

export const metricNum = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/** Prefer a stable public shortcode/id from the platform URL when present. */
export function historyDedupeKey(row: SocialHistoryRow): string {
  const platform = (row.platform ?? 'other').toLowerCase();
  const url = (row.platform_post_url ?? '').trim();
  if (url) {
    try {
      const path = new URL(url).pathname;
      const m =
        path.match(/\/(?:p|reel|tv|status|posts|videos)\/([^/?#]+)/i) ||
        path.match(/\/([^/?#]+)\/?$/);
      if (m?.[1]) return `${platform}:${m[1].toLowerCase()}`;
    } catch {
      /* fall through */
    }
  }
  const published = row.published_at ?? '';
  const content = (row.content ?? '').slice(0, 48).toLowerCase();
  return `${platform}:${published}:${content}`;
}

const SOURCE_RANK: Record<string, number> = { zernio: 2, scrapecreators: 1 };

/** Fill blank media/content fields on the winner from the other row (zernio often has metrics but no thumb). */
function mergeHistoryFields(winner: SocialHistoryRow, other: SocialHistoryRow): SocialHistoryRow {
  return {
    ...winner,
    thumbnail_url: winner.thumbnail_url || other.thumbnail_url || null,
    thumbnail_path: winner.thumbnail_path || other.thumbnail_path || null,
    content: winner.content || other.content || null,
    platform_post_url: winner.platform_post_url || other.platform_post_url || null,
    published_at: winner.published_at || other.published_at || null
  };
}

/** Keep one row per logical post. Zernio wins (richer metrics); otherwise keep the higher-engagement row. */
export function dedupeSocialHistory(rows: SocialHistoryRow[]): SocialHistoryRow[] {
  const best = new Map<string, SocialHistoryRow>();
  for (const row of rows) {
    const key = historyDedupeKey(row);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, row);
      continue;
    }
    const prevRank = SOURCE_RANK[String(prev.source ?? '')] ?? 0;
    const nextRank = SOURCE_RANK[String(row.source ?? '')] ?? 0;
    if (nextRank > prevRank) {
      best.set(key, mergeHistoryFields(row, prev));
      continue;
    }
    if (nextRank < prevRank) {
      best.set(key, mergeHistoryFields(prev, row));
      continue;
    }
    const prevScore =
      metricNum(prev.metrics?.likes) +
      metricNum(prev.metrics?.comments) +
      metricNum(prev.metrics?.views);
    const nextScore =
      metricNum(row.metrics?.likes) +
      metricNum(row.metrics?.comments) +
      metricNum(row.metrics?.views);
    if (nextScore > prevScore) best.set(key, mergeHistoryFields(row, prev));
    else best.set(key, mergeHistoryFields(prev, row));
  }
  return [...best.values()];
}

export type RecentEngagement = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** Last 7 calendar days, oldest → newest (by published_at). */
  viewsByDay: number[];
  likesByDay: number[];
  posts: number;
};

/**
 * Sum lifetime metrics on posts published in the lookback window, and build a 7-day
 * publish-day sparkline. Metrics are snapshots (not deltas) — we do not store daily
 * engagement series, so "7d/30d" means "on posts published in that window".
 */
export function aggregateRecentEngagement(
  rows: SocialHistoryRow[],
  opts: { sparkDays?: number; now?: Date } = {}
): RecentEngagement {
  const sparkDays = opts.sparkDays ?? 7;
  const now = opts.now ?? new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const oldestSpark = startOfToday.getTime() - (sparkDays - 1) * dayMs;

  const deduped = dedupeSocialHistory(rows);
  const viewsByDay = Array.from({ length: sparkDays }, () => 0);
  const likesByDay = Array.from({ length: sparkDays }, () => 0);
  let views = 0;
  let likes = 0;
  let comments = 0;
  let shares = 0;

  for (const h of deduped) {
    const m = h.metrics ?? {};
    const v = metricNum(m.views);
    const l = metricNum(m.likes);
    const c = metricNum(m.comments);
    const s = metricNum(m.shares);
    views += v;
    likes += l;
    comments += c;
    shares += s;

    const publishedAt = h.published_at ? new Date(String(h.published_at)).getTime() : NaN;
    if (!Number.isFinite(publishedAt)) continue;
    const dayIdx = Math.floor((publishedAt - oldestSpark) / dayMs);
    if (dayIdx < 0 || dayIdx >= sparkDays) continue;
    viewsByDay[dayIdx] += v;
    likesByDay[dayIdx] += l;
  }

  return { views, likes, comments, shares, viewsByDay, likesByDay, posts: deduped.length };
}
