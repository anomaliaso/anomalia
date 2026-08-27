/**
 * The daily market loop: discover → baseline → label → score → fit.
 *
 * Stage 1 (`market-discovery.ts`) finds posts that are doing well right now, across the open web.
 * Stage 2 (here) gives each one a denominator, because a post's raw engagement says more about its
 * account's size than about its writing — see the header of `market-metrics.ts`.
 *
 * BASELINES COME IN TWO GRADES, and conflating them is the easiest way to fool yourself:
 *
 *   'history'    — the account's recent profile history, pulled through the handle-based endpoints
 *                  in scrapecreators. An unbiased sample: winners AND flops. This is the good one.
 *   'discovered' — accumulated from posts the sweep itself surfaced. BIASED HIGH by construction,
 *                  since discovery only shows an account at its best, so the median lands above the
 *                  account's true typical post and every outperformance computed from it is
 *                  understated. Still usable for ranking checks against each other; never quote it
 *                  as an absolute multiple.
 *
 * BASELINE_CAPABLE decides which of the two an account gets. Reddit qualifies for 'history' despite
 * having no profile fetcher — a subreddit's `sort=new` is an unbiased chronological sample, which is
 * the same shape. LinkedIn does not: its search returns an author's display name, not a profile URL,
 * so those accounts stay on 'discovered' and the report says so.
 *
 * Everything is best-effort BUT NOTHING IS SILENT. A dead platform costs a day of one source, never
 * the run — and every failure that did not stop the run is collected into `errors` and written to
 * the run log. A harvest returning few posts with no errors had a quiet day; the same count with a
 * full error list is broken, and the two must never look alike from the outside.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchProfileHistory, type NormalizedPost } from '$lib/server/scrapecreators';
import { fetchTranscript, transcriptColumns } from '$lib/server/market-transcript';
import { CONTENT_SCORER_VERSION, checkValues, scoreContentQuality } from '$lib/server/content-quality';
import { archiveMarketMedia } from '$lib/server/market-media';
import {
  fetchSubredditBaseline,
  runDiscovery,
  type DiscoveredPost,
  type DiscoveryPlan,
  type SourceYield
} from '$lib/server/market-discovery';
import type { TrendingVideo } from '$lib/server/market-trends';
import {
  MIN_ACCOUNT_POSTS,
  REFERENCE_AGE_HOURS,
  interactionRate,
  correlateByCategory,
  correlateByFormat,
  correlateChecks,
  engagementAtAge,
  engagementOf,
  velocity,
  formatBucket,
  median,
  type ScoredMarketPost
} from '$lib/server/market-metrics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Platforms whose accounts can be fetched in full through scrapecreators' FETCHERS map. */
export const HISTORY_CAPABLE = new Set(['instagram', 'tiktok', 'x', 'threads', 'facebook', 'youtube']);

/**
 * Everything we can pull an unbiased sample for, which is what actually decides whether a discovered
 * account has to WAIT to be labelled or is labelled on the spot.
 *
 * Reddit is here even though it has no profile fetcher: an account there is a subreddit, and
 * `sort=new` returns its posts chronologically — hits and flops alike — which is exactly the shape a
 * denominator needs. `rising`/`top` would not do: those show a community at its best.
 *
 * LinkedIn is NOT here and cannot easily be: its search returns an author's display name, not a
 * profile URL, and `/v1/linkedin/company/posts` needs the URL. LinkedIn accounts therefore still
 * depend on recurring in discovery until they clear MIN_ACCOUNT_POSTS, on the biased 'discovered'
 * baseline. That limit is real and shows up as a lower labelled share for LinkedIn in the fit.
 */
export const BASELINE_CAPABLE = new Set([...HISTORY_CAPABLE, 'reddit']);

/**
 * Hard ceiling on profile fetches per tick — a runaway guard, not the operating limit.
 *
 * The real bound is `BASELINE_TIME_BUDGET_MS`: fetches run until the clock says stop, and whatever
 * is left stays queued for the next tick. A fixed count would be the wrong shape, because it throws
 * away exactly what the search calls were paid for — an account discovered and never fetched leaves
 * its trending post permanently unlabelled, which makes that search a wasted call.
 */
export const MAX_BASELINE_FETCHES = 200;

/**
 * Wall-clock slice for profile fetches inside an 800s function, leaving room for discovery, media,
 * the catalogue and the writes.
 *
 * Fetches measured at ~1-2s each against ScrapeCreators, so this drains roughly 200-400 accounts
 * per run — enough to clear MAX_BASELINE_FETCHES in one go rather than carrying a queue that grows
 * faster than it empties. That was the actual failure: with a 150s slice inside a 300s wall the
 * queue reached 200+ deferred accounts while zero of the 381 trending videos had a label.
 */
export const BASELINE_TIME_BUDGET_MS = 450_000;

/** An account whose fetch failed is retried, but not every hour: a 404 stays a 404. */
export const FETCH_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
export const FETCH_MAX_ATTEMPTS = 4;

/** Posts pulled per account when computing an unbiased baseline. */
export const BASELINE_POSTS = 24;

export type HarvestError = {
  stage:
    | 'discovery'
    | 'media'
    | 'baseline'
    | 'observation'
    | 'label'
    | 'catalogue'
    // The public wall's three stages (0199). Same error shape on purpose: a run log that
    // distinguishes "the sweep broke" from "the gallery broke" only helps if both are in it.
    | 'design_judge'
    | 'wall_media'
    | 'wall_publish';
  target: string;
  message: string;
};

export type HarvestResult = {
  discovered: number;
  stored: number;
  baselinesFromHistory: number;
  baselinesFromDiscovery: number;
  labelled: number;
  /** Measured yield per source and category — the page sizes of these endpoints are undocumented. */
  yields: SourceYield[];
  /**
   * Everything that went wrong without stopping the run: dead search endpoints, media that could not
   * be archived, account histories that would not fetch. A harvest that returns few posts and an
   * empty `errors` had a quiet day; one with the same count and a full `errors` is broken.
   */
  errors: HarvestError[];
  /** Posts seen for the first time. */
  postsNew: number;
  /** Posts already in the pool, seen again — these are what build the engagement curve. */
  postsReobserved: number;
  /** Content scored for the first time. */
  analyzedNew: number;
  /** Content scored again (re-sighting, or the rubric version moved under it). */
  analyzedAgain: number;
  mediaArchived: number;
  mediaBytes: number;
  mediaFailed: number;
  /** Accounts still owed a profile fetch when the tick ran out of clock. */
  fetchesDeferred: number;
  /**
   * Posts harvested out of the profile fetches themselves — labelled on arrival, because the
   * account's median came back in the same call. This is where the pool actually grows early on;
   * discovery contributes breadth, these contribute usable rows.
   */
  historyPosts: number;
};

