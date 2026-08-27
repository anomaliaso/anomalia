import type { SupabaseClient } from '@supabase/supabase-js';
import { writeMemory } from '$lib/server/brand-memory';
import { OWN_SOURCE } from '$lib/server/own-post-history';

// ── P2 Learning loop: visual ↔ engagement correlation ─────────────────────────
// Weekly SQL-only job (zero LLM cost): joins post_visual_meta (visual attributes set at
// render/publish) with social_post_history source='zernio' (the brand's OWN performance),
// aggregates mean ER per (genre, platform, asset_source, hook_type), persists winning buckets
// into brand_visual_insights and writes top lessons into brand_memory for the produce agent.
// See docs/specs/31-p2-learning-loop.md + errata 31-errata-wave2.md (P2#3 stable window,
// P2#4 join fallback, P2#7 engagementRate '0').

export const VISUAL_WINDOW_DAYS = 28;
export const MIN_OWN_POSTS = 10; // brand-level: < 10 own posts in window → no insights (anti-overfitting)
export const MIN_BUCKET_POSTS = 3; // group-level: n < 3 → dimension value dropped
export const LESSON_DELTA_THRESHOLD = 15; // percentage points: only groups > +15% vs brand mean become lessons
export const MAX_LESSONS = 2;

export type VisualDataStatus = 'ready' | 'seeding' | 'insufficient';

export type VisualDimension = 'genre' | 'platform' | 'asset_source' | 'hook_type';
export const VISUAL_DIMENSIONS: VisualDimension[] = [
  'genre',
  'platform',
  'asset_source',
  'hook_type'
];

export type VisualInsightGroup = {
  dimension: VisualDimension;
  value: string;
  n: number;
  /** Mean engagement rate in PERCENT (4.2 = 4.2%), same scale as metrics.engagementRate. */
  er_avg: number;
  /** Percentage points vs brand mean: (er_avg - brand_mean) / brand_mean * 100 — e.g. 35 = +35%. */
  delta: number;
};

