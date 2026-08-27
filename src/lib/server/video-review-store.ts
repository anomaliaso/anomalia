import { swallow } from '$lib/server/swallow';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { withBrandContext } from '$lib/server/ai-log';
import { CreditsExhaustedError } from '$lib/server/credits';
import { isReviewableMediaUrl, mediaUrlLabel } from '$lib/content-formats';
import { extractCreativeScript, inferCreativeKind, type CreativeKind } from '$lib/server/creative-script';
import { resolveMediaOrigin } from '$lib/server/media-origin';
import {
  AUTO_VIDEO_REVIEW_ENABLED,
  inferVideoStandard,
  reviewVideo,
  visualUrlsFromPost,
  type VideoReview,
  type VideoStandard
} from '$lib/server/video-review';
import { reportMediaReviewError } from '$lib/server/video-review-report';
import { parseReviewCheckpoint, type ReviewCheckpoint } from '$lib/server/video-review-checkpoint';
import type {
  VideoScoreBadge,
  VideoScoreIssue,
  VideoScoreStatus,
  VideoScoreStandard,
  VideoScoreVerdict
} from '$lib/video-score';

export const MEDIA_REVIEW_LOG_PAGE_SIZE = 25;

export const VIDEO_REVIEW_MAX_ATTEMPTS = 3;
export const VIDEO_REVIEW_PROCESS_LIMIT = 2;
/** Leave ~30s under Vercel maxDuration 300s for persist + self-chain. */
export const VIDEO_REVIEW_TIME_BUDGET_MS = 270_000;
/** Don't start a review if the function hasn't this much wall time left. */
export const VIDEO_REVIEW_MIN_SLICE_MS = 90_000;
const STALL_MS = 8 * 60 * 1000;
const ENQUEUE_SCAN = 400;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export function normalizeMediaUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return raw.split('#')[0].split('?')[0];
  }
}

/** Short stable id for unique (brand, url, standard). Query strings stripped (signed URLs). */
export function mediaUrlHash(url: string): string {
  return createHash('sha256').update(normalizeMediaUrl(url)).digest('hex').slice(0, 32);
}

function asStatus(v: unknown): VideoScoreStatus {
  const s = String(v ?? '');
  if (s === 'running' || s === 'ready' || s === 'failed' || s === 'pending') return s;
  return 'pending';
}

function asVerdict(v: unknown): VideoScoreVerdict | null {
  const s = String(v ?? '');
  if (s === 'ship' || s === 'fix' || s === 'kill') return s;
  return null;
}

function clipText(v: unknown, max: number): string | null {
  const t = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function issuesFromReview(review: unknown): VideoScoreIssue[] {
  if (!review || typeof review !== 'object') return [];
  const raw = (review as AnyRec).issues;
  if (!Array.isArray(raw)) return [];
  const out: VideoScoreIssue[] = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue;
    const problem = clipText((item as AnyRec).problem, 160) ?? '';
    const fix = clipText((item as AnyRec).fix, 160) ?? '';
    if (problem || fix) out.push({ problem, fix });
  }
  return out;
}

export function rowToBadge(row: AnyRec): VideoScoreBadge {
  const overall = row.overall == null ? null : Number(row.overall);
  const review = row.review && typeof row.review === 'object' ? (row.review as AnyRec) : null;
  return {
    url: String(row.media_url ?? ''),
    postId: row.post_id ? String(row.post_id) : null,
    status: asStatus(row.status),
    overall: Number.isFinite(overall) ? overall : null,
    verdict: asVerdict(row.verdict),
    standard: row.standard === 'ads' ? 'ads' : 'organic',
    judgment: clipText(row.judgment ?? review?.judgment ?? review?.summary, 400),
    nextTest: clipText(review?.next_test, 280),
    issues: issuesFromReview(review)
  };
}

/** Compact media review for chat tools (`read_post` / `read_posts`). */
export type ChatMediaReview = {
  status: VideoScoreStatus | 'none';
  overall: number | null;
  verdict: VideoScoreVerdict | null;
  standard: VideoScoreStandard | null;
  judgment: string | null;
  next_test: string | null;
  issues: VideoScoreIssue[];
  hint?: string;
};

export function emptyChatMediaReview(): ChatMediaReview {
  return {
    status: 'none',
    overall: null,
    verdict: null,
    standard: null,
    judgment: null,
    next_test: null,
    issues: [],
    // `review_video` è smontato dalla chat (CHAT_REVIEW_VIDEO_ENABLED): un hint che nomina un
    // tool che l'agente non ha in mano lo manda a chiamare il vuoto. Il punteggio lo scrivono
    // ancora la pagina Media reviewer e l'endpoint CLI — da qui si guarda, non si chiede.
    hint: 'No stored review. Look at the media yourself (read_media, or render_stills for a motion video) and judge it — no tool scores it on demand.'
  };
}