/** Media archived per tick. Buffered downloads, so this bounds memory as much as bandwidth. */
export const MAX_MEDIA_PER_TICK = 40;

/** Hours between publication and an observation. Null when the post carries no timestamp. */
export function ageHoursOf(publishedAt: string | null, observedAt: number): number | null {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return null;
  const hours = (observedAt - t) / 3_600_000;
  return hours >= 0 ? Math.round(hours * 100) / 100 : null;
}

/** Row shape for `market_posts`. Pure — exported for the unit test. */
export function marketPostRow(post: DiscoveredPost): AnyRec {
  const quality = scoreContentQuality({ caption: post.content, platform: post.platform });
  const engagement =
    post.metrics.likes + post.metrics.comments + post.metrics.shares;
  return {
    platform: post.platform,
    external_id: post.externalId,
    url: post.url,
    account_key: post.accountHandle,
    content: post.content,
    media_type: post.mediaType,
    format_bucket: formatBucket(post.mediaType),
    published_at: post.publishedAt,
    metrics: post.metrics,
    engagement,
    quality_index: quality.index,
    checks: checkValues(quality),
    scorer_version: CONTENT_SCORER_VERSION,
    query: post.query,
    category: post.category ?? null
  };
}

/**
 * Group discovered posts by account, keeping only accounts we could plausibly baseline.
 * Exported for the test: this is where a null handle silently costs you a label.
 */
export function accountsOf(posts: DiscoveredPost[]): Map<string, { platform: string; handle: string; count: number }> {
  const out = new Map<string, { platform: string; handle: string; count: number }>();
  for (const p of posts) {
    if (!p.accountHandle) continue;
    const key = `${p.platform}:${p.accountHandle}`;
    const hit = out.get(key);
    if (hit) hit.count++;
    else out.set(key, { platform: p.platform, handle: p.accountHandle, count: 1 });
  }
  return out;
}

/** A subreddit's chronological posts, shaped like a profile history so one code path handles both. */
async function subredditHistory(subreddit: string): Promise<NormalizedPost[]> {
  const { posts } = await fetchSubredditBaseline(subreddit, BASELINE_POSTS);
  return posts.map((p) => ({
    externalId: p.externalId,
    url: p.url,
    content: p.content,
    mediaType: p.mediaType as NormalizedPost['mediaType'],
    thumbnailUrl: null,
    publishedAt: p.publishedAt,
    metrics: { likes: p.metrics.likes, comments: p.metrics.comments, shares: p.metrics.shares }
  }));
}

type BaselineOutcome =
  | { ok: true; posts: number; medianEngagement: number; history: NormalizedPost[] }
  | { ok: false; reason: string };

/**
 * Fetch a real profile history: the median AND the posts it was computed from.
 *
 * Returning only the median — which is what this did first — pays for a call that hands back two
 * dozen posts and keeps one number. Those posts are the single richest thing in the whole loop:
 * they come from ONE account, so the denominator is already known, which makes every one of them
 * labellable the instant it lands. Discovery, by contrast, returns ten posts spread over ten
 * accounts and none of them can be labelled until those accounts recur.
 *
 * The failure reason is returned rather than collapsed into null: "the handle 404s" and "the account
 * has only 3 posts" and "every post has zero engagement" all mean no baseline, but only the first is
 * a bug to chase.
 */
