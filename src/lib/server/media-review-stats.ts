import type { SupabaseClient } from '@supabase/supabase-js';

/** Keep in sync with `WEAK_MEDIA_REVIEW_SCORE` / `isWeakMediaScore` in weekly-recap. */
const WEAK_SCORE = 6;

function isWeak(overall: number, verdict: string): boolean {
  if (verdict === 'kill' || verdict === 'fix') return true;
  return overall < WEAK_SCORE;
}

export type MediaReviewStatRow = {
  post_id?: string | null;
  overall?: number | null;
  verdict?: string | null;
  judgment?: string | null;
  status?: string | null;
  standard?: string | null;
};

export type MediaReviewWeakItem = {
  postId: string | null;
  overall: number;
  verdict: 'ship' | 'fix' | 'kill';
  judgment: string | null;
  caption?: string | null;
};

export type MediaReviewStats = {
  scored: number;
  ship: number;
  fix: number;
  kill: number;
  weak: number;
  avg: number | null;
  pending: number;
  failed: number;
  buckets: { lt4: number; lt6: number; lt8: number; high: number };
  weakest: MediaReviewWeakItem[];
};

const WEAKEST_LIMIT = 5;

export function emptyMediaReviewStats(): MediaReviewStats {
  return {
    scored: 0,
    ship: 0,
    fix: 0,
    kill: 0,
    weak: 0,
    avg: null,
    pending: 0,
    failed: 0,
    buckets: { lt4: 0, lt6: 0, lt8: 0, high: 0 },
    weakest: []
  };
}

function asVerdict(v: string | null | undefined): 'ship' | 'fix' | 'kill' {
  if (v === 'kill' || v === 'fix' || v === 'ship') return v;
  return 'ship';
}

/**
 * One row per post (or unattached URL). When organic + ads exist, keep the lower score
 * so remake counts match the weekly recap.
 */
export function summarizeMediaReviewRows(rows: MediaReviewStatRow[]): MediaReviewStats {
  const out = emptyMediaReviewStats();
  const byKey = new Map<
    string,
    { overall: number; verdict: 'ship' | 'fix' | 'kill'; judgment: string | null; postId: string | null }
  >();
  let anon = 0;
  for (const r of rows) {
    const st = String(r.status ?? 'ready');
    if (st === 'pending' || st === 'running') {
      out.pending += 1;
      continue;
    }
    if (st === 'failed') {
      out.failed += 1;
      continue;
    }
    if (st !== 'ready') continue;
    const overall = Number(r.overall);
    if (!Number.isFinite(overall)) continue;
    const verdict = asVerdict(r.verdict);
    const postId = r.post_id ? String(r.post_id) : null;
    const key = postId ? `id:${postId}` : `url:${anon++}`;
    const prev = byKey.get(key);
    if (prev && prev.overall <= overall) continue;
    byKey.set(key, {
      overall,
      verdict,
      judgment: r.judgment ? String(r.judgment).replace(/\s+/g, ' ').trim().slice(0, 160) : null,
      postId
    });
  }

  let sum = 0;
  const weak: MediaReviewWeakItem[] = [];
  for (const item of byKey.values()) {
    out.scored += 1;
    sum += item.overall;
    if (item.verdict === 'ship') out.ship += 1;
    else if (item.verdict === 'fix') out.fix += 1;
    else out.kill += 1;
    if (isWeak(item.overall, item.verdict)) {
      out.weak += 1;
      weak.push(item);
    }
    if (item.overall < 4) out.buckets.lt4 += 1;
    else if (item.overall < 6) out.buckets.lt6 += 1;
    else if (item.overall < 8) out.buckets.lt8 += 1;
    else out.buckets.high += 1;
  }
  out.avg = out.scored ? Math.round((sum / out.scored) * 10) / 10 : null;
  out.weakest = weak.sort((a, b) => a.overall - b.overall).slice(0, WEAKEST_LIMIT);
  return out;
}

export async function loadMediaReviewStats(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { withCaptions?: boolean }
): Promise<MediaReviewStats> {
  try {
    const { data, error } = await supabase
      .from('video_reviews')
      .select('post_id, overall, verdict, judgment, status, standard')
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .limit(400);
    if (error) {
      console.warn('[media-review-stats]', error.message);
      return emptyMediaReviewStats();
    }
    const stats = summarizeMediaReviewRows((data ?? []) as MediaReviewStatRow[]);
    if (!opts?.withCaptions || !stats.weakest.length) return stats;
    const ids = [...new Set(stats.weakest.map((w) => w.postId).filter((id): id is string => !!id))];
    if (!ids.length) return stats;
    const { data: posts } = await supabase.from('posts').select('id, caption').in('id', ids);
    const captions = new Map((posts ?? []).map((p) => [String(p.id), p.caption ? String(p.caption) : null]));
    for (const w of stats.weakest) {
      if (w.postId) w.caption = captions.get(w.postId) ?? null;
    }
    return stats;
  } catch (e) {
    console.warn('[media-review-stats] failed:', e instanceof Error ? e.message : e);
    return emptyMediaReviewStats();
  }
}