export type VisualTickResult = {
  ok: boolean;
  sufficient: VisualDataStatus;
  groups: number;
  lessons: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const META_COLS =
  'id, post_id, brand_id, platform, format, genre, params, asset_source, hook_type, published_at';
const HIST_COLS = 'id, external_post_id, platform, published_at, metrics';

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Engagement rate for one own post. Uses metrics.engagementRate when it is a real value;
 * treats '0'/'' as MISSING (known Zernio bug: numOrU(null) → '0', errata P2#7) and falls back
 * to (likes + 2*comments) / impressions. Always PERCENT (4.2 = 4.2%), like metrics.engagementRate:
 * the fallback fraction is scaled ×100 so the two sources never mix scales. Returns null when
 * neither is available — such rows are ignored by the aggregation (they never pollute er_avg).
 */
function engagementRate(metrics: AnyRec | null | undefined): number | null {
  const m = metrics ?? {};
  const direct = m.engagementRate;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
  if (typeof direct === 'string' && direct.trim() !== '' && direct !== '0') {
    const d = Number(direct);
    if (Number.isFinite(d) && d > 0) return d;
  }
  const likes = numOrNull(m.likes) ?? 0;
  const comments = numOrNull(m.comments) ?? 0;
  const impressions = numOrNull(m.impressions) ?? 0;
  if (impressions > 0) return ((likes + 2 * comments) / impressions) * 100;
  return null;
}

/** Monday of the current (UTC) week, as a stable ISO date (errata P2#3). */
export function currentWindowStart(date = new Date()): string {
  const day = date.getUTCDay();
  return new Date(date.getTime() - ((day + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

export type MatchedRow = { meta: AnyRec; metrics: AnyRec | null };

async function loadMetaRows(
  admin: SupabaseClient,
  brandId: string,
  windowStart: string,
  windowEnd: string
): Promise<AnyRec[]> {
  const { data } = await admin
    .from('post_visual_meta')
    .select(META_COLS)
    .eq('brand_id', brandId)
    .gte('published_at', windowStart)
    .lt('published_at', windowEnd)
    .limit(1000);
  return (data ?? []) as AnyRec[];
}

async function loadPostsByIds(
  admin: SupabaseClient,
  brandId: string,
  postIds: string[]
): Promise<AnyRec[]> {
  const { data } = await admin
    .from('posts')
    .select('id, external_post_id')
    .eq('brand_id', brandId)
    .in('id', postIds)
    .limit(postIds.length);
  return (data ?? []) as AnyRec[];
}

async function loadHistoryByExternalIds(
  admin: SupabaseClient,
  brandId: string,
  externalIds: string[]
): Promise<AnyRec[]> {
  const { data } = await admin
    .from('social_post_history')
    .select(HIST_COLS)
    .eq('brand_id', brandId)
    .eq('source', OWN_SOURCE)
    .in('external_post_id', externalIds)
    .limit(1000);
  return (data ?? []) as AnyRec[];
}

async function loadHistoryByWindow(
  admin: SupabaseClient,
  brandId: string,
  windowStart: string,
  windowEnd: string
): Promise<AnyRec[]> {
  const from = new Date(Date.parse(windowStart) - 86400000).toISOString();
  const to = new Date(Date.parse(windowEnd) + 86400000).toISOString();
  const { data } = await admin
    .from('social_post_history')
    .select(HIST_COLS)
    .eq('brand_id', brandId)
    .eq('source', OWN_SOURCE)
    .gte('published_at', from)
    .lte('published_at', to)
    .limit(2000);
  return (data ?? []) as AnyRec[];
}

/**
 * Join post_visual_meta → posts → social_post_history (source='zernio') within the 28d window.
 * Primary key is external_post_id; since that join is NOT attested (errata P2#4), when it
 * produces < 3 matches the join is retried on (brand_id, platform, published_at::date) with
 * a ±1 day tolerance, keeping the richer of the two results (the fallback never destroys
 * matches the id join already found). Returns meta rows carrying their own-post metrics.
 */
export async function loadMatchedOwnPosts(
  admin: SupabaseClient,
  brandId: string,
  opts: { windowStart?: string; windowEnd?: string } = {}
): Promise<MatchedRow[]> {
  const windowEnd = opts.windowEnd ?? new Date().toISOString();
  const windowStart =
    opts.windowStart ?? new Date(Date.now() - VISUAL_WINDOW_DAYS * 86400000).toISOString();

  const meta = await loadMetaRows(admin, brandId, windowStart, windowEnd);
  if (!meta.length) return [];

  const postIds = [...new Set(meta.map((m) => String(m.post_id)))];
  const posts = await loadPostsByIds(admin, brandId, postIds);
  const externalIdByPostId = new Map<string, string>();
  for (const p of posts) {
    if (p.external_post_id) externalIdByPostId.set(String(p.id), String(p.external_post_id));
  }
  const externalIds = [...new Set(externalIdByPostId.values())];

  let matched: MatchedRow[] = [];
  if (externalIds.length) {
    const history = await loadHistoryByExternalIds(admin, brandId, externalIds);
    const historyByExternalId = new Map(
      history.map((h) => [String(h.external_post_id), h.metrics ?? null])
    );
    matched = meta
      .map((m) => ({
        meta: m,
        metrics: historyByExternalId.get(externalIdByPostId.get(String(m.post_id)) ?? '') ?? null
      }))
      .filter((r) => r.metrics != null);
  }

  if (matched.length < MIN_BUCKET_POSTS) {
    const history = await loadHistoryByWindow(admin, brandId, windowStart, windowEnd);
    const used = new Set<string>();
    const fallback: MatchedRow[] = [];
    for (const m of meta) {
      const metaPlatform = String(m.platform ?? '').toLowerCase();
      const metaTs = Date.parse(m.published_at);
      if (!metaPlatform || !Number.isFinite(metaTs)) continue;
      // Nearest in time wins, not the first row found: two same-day posts on one platform
      // would otherwise swap each other's metrics.
      // ponytail: greedy nearest-first per meta row; a global assignment only matters if
      // same-platform posts land within minutes of each other.
      let best: AnyRec | null = null;
      let bestGap = Infinity;
      for (const row of history) {
        if (used.has(String(row.id))) continue;
        if (String(row.platform ?? '').toLowerCase() !== metaPlatform) continue;
        const hTs = Date.parse(row.published_at);
        if (!Number.isFinite(hTs)) continue;
        const gap = Math.abs(hTs - metaTs);
        if (gap <= 86400000 && gap < bestGap) {
          best = row;
          bestGap = gap;
        }
      }
      if (best) {
        used.add(String(best.id));
        fallback.push({ meta: m, metrics: best.metrics ?? null });
      }
    }
    if (fallback.length > matched.length) matched = fallback;
  }

  return matched;
}

/**
 * Data sufficiency gate: count of own published posts with visual meta + engagement in the
 * 28d window. ≥ 10 → insights; 3-9 → "seeding" (no insights, no error); < 3 → insufficient.
 */
export function dataStatus(count: number): VisualDataStatus {
  return count >= MIN_OWN_POSTS ? 'ready' : count >= MIN_BUCKET_POSTS ? 'seeding' : 'insufficient';
}

export async function sufficientData(
  admin: SupabaseClient,
  brandId: string
): Promise<{ count: number; status: VisualDataStatus }> {
  const count = (await loadMatchedOwnPosts(admin, brandId)).length;
  return { count, status: dataStatus(count) };
}

/**
 * Aggregate mean ER per (genre, platform, asset_source, hook_type) with the brand's own
 * ER mean as baseline. Rows without any usable ER are ignored; groups with n < 3 are dropped.
 * Sorted by delta descending. `rows` can be passed in to reuse an already loaded join.
 */
export async function buildVisualInsights(
  admin: SupabaseClient,
  brandId: string,
  preloaded?: MatchedRow[]
): Promise<VisualInsightGroup[]> {
  const rows = preloaded ?? (await loadMatchedOwnPosts(admin, brandId));

  const buckets = new Map<VisualDimension, Map<string, number[]>>();
  for (const d of VISUAL_DIMENSIONS) buckets.set(d, new Map());
  const brandErs: number[] = [];

  for (const row of rows) {
    const er = engagementRate(row.metrics);
    if (er == null) continue;
    brandErs.push(er);
    for (const d of VISUAL_DIMENSIONS) {
      const raw = row.meta[d];
      const value = raw == null ? '' : String(raw).trim().toLowerCase();
      if (!value) continue;
      const bucket = buckets.get(d)!;
      const list = bucket.get(value) ?? [];
      list.push(er);
      bucket.set(value, list);
    }
  }

  // Significance gate on rows that actually carry an ER: 10 matches of which only 3 are usable
  // must NOT produce a "winner" (the gate is about the sample the means are built on).
  if (brandErs.length < MIN_OWN_POSTS) return [];
  const brandMean = brandErs.reduce((a, b) => a + b, 0) / brandErs.length;

  const groups: VisualInsightGroup[] = [];
  for (const d of VISUAL_DIMENSIONS) {
    for (const [value, ers] of buckets.get(d)!) {
      if (ers.length < MIN_BUCKET_POSTS) continue;
      const erAvg = ers.reduce((a, b) => a + b, 0) / ers.length;
      groups.push({
        dimension: d,
        value,
        n: ers.length,
        er_avg: erAvg,
        delta: brandMean > 0 ? ((erAvg - brandMean) / brandMean) * 100 : 0
      });
    }
  }

  groups.sort((a, b) => b.delta - a.delta);
  return groups;
}

/**
 * Upsert every bucket for the current (stable, Monday-based) window — losers included, they are
 * useful information; readers are the ones that filter down to delta > 0 before showing winners.
 */
export async function persistInsights(
  admin: SupabaseClient,
  brandId: string,
  groups: VisualInsightGroup[]
): Promise<number> {
  if (!groups.length) return 0;
  const windowStart = currentWindowStart();
  const rows = groups.map((g) => ({
    brand_id: brandId,
    window_start: windowStart,
    dimension: g.dimension,
    value: g.value,
    n: g.n,
    er_avg: g.er_avg,
    delta: g.delta
  }));
  const { error } = await admin
    .from('brand_visual_insights')
    .upsert(rows, { onConflict: 'brand_id,window_start,dimension,value' });
  if (error) throw new Error(`persistInsights: ${error.message}`);
  return rows.length;
}

/**
 * Write the top-2 groups > +15% above the brand mean into brand memory (source='analysis',
 * layer='project', category='insight'). Idempotent via writeMemory's key lookup: an existing
 * lesson is REFRESHED with this week's delta instead of being left frozen at the old number.
 */
export async function learnLessons(
  admin: SupabaseClient,
  brandId: string,
  groups: VisualInsightGroup[]
): Promise<number> {
  const candidates = [...groups]
    .filter((g) => g.delta > LESSON_DELTA_THRESHOLD)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, MAX_LESSONS);

  let written = 0;
  for (const g of candidates) {
    const subject = `Visual insight: ${g.value} per ${g.dimension}`;
    await writeMemory(admin, brandId, {
      category: 'insight',
      key: `visual.${g.dimension}.${g.value}`,
      value: `${subject} → +${Math.round(g.delta)}% ER vs media brand (n=${g.n})`,
      source: 'analysis',
      confidence: 0.75,
      layer: 'project'
    });
    written += 1;
  }
  return written;
}

/** Full pipeline for one brand: sufficiency gate → build → persist → lessons. */
export async function runVisualInsightsTick(
  admin: SupabaseClient,
  brandId: string
): Promise<VisualTickResult> {
  const rows = await loadMatchedOwnPosts(admin, brandId);
  const status = dataStatus(rows.length);
  if (status !== 'ready') return { ok: true, sufficient: status, groups: 0, lessons: 0 };

  const insights = await buildVisualInsights(admin, brandId, rows);
  const groups = await persistInsights(admin, brandId, insights);
  const lessons = await learnLessons(admin, brandId, insights);
  return { ok: true, sufficient: status, groups, lessons };
}