async function historyBaseline(platform: string, handle: string): Promise<BaselineOutcome> {
  if (!BASELINE_CAPABLE.has(platform)) return { ok: false, reason: 'platform_not_fetchable' };
  try {
    const history =
      platform === 'reddit'
        ? await subredditHistory(handle)
        : await fetchProfileHistory(
            platform,
            { username: handle, profileUrl: null },
            { maxPages: 1, maxPosts: BASELINE_POSTS }
          );
    if (history.length < MIN_ACCOUNT_POSTS) {
      return { ok: false, reason: `too_few_posts (${history.length} < ${MIN_ACCOUNT_POSTS})` };
    }
    const med = median(history.map((h) => engagementOf({ accountKey: handle, metrics: h.metrics })));
    if (med <= 0) return { ok: false, reason: 'zero_median_engagement' };
    return { ok: true, posts: history.length, medianEngagement: med, history };
  } catch (e) {
    return { ok: false, reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

export type BaselineSweep = {
  /** Accounts whose profile fetch produced a usable median. */
  fetched: number;
  /** Labelled rows harvested out of those same fetches. */
  historyPosts: number;
  /** Accounts the clock ran out on — still queued, not dropped. */
  deferred: number;
  /** Rows that arrived with TikTok's own captions, so the judge never has to watch them. */
  transcripts: number;
  errors: HarvestError[];
};

/**
 * Build the fetch list: this run's accounts first, then whatever is still queued from before.
 *
 * `seen` is every account we intend to fetch, so the caller can tell which of its accounts fell
 * outside — those are the ones on platforms with no profile endpoint, which can only ever get a
 * baseline by recurring in discovery.
 */
export function fetchTargets(
  accounts: Array<{ platform: string; handle: string }>,
  queued: Array<{ platform: string; handle: string }> = []
): { fetchable: Array<{ platform: string; handle: string }>; seen: Set<string> } {
  const seen = new Set<string>();
  const fetchable: Array<{ platform: string; handle: string }> = [];
  // Freshly discovered accounts go first: their trending post is the reason we are here.
  for (const a of accounts) {
    if (!BASELINE_CAPABLE.has(a.platform)) continue;
    const key = `${a.platform}:${a.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fetchable.push({ platform: a.platform, handle: a.handle });
  }
  for (const a of queued) {
    const key = `${a.platform}:${a.handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fetchable.push({ platform: a.platform, handle: a.handle });
  }
  return { fetchable, seen };
}

/**
 * Fetch each account's profile, store its median, and keep the posts the call already returned.
 *
 * WHY THIS IS SHARED. A trending video whose account has no median cannot be told from a flop —
 * the median IS the label, and it is the only one that does not depend on follower count. Queueing
 * the account for a later tick means the video sits unlabelled for as long as the queue takes to
 * drain, which is the same as having wasted the search that found it. So every entry point that
 * discovers accounts calls this in the SAME run: the daily harvest and the trend sweep alike.
 *
 * The bound is the clock, never a count. Whatever does not fit stays queued and is picked up first
 * next time, ordered by how many of its posts are still waiting for a label.
 */
export async function ensureBaselines(
  admin: SupabaseClient,
  fetchable: Array<{ platform: string; handle: string }>,
  opts: { deadline: number; observedAt?: number }
): Promise<BaselineSweep> {
  const observedAt = opts.observedAt ?? Date.now();
  const errors: HarvestError[] = [];
  let fetched = 0;
  let historyPosts = 0;
  let deferred = 0;
  let transcripts = 0;

  for (const account of fetchable) {
    if (Date.now() > opts.deadline) {
      deferred++;
      continue;
    }
    const base = await historyBaseline(account.platform, account.handle);
    if (!base.ok) {
      // Not every miss is a fault — "too few posts" is a normal outcome — but a handle that keeps
      // erroring every tick is, and only the recorded reason tells the two apart.
      errors.push({
        stage: 'baseline',
        target: `${account.platform}:${account.handle}`,
        message: base.reason
      });
      await noteFetchAttempt(admin, account.platform, account.handle, base.reason).catch(swallow('note fetch attempt'));
      continue;
    }
    const { error } = await admin.from('market_account_baselines').upsert(
      {
        platform: account.platform,
        account_key: account.handle,
        posts: base.posts,
        median_engagement: base.medianEngagement,
        baseline_source: 'history',
        computed_at: new Date().toISOString()
      },
      { onConflict: 'platform,account_key' }
    );
    if (error) {
      errors.push({
        stage: 'baseline',
        target: `${account.platform}:${account.handle}`,
        message: error.message.slice(0, 300)
      });
      continue;
    }
    fetched++;
    await noteFetchAttempt(admin, account.platform, account.handle, null).catch(swallow('note fetch attempt'));

    // The call already returned this account's posts, and its median is now known — so every mature
    // one of them is labellable right now. Dropping them would mean paying for two dozen posts and
    // keeping a single number.
    const rowsFromHistory = historyPostRows(
      account.platform,
      account.handle,
      base.history,
      base.medianEngagement,
      observedAt
    );
    // TikTok has already transcribed some of these and hands the WebVTT over in the response we
    // just paid for. It has to be read NOW: the caption url is signed and carries its own `expire`,
    // so a link kept for later is a link that 403s. Bounded by the same deadline as the fetching —
    // a transcript is a bonus and must never cost an account its baseline.
    const sourceById = new Map(
      base.history.map((h) => [`hist:${account.platform}:${h.externalId}`, h])
    );
    for (const row of rowsFromHistory) {
      if (Date.now() > opts.deadline) break;
      const src = sourceById.get(String(row.external_id));
      if (!src?.captionsUrl) continue;
      const got = await fetchTranscript(src.captionsUrl, src.captionsLang);
      if (got.ok) {
        Object.assign(row, transcriptColumns(got.transcript, 'captions'));
        transcripts++;
      }
    }

    if (rowsFromHistory.length) {
      const { error: histErr } = await admin
        .from('market_posts')
        .upsert(rowsFromHistory, { onConflict: 'platform,external_id' });
      if (histErr) {
        errors.push({
          stage: 'baseline',
          target: `${account.platform}:${account.handle}`,
          message: `history_posts_insert: ${histErr.message.slice(0, 200)}`
        });
      } else {
        historyPosts += rowsFromHistory.length;
      }
    }
  }

  return { fetched, historyPosts, deferred, transcripts, errors };
}

/**
 * Turn an account's fetched history into labelled `market_posts` rows.
 *
 * Labelled on the spot, because the median is right there — no waiting for the account to recur.
 * Posts younger than MATURE_AGE_HOURS are dropped for the same reason the backfill drops them: a
 * history carries one reading per post, so there is no curve to age-normalise with, and comparing a
 * 3-hour-old post to a 3-month-old one on raw engagement measures age, not quality.
 *
 * Pure — exported for the test.
 */
export function historyPostRows(
  platform: string,
  accountKey: string,
  history: NormalizedPost[],
  medianEngagement: number,
  now: number
): AnyRec[] {
  const out: AnyRec[] = [];
  for (const h of history) {
    const publishedAt = h.publishedAt ? Date.parse(String(h.publishedAt)) : NaN;
    if (!Number.isFinite(publishedAt)) continue;
    if (now - publishedAt < MATURE_AGE_HOURS * 3_600_000) continue;

    const content = String(h.content ?? '').trim();
    if (!content) continue;

    const engagement = engagementOf({ accountKey, metrics: h.metrics });
    const quality = scoreContentQuality({ caption: content, platform });
    out.push({
      platform,
      // Prefixed so a profile-sourced row can never collide with the discovered one for the same
      // post — the trending post itself usually appears in both.
      external_id: `hist:${platform}:${h.externalId}`,
      url: h.url,
      account_key: accountKey,
      content,
      media_type: h.mediaType,
      format_bucket: formatBucket(h.mediaType),
      published_at: h.publishedAt,
      metrics: h.metrics ?? {},
      engagement,
      outperformance: Math.round((engagement / medianEngagement) * 1000) / 1000,
      quality_index: quality.index,
      checks: checkValues(quality),
      scorer_version: CONTENT_SCORER_VERSION,
      query: 'profile_history',
      // The profile endpoint returns a playable url for every video (measured 30/30) and we were
      // throwing it away. Without it the judge cannot watch a single post out of an account's
      // history — which is where the breakout posts live, next to the ordinary ones that are the
      // only honest control for them.
      media_url: h.videoUrl ?? h.thumbnailUrl ?? null,
      region: h.region ?? null,
      sound_id: h.soundId ?? null,
      sound_name: h.soundName ?? null,
      saves: h.metrics?.saves ?? null,
      duration_ms: h.durationMs ?? null,
      hashtags: h.hashtags?.length ? h.hashtags : null,
      sound_from: h.soundFrom ?? null,
      sound_is_original: h.soundFrom == null ? null : h.soundFrom === 'original',
      created_by_ai: h.createdByAi ?? null,
      video_ratio: h.videoRatio ?? null,
      video_width: h.videoWidth ?? null,
      video_height: h.videoHeight ?? null,
      shoot_mode: h.shootMode ?? null,
      video_url_clean: h.videoUrlClean ?? null,
      first_seen_at: new Date(now).toISOString(),
      observation_count: 1,
      analysis_count: 1,
      last_analyzed_at: new Date(now).toISOString()
    });
  }
  return out;
}

/**
 * Accounts that still owe us a profile fetch, most valuable first.
 *
 * Derived, not stored: any account with posts in the pool and no baseline is by definition pending.
 * Ordering by how many of its posts are already sitting unlabelled means the first fetch of a tick
 * unlocks the most rows — one call can turn a dozen orphaned trending posts into labelled ones.
 *
 * Accounts that failed recently, or too often, are held back so a dead handle cannot occupy the
 * queue ahead of live ones.
 */
export async function pendingAccounts(
  admin: SupabaseClient,
  opts: { limit?: number; now?: number } = {}
): Promise<Array<{ platform: string; handle: string; waiting: number }>> {
  const now = opts.now ?? Date.now();

  const { data: posts, error } = await admin
    .from('market_posts')
    .select('platform, account_key')
    .not('account_key', 'is', null)
    .is('outperformance', null)
    .limit(5000);
  if (error) throw new Error(`pending accounts query failed: ${error.message}`);

  const waiting = new Map<string, { platform: string; handle: string; waiting: number }>();
  for (const r of (posts ?? []) as AnyRec[]) {
    const platform = String(r.platform ?? '');
    if (!BASELINE_CAPABLE.has(platform)) continue;
    const handle = String(r.account_key ?? '');
    if (!handle) continue;
    const key = `${platform}:${handle}`;
    const hit = waiting.get(key);
    if (hit) hit.waiting++;
    else waiting.set(key, { platform, handle, waiting: 1 });
  }
  if (!waiting.size) return [];

  const [{ data: haveBaseline }, { data: attempts }] = await Promise.all([
    admin.from('market_account_baselines').select('platform, account_key').limit(5000),
    admin.from('market_account_fetch_attempts').select('platform, account_key, attempts, last_attempt_at').limit(5000)
  ]);

  for (const r of (haveBaseline ?? []) as AnyRec[]) waiting.delete(`${r.platform}:${r.account_key}`);
  for (const r of (attempts ?? []) as AnyRec[]) {
    const key = `${r.platform}:${r.account_key}`;
    if (!waiting.has(key)) continue;
    const tries = Number(r.attempts) || 0;
    const last = Date.parse(String(r.last_attempt_at));
    const coolingDown = Number.isFinite(last) && now - last < FETCH_RETRY_AFTER_MS;
    if (tries >= FETCH_MAX_ATTEMPTS || coolingDown) waiting.delete(key);
  }

  return [...waiting.values()]
    .sort((a, b) => b.waiting - a.waiting)
    .slice(0, opts.limit ?? MAX_BASELINE_FETCHES);
}

/** Record that we tried, so a dead handle backs off instead of blocking the queue every tick. */
async function noteFetchAttempt(
  admin: SupabaseClient,
  platform: string,
  handle: string,
  error: string | null
): Promise<void> {
  const { data } = await admin
    .from('market_account_fetch_attempts')
    .select('attempts')
    .eq('platform', platform)
    .eq('account_key', handle)
    .maybeSingle();
  await admin.from('market_account_fetch_attempts').upsert(
    {
      platform,
      account_key: handle,
      attempts: (Number(data?.attempts) || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      last_error: error?.slice(0, 300) ?? null
    },
    { onConflict: 'platform,account_key' }
  );
}

/**
 * One harvest tick.
 *
 * Idempotent on the post table: `unique (platform, external_id)` means a repeated sweep updates
 * rather than duplicates, so overlapping crons cannot inflate the pool and skew the fit.
 */
export async function runMarketHarvest(
  admin: SupabaseClient,
  plan: DiscoveryPlan & { maxBaselineFetches?: number; baselineTimeBudgetMs?: number } = {}
): Promise<HarvestResult> {
  const { posts: discovered, yields, errors: discoveryErrors } = await runDiscovery(plan);
  const errors: HarvestError[] = discoveryErrors.map((e) => ({
    stage: 'discovery' as const,
    target: `${e.source}/${e.category}: ${e.query}`,
    message: e.message
  }));
  if (!discovered.length) {
    return {
      discovered: 0,
      stored: 0,
      baselinesFromHistory: 0,
      baselinesFromDiscovery: 0,
      labelled: 0,
      yields,
      errors,
      postsNew: 0,
      postsReobserved: 0,
      analyzedNew: 0,
      analyzedAgain: 0,
      mediaArchived: 0,
      mediaBytes: 0,
      mediaFailed: 0,
      historyPosts: 0,
      fetchesDeferred: 0
    };
  }

  // ── Store what we found (scored, not yet labelled) ──────────────────────────────────────────
  //
  // The upsert keeps `market_posts` as the post's LATEST state; the engagement reading itself is
  // appended to market_post_observations instead of overwriting the previous one. Re-running the
  // same query an hour later therefore costs nothing extra and buys a point on the curve — which is
  // what lets every post be compared at a common age (see engagementAtAge).
  const rows = discovered.map(marketPostRow);
  const { data: stored, error: upsertErr } = await admin
    .from('market_posts')
    .upsert(rows, { onConflict: 'platform,external_id' })
    .select(
      'id, platform, external_id, published_at, engagement, first_seen_at, observation_count, analysis_count, media_path'
    );
  if (upsertErr) throw new Error(`market_posts upsert failed: ${upsertErr.message}`);

  const observedAt = Date.now();
  const observedIso = new Date(observedAt).toISOString();
  const byKey = new Map((stored ?? []).map((r: AnyRec) => [`${r.platform}:${r.external_id}`, r]));

  const observations: AnyRec[] = [];
  const lifecycle: AnyRec[] = [];
  let postsNew = 0;
  let postsReobserved = 0;
  let analyzedNew = 0;
  let analyzedAgain = 0;

  for (const post of discovered) {
    const row = byKey.get(`${post.platform}:${post.externalId}`);
    if (!row) continue;
    const engagement = post.metrics.likes + post.metrics.comments + post.metrics.shares;
    observations.push({
      market_post_id: row.id,
      observed_at: observedIso,
      age_hours: ageHoursOf(post.publishedAt, observedAt),
      engagement,
      metrics: post.metrics
    });

    // `marketPostRow` scored the content on the way in, so every sighting is an analysis. Counting
    // first-time vs repeat separately is what makes the run log readable: a day where re-analysis
    // dwarfs discovery means the queries have gone stale, not that the pool is growing.
    const priorAnalyses = Number(row.analysis_count) || 0;
    if (priorAnalyses === 0) analyzedNew++;
    else analyzedAgain++;
    if ((Number(row.observation_count) || 0) === 0) postsNew++;
    else postsReobserved++;

    lifecycle.push({
      id: row.id,
      first_seen_at: row.first_seen_at ?? observedIso,
      observation_count: (Number(row.observation_count) || 0) + 1,
      analysis_count: priorAnalyses + 1,
      last_analyzed_at: observedIso
    });
  }

  if (observations.length) {
    const { error: obsErr } = await admin.from('market_post_observations').insert(observations);
    // A failed observation must not lose the sweep: the posts are stored, the curve just misses a
    // point. Recorded, non-fatal for the run.
    if (obsErr) {
      console.error('[market-harvest] observations insert failed:', obsErr.message);
      errors.push({
        stage: 'observation',
        target: `${observations.length} readings`,
        message: obsErr.message.slice(0, 300)
      });
    }
  }
  for (const l of lifecycle) {
    await admin
      .from('market_posts')
      .update({
        first_seen_at: l.first_seen_at,
        observation_count: l.observation_count,
        analysis_count: l.analysis_count,
        last_analyzed_at: l.last_analyzed_at
      })
      .eq('id', l.id);
  }

  // ── Permanent copies of the media ───────────────────────────────────────────────────────────
  //
  // Platform CDN links are signed and die within days, so a post whose media is not archived while
  // the link is alive becomes text-only forever — and a video judge cannot re-score what it can no
  // longer fetch. Only posts we have not already archived are attempted, so a re-observation costs
  // nothing here.
  let mediaArchived = 0;
  let mediaBytes = 0;
  let mediaFailed = 0;
  const archivable = discovered
    .filter((p) => p.mediaUrl && !byKey.get(`${p.platform}:${p.externalId}`)?.media_path)
    .slice(0, MAX_MEDIA_PER_TICK);

  for (const post of archivable) {
    const row = byKey.get(`${post.platform}:${post.externalId}`);
    if (!row) continue;
    const archived = await archiveMarketMedia(admin, {
      platform: post.platform,
      externalId: post.externalId,
      url: post.mediaUrl as string
    });
    if (!archived.ok) {
      mediaFailed++;
      errors.push({
        stage: 'media',
        target: post.externalId,
        message: archived.detail ? `${archived.reason}: ${archived.detail}` : archived.reason
      });
      continue;
    }
    const { error } = await admin
      .from('market_posts')
      .update({
        media_url: post.mediaUrl,
        media_path: archived.media.path,
        media_bytes: archived.media.bytes,
        media_kind: archived.media.kind,
        media_archived_at: new Date().toISOString()
      })
      .eq('id', row.id);
    if (error) {
      mediaFailed++;
      errors.push({ stage: 'media', target: post.externalId, message: error.message.slice(0, 300) });
      continue;
    }
    mediaArchived++;
    mediaBytes += archived.media.bytes;
  }

  // ── Baselines: unbiased where we can fetch, accumulated where we cannot ─────────────────────
  const accounts = [...accountsOf(discovered).values()].sort((a, b) => b.count - a.count);
  let fromHistory = 0;
  let fromDiscovery = 0;

  let historyPosts = 0;

  // The fetch list is THIS tick's discovered accounts plus everything still queued from before.
  // Nothing is dropped for being over a count — the bound is the clock, and whatever does not fit
  // stays pending for the next tick. Dropping an account would strand its trending post unlabelled
  // forever, which is the same as having wasted the search that found it.
  const queued = await pendingAccounts(admin, { limit: MAX_BASELINE_FETCHES, now: observedAt }).catch((e) => {
    errors.push({ stage: 'baseline', target: 'queue', message: e instanceof Error ? e.message : String(e) });
    return [] as Array<{ platform: string; handle: string; waiting: number }>;
  });

  const { fetchable, seen } = fetchTargets(accounts, queued);
  const sweep = await ensureBaselines(admin, fetchable, {
    deadline: observedAt + (plan.baselineTimeBudgetMs ?? BASELINE_TIME_BUDGET_MS),
    observedAt
  });
  fromHistory = sweep.fetched;
  historyPosts = sweep.historyPosts;
  errors.push(...sweep.errors);
  if (sweep.deferred) {
    console.log(
      `[market-harvest] ${sweep.deferred} account rimandati al prossimo tick (budget tempo esaurito)`
    );
  }

  // For everything else, recompute from what the pool has accumulated so far. This only becomes
  // usable once an account has recurred enough times to clear MIN_ACCOUNT_POSTS.
  const pending = accounts.filter((a) => !seen.has(`${a.platform}:${a.handle}`));
  for (const account of pending) {
    const { data, error } = await admin
      .from('market_posts')
      .select('engagement')
      .eq('platform', account.platform)
      .eq('account_key', account.handle)
      .limit(200);
    if (error) {
      errors.push({
        stage: 'baseline',
        target: `${account.platform}:${account.handle}`,
        message: error.message.slice(0, 300)
      });
      continue;
    }
    if (!data || data.length < MIN_ACCOUNT_POSTS) continue;
    const med = median(data.map((r: AnyRec) => Number(r.engagement) || 0));
    if (med <= 0) continue;

    // Never downgrade a 'history' baseline to a 'discovered' one.
    const { data: existing } = await admin
      .from('market_account_baselines')
      .select('baseline_source')
      .eq('platform', account.platform)
      .eq('account_key', account.handle)
      .maybeSingle();
    if (existing?.baseline_source === 'history') continue;

    const { error: upErr } = await admin.from('market_account_baselines').upsert(
      {
        platform: account.platform,
        account_key: account.handle,
        posts: data.length,
        median_engagement: med,
        baseline_source: 'discovered',
        computed_at: new Date().toISOString()
      },
      { onConflict: 'platform,account_key' }
    );
    if (!upErr) fromDiscovery++;
  }

  // ── Label: attach outperformance to every post whose account now has a baseline ─────────────
  const labelled = await relabelMarketPosts(admin, [...accountsOf(discovered).values()]);

  return {
    discovered: discovered.length,
    stored: rows.length,
    baselinesFromHistory: fromHistory,
    baselinesFromDiscovery: fromDiscovery,
    labelled,
    yields,
    errors,
    postsNew,
    postsReobserved,
    analyzedNew,
    analyzedAgain,
    mediaArchived,
    mediaBytes,
    mediaFailed,
    historyPosts,
    fetchesDeferred: sweep.deferred
  };
}

/**
 * Interpolate every post's curve to the common reference age and store it.
 *
 * Only posts whose observations straddle the reference age get a value; the rest keep null and are
 * simply not comparable yet. That is the honest outcome — they become comparable tomorrow, once the
 * hourly loop has seen them on the far side of 24h.
 */
/**
 * Store how fast each post was still moving between two sightings.
 *
 * This REPLACES the age normalisation, which could never fire. `engagementAtAge` needs observations
 * straddling the reference age; every post enters the bank already mature — the trending feeds
 * return work from days or months ago, and history rows are filtered to MATURE_AGE_HOURS by
 * construction — so the first sighting is always past 24h and the value was always null. Thousands
 * of rows, zero written.
 *
 * The confound it was defending against largely is not there: when everything held has settled,
 * comparing a two-month-old post to a six-month-old one on final engagement is fair.
 *
 * What IS measurable, and what the observations we already collect make available today, is
 * velocity. A post that gained a thousand interactions in twelve hours and one that gained nothing
 * can carry the same final engagement and are not the same thing: the first was still in
 * distribution when we looked, and its outperformance is an UNDERSTATEMENT.
 */
export async function refreshVelocity(admin: SupabaseClient, limit = 2000): Promise<number> {
  const { data: posts, error } = await admin
    .from('market_posts')
    .select('id')
    .gte('observation_count', 2)
    .is('velocity_per_hour', null)
    .order('discovered_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`market posts for velocity query failed: ${error.message}`);

  let updated = 0;
  for (const p of (posts ?? []) as AnyRec[]) {
    const { data: obs, error: obsErr } = await admin
      .from('market_post_observations')
      .select('age_hours, engagement')
      .eq('market_post_id', p.id)
      .not('age_hours', 'is', null)
      .order('age_hours', { ascending: true })
      .limit(200);
    if (obsErr || !obs?.length) continue;

    const value = velocity(
      (obs as AnyRec[]).map((o) => ({ ageHours: Number(o.age_hours), engagement: Number(o.engagement) }))
    );
    if (value == null) continue;

    const { error: updErr } = await admin
      .from('market_posts')
      .update({
        velocity_per_hour: Math.round(value * 100) / 100,
        velocity_measured_at: new Date().toISOString()
      })
      .eq('id', p.id);
    if (!updErr) updated++;
  }
  return updated;
}

/**
 * Recompute `outperformance` for the given accounts (or all of them).
 *
 * Separate from the sweep because a baseline learned today retroactively labels posts harvested
 * last week — the pool gets more useful over time without re-fetching anything.
 */
export async function relabelMarketPosts(
  admin: SupabaseClient,
  accounts?: Array<{ platform: string; handle: string }>
): Promise<number> {
  let baselineQuery = admin
    .from('market_account_baselines')
    .select('platform, account_key, median_engagement');
  if (accounts?.length) {
    baselineQuery = baselineQuery.in('account_key', accounts.map((a) => a.handle));
  }
  const { data: baselines, error } = await baselineQuery;
  if (error) throw new Error(`market baselines query failed: ${error.message}`);

  let updated = 0;
  for (const b of (baselines ?? []) as AnyRec[]) {
    const med = Number(b.median_engagement);
    if (!Number.isFinite(med) || med <= 0) continue;

    const { data: posts, error: postErr } = await admin
      .from('market_posts')
      .select('id, engagement')
      .eq('platform', b.platform)
      .eq('account_key', b.account_key)
      .limit(500);
    if (postErr || !posts?.length) continue;

    for (const p of posts as AnyRec[]) {
      const ratio = (Number(p.engagement) || 0) / med;
      const { error: updErr } = await admin
        .from('market_posts')
        .update({ outperformance: Math.round(ratio * 1000) / 1000 })
        .eq('id', p.id);
      if (!updErr) updated++;
    }
  }
  return updated;
}

export type MarketFit = {
  scorerVersion: number;
  pool: { total: number; labelled: number };
  overall: ReturnType<typeof correlateChecks>;
  byFormat: ReturnType<typeof correlateByFormat>;
  byCategory: ReturnType<typeof correlateByCategory>;
  /** Share of the labelled pool resting on a biased baseline — read the fit through this. */
  discoveredBaselineShare: number;
};

/**
 * The report: for each rubric check, does it actually track posts that beat their own baseline?
 *
 * Deliberately returns evidence and nothing else. It does not, and must not, rewrite any weight:
 * the rubric is a frozen measuring stick (see docs/33), and a stick that retunes itself nightly
 * measures nothing. A person reads this, decides, bumps CONTENT_SCORER_VERSION, and re-scores
 * history — which is free, because scoring is deterministic.
 */
export async function marketFit(admin: SupabaseClient, opts: { limit?: number } = {}): Promise<MarketFit> {
  const { data, error } = await admin
    .from('market_posts')
    .select('checks, outperformance, platform, format_bucket, category, account_key')
    .eq('scorer_version', CONTENT_SCORER_VERSION)
    .not('outperformance', 'is', null)
    .order('discovered_at', { ascending: false })
    .limit(opts.limit ?? 20_000);
  if (error) throw new Error(`market fit query failed: ${error.message}`);

  const rows = (data ?? []) as AnyRec[];
  const scored: ScoredMarketPost[] = rows.map((r) => ({
    checks: (r.checks ?? {}) as Record<string, number>,
    outperformance: Number(r.outperformance),
    platform: r.platform,
    format: r.format_bucket,
    category: r.category
  }));

  const { count: total } = await admin
    .from('market_posts')
    .select('id', { count: 'exact', head: true });

  const { count: biased } = await admin
    .from('market_account_baselines')
    .select('account_key', { count: 'exact', head: true })
    .eq('baseline_source', 'discovered');
  const { count: allBaselines } = await admin
    .from('market_account_baselines')
    .select('account_key', { count: 'exact', head: true });

  return {
    scorerVersion: CONTENT_SCORER_VERSION,
    pool: { total: total ?? rows.length, labelled: rows.length },
    overall: correlateChecks(scored),
    byFormat: correlateByFormat(scored),
    byCategory: correlateByCategory(scored),
    discoveredBaselineShare: allBaselines ? Math.round(((biased ?? 0) / allBaselines) * 100) / 100 : 0
  };
}

/**
 * Append one row to the harvest run log.
 *
 * A bare counter tells you a total; a run log tells you the SHAPE of the pipeline over time — which
 * source dried up, when re-analysis overtook discovery (the sign that the query mix has gone stale
 * rather than the pool growing), and what the media archive actually costs per day.
 *
 * Never throws: losing the log entry must not lose the harvest it describes.
 */
export async function recordHarvestRun(
  admin: SupabaseClient,
  result: HarvestResult,
  meta: { startedAt: string; categories?: string[]; error?: string | null }
): Promise<string | null> {
  const { data, error } = await admin.from('market_harvest_runs').insert({
    started_at: meta.startedAt,
    finished_at: new Date().toISOString(),
    discovered: result.discovered,
    posts_new: result.postsNew,
    posts_reobserved: result.postsReobserved,
    analyzed_new: result.analyzedNew,
    analyzed_again: result.analyzedAgain,
    media_archived: result.mediaArchived,
    media_bytes: result.mediaBytes,
    media_failed: result.mediaFailed,
    history_posts: result.historyPosts,
    fetches_deferred: result.fetchesDeferred,
    baselines_history: result.baselinesFromHistory,
    baselines_discovered: result.baselinesFromDiscovery,
    labelled: result.labelled,
    yields: result.yields,
    errors: result.errors.length ? result.errors.slice(0, 200) : null,
    error_count: result.errors.length,
    categories: meta.categories ?? null,
    error: meta.error ?? null
  })
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[market-harvest] run log insert failed:', error.message);
    return null;
  }
  return data?.id ? String(data.id) : null;
}

// ── Bootstrap: seed the pool from history we already hold ────────────────────────────────────

/**
 * Posts younger than this are excluded from the backfill.
 *
 * The backfill has no trajectory — `social_post_history` stores one metrics snapshot per post, not
 * a series — so it cannot age-normalise. That is fine for MATURE posts and only for those: a post's
 * engagement climbs steeply for a day and then flattens, so at 3 months versus 6 months the two are
 * both effectively final and comparable. At 3 hours versus 30 they are not, and including them would
 * quietly reintroduce the exact age confound the hourly loop exists to remove.
 */
export const MATURE_AGE_HOURS = 48;

export type BackfillResult = {
  accounts: number;
  baselines: number;
  posts: number;
  skippedImmature: number;
  skippedSmallAccounts: number;
};

/**
 * Seed `market_posts` from `social_post_history`, which we already have.
 *
 * WHY THIS IS THE FASTEST PATH. Discovery returns roughly ten posts spread over ten different
 * accounts, and an account needs MIN_ACCOUNT_POSTS before any of its posts can be labelled — so a
 * search call yields, at first, zero usable labels. History is the opposite shape: every
 * (brand_id, platform) group is ONE account's full profile history, winners and flops together,
 * which is both an unbiased baseline and a whole batch of labelled posts at once. Thousands of rows,
 * no API calls, no waiting for accounts to recur.
 *
 * WHAT IT IS NOT. This pool is whatever our brands and their competitors publish, so it is narrower
 * and more skewed by vertical than the open web. It is a SEED that makes the fit reportable in hours
 * instead of weeks — not a substitute for discovery breadth. Rows are marked `category='seed'` so a
 * fit can always be read with and without them.
 */
export async function backfillFromHistory(
  admin: SupabaseClient,
  opts: { limit?: number; now?: number } = {}
): Promise<BackfillResult> {
  const now = opts.now ?? Date.now();
  const { data, error } = await admin
    .from('social_post_history')
    .select('brand_id, platform, external_post_id, platform_post_url, content, media_type, published_at, metrics')
    .not('content', 'is', null)
    .order('published_at', { ascending: false })
    .limit(opts.limit ?? 10_000);
  if (error) throw new Error(`social_post_history query failed: ${error.message}`);

  const rows = (data ?? []) as AnyRec[];

  // One account = one (brand, platform) pair. A brand with two handles on the same platform would
  // merge into one baseline; rare, and acceptable for a seed — the alternative is a handle column
  // that table does not have.
  const byAccount = new Map<string, AnyRec[]>();
  let skippedImmature = 0;
  for (const r of rows) {
    const publishedAt = r.published_at ? Date.parse(String(r.published_at)) : NaN;
    if (!Number.isFinite(publishedAt)) continue;
    if (now - publishedAt < MATURE_AGE_HOURS * 3_600_000) {
      skippedImmature++;
      continue;
    }
    const key = `${r.platform ?? 'other'}:${r.brand_id}`;
    const list = byAccount.get(key);
    if (list) list.push(r);
    else byAccount.set(key, [r]);
  }

  let baselines = 0;
  let posts = 0;
  let skippedSmallAccounts = 0;

  for (const [accountKey, accountRows] of byAccount) {
    if (accountRows.length < MIN_ACCOUNT_POSTS) {
      skippedSmallAccounts++;
      continue;
    }
    const platform = String(accountRows[0].platform ?? 'other');
    const engagements = accountRows.map((r) =>
      engagementOf({ accountKey, metrics: (r.metrics ?? {}) as Record<string, unknown> })
    );
    const med = median(engagements);
    if (med <= 0) {
      skippedSmallAccounts++;
      continue;
    }

    // These ARE full profile histories, so the baseline is genuinely unbiased — 'history', not
    // 'discovered'.
    const { error: baseErr } = await admin.from('market_account_baselines').upsert(
      {
        platform,
        account_key: accountKey,
        posts: accountRows.length,
        median_engagement: med,
        baseline_source: 'history',
        computed_at: new Date(now).toISOString()
      },
      { onConflict: 'platform,account_key' }
    );
    if (baseErr) continue;
    baselines++;

    const postRows = accountRows.map((r, i) => {
      const quality = scoreContentQuality({ caption: String(r.content ?? ''), platform });
      const engagement = engagements[i];
      return {
        platform,
        // Prefixed so a seeded row can never collide with a discovered one.
        external_id: `seed:${r.external_post_id ?? `${r.brand_id}:${i}`}`,
        url: r.platform_post_url ?? null,
        account_key: accountKey,
        content: r.content,
        media_type: r.media_type,
        format_bucket: formatBucket(r.media_type),
        published_at: r.published_at,
        metrics: r.metrics ?? {},
        engagement,
        outperformance: Math.round((engagement / med) * 1000) / 1000,
        quality_index: quality.index,
        checks: checkValues(quality),
        scorer_version: CONTENT_SCORER_VERSION,
        query: 'backfill:social_post_history',
        category: 'seed',
        first_seen_at: new Date(now).toISOString(),
        observation_count: 1,
        analysis_count: 1,
        last_analyzed_at: new Date(now).toISOString()
      };
    });

    const { error: insErr } = await admin
      .from('market_posts')
      .upsert(postRows, { onConflict: 'platform,external_id' });
    if (!insErr) posts += postRows.length;
  }

  return {
    accounts: byAccount.size,
    baselines,
    posts,
    skippedImmature,
    skippedSmallAccounts
  };
}

/**
 * Row shape for a trending Instagram/TikTok clip. Pure — exported for the test.
 *
 * Differs from `marketPostRow` in the two things a video surface gives and a text one does not: a
 * view count, and therefore a resonance figure. Engagement stays interactions-only so the label is
 * the same quantity everywhere; views ride alongside rather than inside it.
 */
export function trendPostRow(video: TrendingVideo, category?: string | null): AnyRec {
  const quality = scoreContentQuality({ caption: video.caption, platform: video.platform });
  const engagement = video.metrics.likes + video.metrics.comments + video.metrics.shares;
  return {
    platform: video.platform,
    external_id: video.externalId,
    url: video.url,
    account_key: video.accountHandle,
    content: video.caption,
    media_type: 'video',
    format_bucket: 'video',
    published_at: video.publishedAt,
    metrics: video.metrics,
    engagement,
    views: video.metrics.views || null,
    interaction_rate: interactionRate(video.metrics),
    // The CDN link dies within days; the archiver copies it while it is alive, and the judge needs
    // a fetchable clip to watch.
    media_url: video.videoUrl,
    quality_index: quality.index,
    checks: checkValues(quality),
    scorer_version: CONTENT_SCORER_VERSION,
    query: video.source,
    region: video.region ?? null,
    sound_id: video.soundId ?? null,
    sound_name: video.soundName ?? null,
    is_ad: video.isAd ?? null,
    is_paid_partnership: video.isPaidPartnership ?? null,
    saves: video.saves ?? null,
    caption_language: video.captionLanguage ?? null,
    duration_ms: video.durationMs ?? null,
    hashtags: video.hashtags?.length ? video.hashtags : null,
    sound_from: video.soundFrom ?? null,
    sound_is_original: video.soundIsOriginal ?? null,
    created_by_ai: video.createdByAi ?? null,
    video_ratio: video.videoRatio ?? null,
    video_width: video.videoWidth ?? null,
    video_height: video.videoHeight ?? null,
    shoot_mode: video.shootMode ?? null,
    video_url_clean: video.videoUrlClean ?? null,
    watch_threshold_ms: video.watchThresholdMs ?? null,
    watch_prob: video.watchProb ?? null,
    watch_avg_ms: video.watchAvgMs ?? null,
    category: category ?? video.category ?? null
  };
}

/**
 * Store a trending sweep: rows, an observation each, and the baselines their accounts need.
 *
 * Instagram and TikTok are both profile-fetchable, so unlike the text sources every account here can
 * be baselined on sight — which means these posts are labellable without waiting for anything to
 * recur. `runMarketHarvest`'s queue then picks up whatever the clock did not reach.
 */
export async function storeTrendVideos(
  admin: SupabaseClient,
  videos: TrendingVideo[]
): Promise<{ stored: number; observations: number; archived: number; transcripts: number }> {
  if (!videos.length) return { stored: 0, observations: 0, archived: 0, transcripts: 0 };

  const rows = videos.map((v) => trendPostRow(v));

  // Same rule as the video file: the caption url is signed, so it is read now or never. Coverage on
  // this surface is thinner than on profile histories (2 of 20 measured against 8 of 30), but a
  // transcript that costs nothing extra is worth taking wherever it shows up.
  let transcripts = 0;
  for (let i = 0; i < videos.length; i++) {
    const url = videos[i].captionsUrl;
    if (!url) continue;
    const got = await fetchTranscript(url, videos[i].captionsLang);
    if (!got.ok) continue;
    Object.assign(rows[i], transcriptColumns(got.transcript, 'captions'));
    transcripts++;
  }
  const { data: saved, error } = await admin
    .from('market_posts')
    .upsert(rows, { onConflict: 'platform,external_id' })
    .select('id, platform, external_id, published_at, observation_count, first_seen_at, media_path');
  if (error) throw new Error(`trend posts upsert failed: ${error.message}`);

  const observedAt = Date.now();
  const observedIso = new Date(observedAt).toISOString();
  const byKey = new Map((saved ?? []).map((r: AnyRec) => [`${r.platform}:${r.external_id}`, r]));

  const observations: AnyRec[] = [];
  for (const v of videos) {
    const row = byKey.get(`${v.platform}:${v.externalId}`);
    if (!row) continue;
    observations.push({
      market_post_id: row.id,
      observed_at: observedIso,
      age_hours: ageHoursOf(v.publishedAt, observedAt),
      engagement: v.metrics.likes + v.metrics.comments + v.metrics.shares,
      metrics: v.metrics
    });
    await admin
      .from('market_posts')
      .update({
        first_seen_at: row.first_seen_at ?? observedIso,
        observation_count: (Number(row.observation_count) || 0) + 1,
        analysis_count: 1,
        last_analyzed_at: observedIso
      })
      .eq('id', row.id);
  }
  if (observations.length) {
    const { error: obsErr } = await admin.from('market_post_observations').insert(observations);
    if (obsErr) console.error('[market-trends] observations insert failed:', obsErr.message);
  }

  // A permanent copy of the clip, so a better judge can re-watch it after the CDN link dies. This is
  // what makes the corpus an asset rather than a log.
  let archived = 0;
  const toArchive = videos
    .filter((v) => v.videoUrl && !byKey.get(`${v.platform}:${v.externalId}`)?.media_path)
    .slice(0, MAX_MEDIA_PER_TICK);
  for (const v of toArchive) {
    const row = byKey.get(`${v.platform}:${v.externalId}`);
    if (!row) continue;
    const result = await archiveMarketMedia(admin, {
      platform: v.platform,
      externalId: v.externalId,
      url: v.videoUrl as string
    });
    if (!result.ok) continue;
    const { error: updErr } = await admin
      .from('market_posts')
      .update({
        media_path: result.media.path,
        media_bytes: result.media.bytes,
        media_kind: result.media.kind,
        media_archived_at: new Date().toISOString()
      })
      .eq('id', row.id);
    if (!updErr) archived++;
  }

  return { stored: rows.length, observations: observations.length, archived, transcripts };
}