export function rowToChatMediaReview(row: AnyRec): ChatMediaReview {
  const b = rowToBadge(row);
  const out: ChatMediaReview = {
    status: b.status,
    overall: b.overall,
    verdict: b.verdict,
    standard: b.standard,
    judgment: b.judgment ?? null,
    next_test: b.nextTest ?? null,
    issues: b.issues ?? []
  };
  if (out.status === 'pending' || out.status === 'running') {
    out.hint = 'Review in progress.';
  } else if (out.status === 'failed') {
    out.hint = 'Review failed, and it cannot be retried from here. Judge the media yourself (read_media, or render_stills for a motion video).';
  } else if (out.verdict === 'fix' || out.verdict === 'kill') {
    out.hint = 'Do not approve as-is. Apply next_test when remaking.';
  }
  return out;
}

/** Ready > running > pending > failed; organic over ads; newest updated_at. */
export function compareReviewRows(a: AnyRec, b: AnyRec): number {
  const rank = (r: AnyRec) => {
    const st = asStatus(r.status);
    const s = st === 'ready' ? 4 : st === 'running' ? 3 : st === 'pending' ? 2 : st === 'failed' ? 1 : 0;
    const std = r.standard === 'ads' ? 0 : 1;
    const t = Date.parse(String(r.updated_at ?? '')) || 0;
    return [s, std, t] as const;
  };
  const aa = rank(a);
  const bb = rank(b);
  if (aa[0] !== bb[0]) return bb[0] - aa[0];
  if (aa[1] !== bb[1]) return bb[1] - aa[1];
  return bb[2] - aa[2];
}

export function indexChatMediaReviews(rows: AnyRec[]): Map<string, ChatMediaReview> {
  const sorted = [...rows].sort(compareReviewRows);
  const out = new Map<string, ChatMediaReview>();
  for (const row of sorted) {
    const chat = rowToChatMediaReview(row);
    const pid = row.post_id ? `id:${row.post_id}` : '';
    const hash = row.url_hash ? String(row.url_hash) : mediaUrlHash(String(row.media_url ?? ''));
    if (pid && !out.has(pid)) out.set(pid, chat);
    if (hash && !out.has(`url:${hash}`)) out.set(`url:${hash}`, chat);
  }
  return out;
}

export function lookupChatMediaReview(
  map: Map<string, ChatMediaReview>,
  post: { id?: unknown; media_url?: unknown; media_urls?: unknown }
): ChatMediaReview | null {
  if (post.id) {
    const hit = map.get(`id:${post.id}`);
    if (hit) return hit;
  }
  for (const u of visualUrlsFromPost({
    media_url: typeof post.media_url === 'string' ? post.media_url : null,
    media_urls: post.media_urls
  })) {
    const hit = map.get(`url:${mediaUrlHash(u)}`);
    if (hit) return hit;
  }
  return null;
}

const REVIEW_CHAT_COLS =
  'media_url, post_id, status, overall, verdict, standard, url_hash, judgment, review, updated_at';

export async function loadChatMediaReviews(
  supabase: SupabaseClient,
  brandId: string,
  posts: Array<{ id?: unknown; media_url?: unknown; media_urls?: unknown }>
): Promise<Map<string, ChatMediaReview>> {
  const ids = [...new Set(posts.map((p) => String(p.id ?? '')).filter(Boolean))];
  const hashes = [
    ...new Set(
      posts.flatMap((p) =>
        visualUrlsFromPost({
          media_url: typeof p.media_url === 'string' ? p.media_url : null,
          media_urls: p.media_urls
        }).map((u) => mediaUrlHash(u))
      )
    )
  ].filter(Boolean);
  if (!ids.length && !hashes.length) return new Map();

  const rows: AnyRec[] = [];
  const seen = new Set<string>();
  const add = (data: unknown) => {
    for (const r of (data as AnyRec[] | null) ?? []) {
      const k = `${r.post_id ?? ''}:${r.url_hash ?? ''}:${r.standard ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
  };

  for (let i = 0; i < ids.length; i += 80) {
    const { data, error } = await supabase
      .from('video_reviews')
      .select(REVIEW_CHAT_COLS)
      .eq('brand_id', brandId)
      .in('post_id', ids.slice(i, i + 80));
    if (error) {
      console.warn('[video-review] chat reviews by post', error.message);
      break;
    }
    add(data);
  }
  for (let i = 0; i < hashes.length; i += 80) {
    const { data, error } = await supabase
      .from('video_reviews')
      .select(REVIEW_CHAT_COLS)
      .eq('brand_id', brandId)
      .in('url_hash', hashes.slice(i, i + 80));
    if (error) {
      console.warn('[video-review] chat reviews by url', error.message);
      break;
    }
    add(data);
  }
  return indexChatMediaReviews(rows);
}

/** Mutates posts in place with `media_review` (score, judgment, next_test, issues). */
export async function attachChatMediaReviews(
  supabase: SupabaseClient,
  brandId: string,
  posts: AnyRec[]
): Promise<Map<string, ChatMediaReview>> {
  const map = await loadChatMediaReviews(supabase, brandId, posts);
  for (const p of posts) {
    const found = lookupChatMediaReview(map, p);
    if (found) {
      p.media_review = found;
      continue;
    }
    const urls = visualUrlsFromPost({
      media_url: typeof p.media_url === 'string' ? p.media_url : null,
      media_urls: p.media_urls
    });
    if (urls.length) p.media_review = emptyChatMediaReview();
  }
  return map;
}

export type QueueVideoReviewInput = {
  brandId: string;
  url: string;
  postId?: string | null;
  standard?: VideoStandard;
  ugcAd?: boolean | null;
  durationSeconds?: number | null;
};

/** True when a post patch actually changes the visual (not just re-sends the same media_url). */
export function postMediaChanged(
  before: { media_url?: string | null; media_urls?: unknown },
  patch: { media_url?: unknown; media_urls?: unknown }
): boolean {
  if ('media_url' in patch) {
    if (normalizeMediaUrl(String(patch.media_url ?? '')) !== normalizeMediaUrl(String(before.media_url ?? ''))) {
      return true;
    }
  }
  if ('media_urls' in patch) {
    const prev = JSON.stringify(Array.isArray(before.media_urls) ? before.media_urls : []);
    const next = JSON.stringify(Array.isArray(patch.media_urls) ? patch.media_urls : []);
    if (prev !== next) return true;
  }
  return false;
}

/**
 * Insert a pending review if this clip+standard is new.
 * `force` resets a ready/failed row so the worker scores again (same URL after a media edit).
 * Best-effort: queue failure must not fail produce. Returns false if skipped (running / invalid).
 */
export async function queueVideoReview(
  supabase: SupabaseClient,
  input: QueueVideoReviewInput,
  opts?: { force?: boolean; manual?: boolean }
): Promise<boolean> {
  const url = input.url?.trim() ?? '';
  if (!url || !isReviewableMediaUrl(url)) return false;
  // La coda È l'automatismo: ogni innesco che parte da solo (produttore, scheduler, render di una
  // clip, salvataggio di un media, modifica di un post) finisce qui. Chiuderla qui invece che in
  // dodici chiamanti è il motivo per cui fra un mese non ne ricompare uno scoperto. `manual` è la
  // porta di chi la review la chiede a mano — vedi AUTO_VIDEO_REVIEW_ENABLED.
  if (!opts?.manual && !AUTO_VIDEO_REVIEW_ENABLED) return false;
  const standard =
    input.standard ??
    inferVideoStandard({ ugcAd: input.ugcAd, durationSeconds: input.durationSeconds });
  const hash = mediaUrlHash(url);
  const kind = inferCreativeKind({ mediaUrl: url });
  const now = new Date().toISOString();
  try {
    if (opts?.force) {
      const { data: existing } = await supabase
        .from('video_reviews')
        .select('id, status')
        .eq('brand_id', input.brandId)
        .eq('url_hash', hash)
        .eq('standard', standard)
        .maybeSingle();
      if (existing && asStatus(existing.status) === 'running') return false;
      const reset = {
        brand_id: input.brandId,
        post_id: input.postId ?? null,
        media_url: url,
        url_hash: hash,
        standard,
        kind,
        status: 'pending' as const,
        overall: null,
        verdict: null,
        scores: null,
        review: null,
        error: null,
        judgment: null,
        script_spoken: null,
        script_on_screen: null,
        caption: null,
        progress: null,
        attempts: 0,
        updated_at: now
      };
      let { error } = await supabase
        .from('video_reviews')
        .upsert(reset, { onConflict: 'brand_id,url_hash,standard' });
      if (error && /column|schema cache|script_spoken|progress|does not exist/i.test(error.message)) {
        const { judgment, script_spoken, script_on_screen, caption, kind: _kind, progress: _p, ...legacy } = reset;
        ({ error } = await supabase
          .from('video_reviews')
          .upsert(legacy, { onConflict: 'brand_id,url_hash,standard' }));
      }
      if (error) {
        console.warn('[video-review] queue', error.message);
        return false;
      }
      return true;
    }
    const { error } = await supabase.from('video_reviews').upsert(
      {
        brand_id: input.brandId,
        post_id: input.postId ?? null,
        media_url: url,
        url_hash: hash,
        standard,
        kind,
        status: 'pending',
        updated_at: now
      },
      { onConflict: 'brand_id,url_hash,standard', ignoreDuplicates: true }
    );
    if (error) console.warn('[video-review] queue', error.message);
    return !error;
  } catch (e) {
    console.warn('[video-review] queue', e instanceof Error ? e.message : e);
    return false;
  }
}

export type RequestMediaReviewResult = {
  queued: number;
  skippedRunning: number;
};

/** Queue (and optionally reset) every reviewable URL on a post, then kick the background worker. */
export async function requestPostMediaReview(
  supabase: SupabaseClient,
  input: { brandId: string; postId: string; origin?: string | null; force?: boolean; manual?: boolean }
): Promise<RequestMediaReviewResult> {
  const { data: post } = await supabase
    .from('posts')
    .select('id, media_url, media_urls, video_duration_seconds')
    .eq('id', input.postId)
    .eq('brand_id', input.brandId)
    .maybeSingle();
  if (!post) return { queued: 0, skippedRunning: 0 };
  const urls = visualUrlsFromPost(post);
  let queued = 0;
  let skippedRunning = 0;
  for (const url of urls) {
    const ok = await queueVideoReview(
      supabase,
      {
        brandId: input.brandId,
        url,
        postId: input.postId,
        durationSeconds: post.video_duration_seconds
      },
      { force: input.force !== false, manual: input.manual === true }
    );
    if (ok) queued += 1;
    else if (isReviewableMediaUrl(url)) skippedRunning += 1;
  }
  if (queued) await kickVideoReviewWork(input.origin, input.brandId);
  return { queued, skippedRunning };
}

export async function persistReadyReview(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    url: string;
    postId?: string | null;
    standard: VideoStandard;
    review: VideoReview;
    kind?: CreativeKind;
  }
): Promise<void> {
  const url = input.url.trim();
  if (!url) return;
  const hash = mediaUrlHash(url);
  const now = new Date().toISOString();
  const base = {
    brand_id: input.brandId,
    post_id: input.postId ?? null,
    media_url: url,
    url_hash: hash,
    standard: input.standard,
    status: 'ready' as const,
    overall: input.review.overall,
    verdict: input.review.verdict,
    scores: input.review.scores,
    review: input.review,
    error: null,
    updated_at: now
  };
  const withScript = {
    ...base,
    kind: input.kind ?? inferCreativeKind({ mediaUrl: url }),
    script_spoken: input.review.script?.spoken || null,
    script_on_screen: input.review.script?.on_screen || null,
    caption: input.review.script?.caption || null,
    judgment: input.review.judgment || input.review.summary || null,
    progress: null
  };
  let { error } = await supabase
    .from('video_reviews')
    .upsert(withScript, { onConflict: 'brand_id,url_hash,standard' });
  if (error && /column|schema cache|script_spoken|progress|does not exist/i.test(error.message)) {
    ({ error } = await supabase
      .from('video_reviews')
      .upsert(base, { onConflict: 'brand_id,url_hash,standard' }));
  }
  if (error) {
    console.warn('[video-review] persist', error.message);
    await reportMediaReviewError(new Error(error.message), {
      brandId: input.brandId,
      url,
      postId: input.postId ?? null,
      standard: input.standard,
      reviewKind: input.kind ?? inferCreativeKind({ mediaUrl: url }),
      stage: 'persist'
    });
    return;
  }
  if (input.postId) {
    try {
      const { maybeFlagPostForMediaRemake } = await import('$lib/server/autopilot-media-propose');
      await maybeFlagPostForMediaRemake(supabase, {
        brandId: input.brandId,
        postId: input.postId,
        overall: input.review.overall,
        verdict: input.review.verdict,
        judgment: input.review.judgment ?? input.review.summary,
        next_test: input.review.next_test
      });
    } catch (e) {
      console.warn('[video-review] remake propose', e instanceof Error ? e.message : e);
    }
  }
}

export { mediaUrlLabel };

export type MediaReviewStatusFilter = 'all' | 'ready' | 'failed' | 'pending';

export type MediaReviewLog = {
  id: string;
  mediaUrl: string;
  postId: string | null;
  kind: string;
  standard: VideoScoreStandard;
  status: VideoScoreStatus;
  overall: number | null;
  verdict: VideoScoreVerdict | null;
  error: string | null;
  judgment: string | null;
  scriptSpoken: string | null;
  scriptOnScreen: string | null;
  caption: string | null;
  attempts: number;
  updatedAt: string;
  createdAt: string;
};

export function rowToLog(row: AnyRec): MediaReviewLog {
  const overall = row.overall == null ? null : Number(row.overall);
  return {
    id: String(row.id),
    mediaUrl: String(row.media_url ?? ''),
    postId: row.post_id ? String(row.post_id) : null,
    kind: String(row.kind ?? 'video'),
    standard: row.standard === 'ads' ? 'ads' : 'organic',
    status: asStatus(row.status),
    overall: Number.isFinite(overall) ? overall : null,
    verdict: asVerdict(row.verdict),
    error: row.error ? String(row.error) : null,
    judgment: row.judgment ? String(row.judgment) : null,
    scriptSpoken: row.script_spoken ? String(row.script_spoken) : null,
    scriptOnScreen: row.script_on_screen ? String(row.script_on_screen) : null,
    caption: row.caption ? String(row.caption) : null,
    attempts: Number(row.attempts ?? 0),
    updatedAt: String(row.updated_at ?? row.created_at ?? ''),
    createdAt: String(row.created_at ?? '')
  };
}

export async function listBrandMediaReviews(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { status?: MediaReviewStatusFilter; page?: number; pageSize?: number }
): Promise<{
  rows: MediaReviewLog[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  counts: { total: number; ready: number; failed: number; pending: number };
}> {
  const pageSize = Math.max(1, Math.min(opts?.pageSize ?? MEDIA_REVIEW_LOG_PAGE_SIZE, 50));
  const filter: MediaReviewStatusFilter =
    opts?.status === 'ready' || opts?.status === 'failed' || opts?.status === 'pending'
      ? opts.status
      : 'all';

  const countOf = async (status?: string | string[]) => {
    let q = supabase
      .from('video_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId);
    if (Array.isArray(status)) q = q.in('status', status);
    else if (status) q = q.eq('status', status);
    const { count } = await q;
    return count ?? 0;
  };

  const [total, ready, failed, pendingRunning] = await Promise.all([
    countOf(),
    countOf('ready'),
    countOf('failed'),
    countOf(['pending', 'running'])
  ]);
  const counts = { total, ready, failed, pending: pendingRunning };

  const filteredTotal =
    filter === 'ready' ? ready : filter === 'failed' ? failed : filter === 'pending' ? pendingRunning : total;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const page = Math.min(Math.max(1, opts?.page ?? 1), totalPages);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const cols =
    'id, media_url, post_id, kind, standard, status, overall, verdict, error, judgment, script_spoken, script_on_screen, caption, attempts, updated_at, created_at';
  const colsLegacy =
    'id, media_url, post_id, standard, status, overall, verdict, error, attempts, updated_at, created_at';

  const fetchPage = async (select: string) => {
    let q = supabase
      .from('video_reviews')
      .select(select)
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .range(from, to);
    if (filter === 'ready' || filter === 'failed') q = q.eq('status', filter);
    else if (filter === 'pending') q = q.in('status', ['pending', 'running']);
    return q;
  };

  let { data, error } = await fetchPage(cols);
  if (error && /column|schema cache|does not exist/i.test(error.message)) {
    ({ data, error } = await fetchPage(colsLegacy));
  }
  if (error) console.warn('[video-review] list logs', error.message);

  return {
    rows: ((data ?? []) as AnyRec[]).map(rowToLog),
    total: filteredTotal,
    page,
    pageSize,
    totalPages,
    counts
  };
}

export async function loadVideoScoreBadges(
  supabase: SupabaseClient,
  brandId: string,
  urls: string[]
): Promise<Map<string, VideoScoreBadge>> {
  const hashes = [...new Set(urls.map((u) => mediaUrlHash(u)).filter(Boolean))];
  const out = new Map<string, VideoScoreBadge>();
  if (!hashes.length) return out;
  for (let i = 0; i < hashes.length; i += 80) {
    const chunk = hashes.slice(i, i + 80);
    const { data, error } = await supabase
      .from('video_reviews')
      .select('media_url, post_id, status, overall, verdict, standard, url_hash, judgment')
      .eq('brand_id', brandId)
      .in('url_hash', chunk);
    if (error) {
      console.warn('[video-review] load badges', error.message);
      break;
    }
    for (const row of data ?? []) {
      const badge = rowToBadge(row);
      out.set(String((row as AnyRec).url_hash), badge);
      out.set(normalizeMediaUrl(badge.url), badge);
    }
  }
  return out;
}

export async function loadCachedReview(
  supabase: SupabaseClient,
  brandId: string,
  url: string,
  standard: VideoStandard
): Promise<VideoReview | null> {
  const { data } = await supabase
    .from('video_reviews')
    .select('review, status')
    .eq('brand_id', brandId)
    .eq('url_hash', mediaUrlHash(url))
    .eq('standard', standard)
    .eq('status', 'ready')
    .maybeSingle();
  const review = data?.review;
  if (!review || typeof review !== 'object') return null;
  return review as VideoReview;
}

export async function loadBadgeForUrl(
  supabase: SupabaseClient,
  brandId: string,
  url: string
): Promise<VideoScoreBadge | null> {
  const { data } = await supabase
    .from('video_reviews')
    .select('media_url, post_id, status, overall, verdict, standard, updated_at, judgment, review')
    .eq('brand_id', brandId)
    .eq('url_hash', mediaUrlHash(url))
    .order('updated_at', { ascending: false })
    .limit(2);
  const rows = (data ?? []) as AnyRec[];
  const ready = rows.find((r) => r.status === 'ready');
  const row = ready ?? rows[0];
  return row ? rowToBadge(row) : null;
}

type QueueBrand = { id: string; name: string; slug?: string | null; content_prefs?: unknown };

function brandLanguage(prefs: unknown): string | null {
  if (!prefs || typeof prefs !== 'object') return null;
  const lang = String((prefs as { language?: string }).language ?? '').trim();
  return lang || null;
}

async function enqueueUnscoredVideos(admin: SupabaseClient): Promise<number> {
  const { data: posts } = await admin
    .from('posts')
    .select('id, brand_id, media_url, media_urls, caption, product_name, video_duration_seconds, content_type')
    .not('media_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(ENQUEUE_SCAN);

  const { data: items } = await admin
    .from('media_generator_items')
    .select('id, brand_id, url')
    .order('created_at', { ascending: false })
    .limit(ENQUEUE_SCAN);

  type Candidate = QueueVideoReviewInput;
  const candidates: Candidate[] = [];
  for (const p of (posts ?? []) as AnyRec[]) {
    const url = String(p.media_url ?? '');
    if (!isReviewableMediaUrl(url)) continue;
    candidates.push({
      brandId: String(p.brand_id),
      url,
      postId: String(p.id),
      durationSeconds: p.video_duration_seconds
    });
  }
  for (const it of (items ?? []) as AnyRec[]) {
    const url = String(it.url ?? '');
    if (!isReviewableMediaUrl(url)) continue;
    candidates.push({ brandId: String(it.brand_id), url });
  }
  if (!candidates.length) return 0;

  const hashes = [...new Set(candidates.map((c) => mediaUrlHash(c.url)))];
  const have = new Set<string>();
  for (let i = 0; i < hashes.length; i += 80) {
    const { data: existing } = await admin
      .from('video_reviews')
      .select('brand_id, url_hash')
      .in('url_hash', hashes.slice(i, i + 80));
    for (const r of existing ?? []) {
      have.add(`${(r as AnyRec).brand_id}:${(r as AnyRec).url_hash}`);
    }
  }
  let n = 0;
  for (const c of candidates) {
    const key = `${c.brandId}:${mediaUrlHash(c.url)}`;
    if (have.has(key)) continue;
    await queueVideoReview(admin, c);
    have.add(key);
    n += 1;
    if (n >= 20) break;
  }
  return n;
}

async function resetStalled(admin: SupabaseClient): Promise<void> {
  const stallIso = new Date(Date.now() - STALL_MS).toISOString();
  await admin
    .from('video_reviews')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'running')
    .lt('updated_at', stallIso);
}

async function saveReviewProgress(
  admin: SupabaseClient,
  id: string,
  progress: ReviewCheckpoint | null
): Promise<void> {
  const patch = {
    progress,
    updated_at: new Date().toISOString()
  };
  const { error } = await admin.from('video_reviews').update(patch).eq('id', id).eq('status', 'running');
  if (error && /column|schema cache|progress|does not exist/i.test(error.message)) {
    await admin
      .from('video_reviews')
      .update({ updated_at: patch.updated_at })
      .eq('id', id)
      .eq('status', 'running');
  }
}

async function requeueReview(
  admin: SupabaseClient,
  id: string,
  progress: ReviewCheckpoint | null
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'pending',
    error: null,
    progress,
    updated_at: new Date().toISOString()
  };
  const { error } = await admin.from('video_reviews').update(patch).eq('id', id);
  if (error && /column|schema cache|progress|does not exist/i.test(error.message)) {
    const { progress: _p, ...legacy } = patch;
    await admin.from('video_reviews').update(legacy).eq('id', id);
  }
}

async function processOne(
  admin: SupabaseClient,
  row: AnyRec,
  brand: QueueBrand,
  opts?: { deadlineMs?: number }
): Promise<'ok' | 'skip' | 'fail' | 'timeout' | 'credits'> {
  const claimed = await admin
    .from('video_reviews')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!claimed.data) return 'skip';

  const url = String(row.media_url ?? '');
  const standard: VideoStandard = row.standard === 'ads' ? 'ads' : 'organic';
  const language = brandLanguage(brand.content_prefs);
  let caption: string | null = null;
  let product: string | null = null;
  let script: string | null = null;
  let intendedOnScreen: string | null = null;
  let slideUrls: string[] = [];
  let kind: CreativeKind = inferCreativeKind({ mediaUrl: url });
  if (row.post_id) {
    const { data: post } = await admin
      .from('posts')
      .select('caption, product_name, content_type, media_url, media_urls, image_prompt')
      .eq('id', row.post_id)
      .maybeSingle();
    caption = post?.caption ? String(post.caption) : null;
    product = post?.product_name ? String(post.product_name) : null;
    if (post) {
      slideUrls = visualUrlsFromPost(post).filter((u) => u !== url);
      let graphicSpec: unknown;
      try {
        const origin = await resolveMediaOrigin(admin, String(row.post_id), post);
        graphicSpec = origin.graphic?.source ?? origin.graphic?.spec;
      } catch (error) { swallow('resolve graphic origin', error); }
      const extracted = extractCreativeScript({
        contentType: post.content_type,
        mediaUrl: post.media_url,
        mediaUrls: post.media_urls,
        caption,
        graphicSpec
      });
      kind = extracted.kind;
      script = extracted.spoken || null;
      intendedOnScreen = extracted.onScreen || null;
    }
  }

  const deadlineMs = opts?.deadlineMs ?? Date.now() + VIDEO_REVIEW_TIME_BUDGET_MS;
  const abortIn = Math.max(8_000, deadlineMs - Date.now() - 20_000);
  const ac = new AbortController();
  const abortTimer = setTimeout(() => ac.abort(), abortIn);
  const beat = setInterval(() => {
    void admin
      .from('video_reviews')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'running');
  }, 25_000);
  const checkpoint = parseReviewCheckpoint(row.progress);

  try {
    const result = await withBrandContext(brand.id, () =>
      reviewVideo(url, {
        standard,
        brandName: brand.name,
        caption,
        product,
        language,
        script,
        intendedOnScreen,
        slideUrls,
        kind,
        abortSignal: ac.signal,
        checkpoint,
        onCheckpoint: (cp) => saveReviewProgress(admin, String(row.id), cp)
      })
    );
    if (result.ok) {
      await persistReadyReview(admin, {
        brandId: brand.id,
        url,
        postId: row.post_id ? String(row.post_id) : null,
        standard,
        review: result.review,
        kind
      });
      return 'ok';
    }
    if (result.aborted || result.error === 'aborted') {
      await requeueReview(admin, String(row.id), result.checkpoint ?? checkpoint);
      return 'timeout';
    }
    const attempts = Number(row.attempts ?? 0) + 1;
    const failed = attempts >= VIDEO_REVIEW_MAX_ATTEMPTS;
    await admin
      .from('video_reviews')
      .update({
        status: failed ? 'failed' : 'pending',
        error: result.error,
        attempts,
        progress: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id);
    if (failed) {
      await reportMediaReviewError(new Error(result.error || 'review_failed'), {
        brandId: brand.id,
        brandName: brand.name,
        brandSlug: brand.slug ?? null,
        url,
        postId: row.post_id ? String(row.post_id) : null,
        standard,
        reviewKind: kind,
        attempts,
        stage: 'review'
      });
    }
    return failed ? 'fail' : 'skip';
  } catch (e) {
    if (e instanceof CreditsExhaustedError) {
      // La riga torna 'pending' con lo stesso created_at: quando i crediti tornano è la prima a
      // essere servita. È il chiamante che deve smettere di ripescarla — 'skip' lo faceva credere
      // lavoro fatto, e il tick riprovava la stessa riga all'infinito (vedi runVideoReviewTick).
      await requeueReview(admin, String(row.id), checkpoint);
      return 'credits';
    }
    const attempts = Number(row.attempts ?? 0) + 1;
    const failed = attempts >= VIDEO_REVIEW_MAX_ATTEMPTS;
    await admin
      .from('video_reviews')
      .update({
        status: failed ? 'failed' : 'pending',
        error: e instanceof Error ? e.message : 'model_failed',
        attempts,
        progress: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', row.id);
    await reportMediaReviewError(e, {
      brandId: brand.id,
      brandName: brand.name,
      brandSlug: brand.slug ?? null,
      url,
      postId: row.post_id ? String(row.post_id) : null,
      standard,
      reviewKind: kind,
      attempts,
      stage: 'review',
      notify: failed ? 'all' : 'sentry'
    });
    return failed ? 'fail' : 'skip';
  } finally {
    clearTimeout(abortTimer);
    clearInterval(beat);
  }
}

export type VideoReviewTickResult = {
  enqueued: number;
  processed: number;
  ok: number;
  failed: number;
  remaining: number;
  /** Brand esclusi da questo tick perché a crediti zero: coda ferma per loro, non per gli altri. */
  creditsBlocked: number;
};

/**
 * Quanti brand a crediti zero si è disposti a incontrare in un tick prima di fermarsi. Ognuno
 * costa una `gateCredits` (cache 60s) e due update: pochi, ma non infiniti.
 */
const CREDIT_SKIP_LIMIT = 5;

/** Cron/worker: queue missing clips, then score until the Vercel time budget is gone. */
export async function runVideoReviewTick(
  admin: SupabaseClient,
  opts?: { brandId?: string; limit?: number; deadlineMs?: number }
): Promise<VideoReviewTickResult> {
  const deadlineMs = opts?.deadlineMs ?? Date.now() + VIDEO_REVIEW_TIME_BUDGET_MS;
  await resetStalled(admin);
  const enqueued = await enqueueUnscoredVideos(admin);
  const limit = Math.max(1, Math.min(opts?.limit ?? VIDEO_REVIEW_PROCESS_LIMIT, 4));

  const brandCache = new Map<string, QueueBrand>();
  let processed = 0;
  let ok = 0;
  let failed = 0;

  const countRemaining = async () => {
    let q = admin
      .from('video_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (opts?.brandId) q = q.eq('brand_id', opts.brandId);
    const { count } = await q;
    return count ?? 0;
  };

  // Un brand a saldo zero restava incastrato in testa alla coda: `requeueReview` rimette la riga a
  // 'pending' senza toccare né `attempts` né `created_at`, quindi il giro dopo si ripescava LA
  // STESSA riga, si bruciavano tutti gli slot su di lei, `remaining` restava ≥1 e l'endpoint si
  // ri-postava addosso all'infinito (stessa forma dell'incidente 2026-07-13, pagata in invocazioni).
  // Ora il brand senza crediti esce dalla selezione per il resto del tick — il gate è la prima cosa
  // che fa `reviewVideo`, costa una query, non un download — e la coda avanza per tutti gli altri.
  const noCredits = new Set<string>();
  let creditsBlocked = 0;

  while (
    processed < limit &&
    creditsBlocked < CREDIT_SKIP_LIMIT &&
    deadlineMs - Date.now() >= VIDEO_REVIEW_MIN_SLICE_MS
  ) {
    let q = admin
      .from('video_reviews')
      .select('id, brand_id, post_id, media_url, standard, attempts, status, kind, progress')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);
    if (opts?.brandId) q = q.eq('brand_id', opts.brandId);
    if (noCredits.size) q = q.not('brand_id', 'in', `(${[...noCredits].join(',')})`);
    const { data: pending } = await q;
    const row = pending?.[0] as AnyRec | undefined;
    if (!row) break;

    const brandId = String(row.brand_id);
    let brand = brandCache.get(brandId);
    if (!brand) {
      const { data } = await admin
        .from('brands')
        .select('id, name, slug, content_prefs')
        .eq('id', brandId)
        .maybeSingle();
      if (!data) break;
      brand = data as QueueBrand;
      brandCache.set(brandId, brand);
    }

    const r = await processOne(admin, row, brand, { deadlineMs });
    if (r === 'credits') {
      // Niente è stato speso e niente è avanzato: non conta come lavoro, o l'endpoint si ri-kicka.
      noCredits.add(brandId);
      creditsBlocked += 1;
      continue;
    }
    processed += 1;
    if (r === 'ok') ok += 1;
    if (r === 'fail') failed += 1;
    if (r === 'timeout') break;
  }

  return { enqueued, processed, ok, failed, creditsBlocked, remaining: await countRemaining() };
}

export async function kickVideoReviewWork(origin?: string | null, brandId?: string): Promise<void> {
  const base = String(origin || publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!base) return;
  const headers: Record<string, string> = {};
  if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
  else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
  const url = new URL('/api/v1/videos/review/work', base);
  if (brandId) url.searchParams.set('brand', brandId);
  await fetch(url.toString(), { method: 'POST', headers }).catch(swallow('url.toString failed'));
}
