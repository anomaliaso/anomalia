/**
 * Daily discovery of high-performing posts across the open web — stage 1 of the market harvest.
 *
 * These are the same ScrapeCreators search surfaces `radar.ts` already uses in production, with one
 * difference that is the entire reason this module exists: radar maps every result onto a
 * conversation item and THROWS THE ENGAGEMENT AWAY, because it is hunting threads to reply to, not
 * posts to learn from. Here the counts are the payload.
 *
 * Stage 2 lives in `market-harvest.ts`: discovery hands back a post plus the handle that published
 * it, that account's recent history supplies the median, and only then does the post get a label
 * (see `market-metrics.ts` for why the label must be relative to its own account).
 *
 * BEST-EFFORT BUT NEVER SILENT. A dead platform degrades the sweep, it does not fail it — but the
 * reason is carried out with the results and lands in the run log. An error swallowed into an empty
 * array makes a broken endpoint look like a quiet day, which is how a source rots for weeks unseen.
 *
 * Parsing is defensive on purpose: these payloads are third-party, differ per platform, and change
 * without notice. Anything unparseable is dropped rather than guessed at, because a post with the
 * wrong engagement attached is worse for the fit than no post at all.
 */
import { scrapeCreatorsGet } from '$lib/server/scrapecreators';
import { PLATFORM_IDS } from '$lib/platforms';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Platforms whose search surface returns engagement counts we can trust. */
export const DISCOVERY_PLATFORMS = [PLATFORM_IDS.threads, PLATFORM_IDS.linkedin, PLATFORM_IDS.reddit] as const;
export type DiscoveryPlatform = (typeof DISCOVERY_PLATFORMS)[number];

export type DiscoveredPost = {
  platform: DiscoveryPlatform;
  /** Stable per-platform id, used to dedupe across queries and days. */
  externalId: string;
  url: string;
  /** The handle that published it — stage 2 needs this to fetch the account's baseline. */
  accountHandle: string | null;
  content: string;
  mediaType: string | null;
  /** Platform CDN link — signed and short-lived. Archive it while it is alive (market-media.ts). */
  mediaUrl: string | null;
  publishedAt: string | null;
  metrics: { likes: number; comments: number; shares: number };
  /** The query that surfaced it, kept so a skewed query mix is visible in the report. */
  query: string;
  /** Vertical it was harvested under. Lets the fit be segmented instead of averaged into mush. */
  category?: string;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const clean = (v: unknown, max = 4000): string =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** ISO from a unix timestamp in seconds or milliseconds. Null when absent or nonsensical. */
export function isoFromEpoch(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Drop anything older than `days`. Discovery is a DAILY loop; stale hits pollute the window. */
export function isFresh(publishedAt: string | null, now: number, days: number): boolean {
  if (!publishedAt) return false;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return false;
  return now - t <= days * 86_400_000 && t <= now + 3_600_000;
}

// ── Parsers (pure, exported for the unit tests) ──────────────────────────────────────────────

export function parseThreadsSearch(data: unknown, query: string): DiscoveredPost[] {
  const posts = (data as AnyRec)?.posts;
  if (!Array.isArray(posts)) return [];
  const out: DiscoveredPost[] = [];
  for (const p of posts as AnyRec[]) {
    const handle = clean(p?.user?.username, 100) || null;
    const code = clean(p?.code, 100);
    if (!code || !handle) continue;
    const text = clean(p?.caption?.text);
    if (!text) continue;
    const videoUrl = clean(p?.video_versions?.[0]?.url, 2000) || null;
    const imageUrl = clean(p?.image_versions2?.candidates?.[0]?.url, 2000) || null;
    out.push({
      platform: 'threads',
      externalId: `threads:${code}`,
      url: `https://www.threads.net/@${handle}/post/${code}`,
      accountHandle: handle,
      content: text,
      mediaType: videoUrl ? 'video' : imageUrl ? 'image' : 'text',
      mediaUrl: videoUrl ?? imageUrl,
      publishedAt: isoFromEpoch(p?.taken_at),
      metrics: {
        likes: num(p?.like_count),
        comments: num(p?.text_post_app_info?.direct_reply_count ?? p?.reply_count),
        shares: num(p?.text_post_app_info?.repost_count ?? p?.repost_count)
      },
      query
    });
  }
  return out;
}

export function parseLinkedInSearch(data: unknown, query: string): DiscoveredPost[] {
  const posts = (data as AnyRec)?.posts;
  if (!Array.isArray(posts)) return [];
  const out: DiscoveredPost[] = [];
  for (const p of posts as AnyRec[]) {
    const url = clean(p?.url, 500);
    const text = clean(p?.description);
    if (!url || !text) continue;
    const ts = p?.datePublished ? Date.parse(String(p.datePublished)) : NaN;
    out.push({
      platform: 'linkedin',
      externalId: `linkedin:${url}`,
      url,
      // LinkedIn search returns a display name, not a handle — usable as an account key for the
      // baseline grouping even though it cannot be fed back to a profile endpoint.
      accountHandle: clean(p?.author?.name, 200) || null,
      content: text,
      mediaType: p?.video ? 'video' : p?.image ? 'image' : 'text',
      mediaUrl: clean(p?.video?.url ?? p?.video ?? p?.image?.url ?? p?.image, 2000) || null,
      publishedAt: Number.isNaN(ts) ? null : new Date(ts).toISOString(),
      metrics: {
        likes: num(p?.numLikes ?? p?.likes),
        comments: num(p?.numComments ?? p?.comments),
        shares: num(p?.numShares ?? p?.shares)
      },
      query
    });
  }
  return out;
}

export function parseRedditSearch(data: unknown, query: string): DiscoveredPost[] {
  const posts = (data as AnyRec)?.posts;
  if (!Array.isArray(posts)) return [];
  const out: DiscoveredPost[] = [];
  for (const p of posts as AnyRec[]) {
    const permalink = clean(p?.permalink, 500);
    const title = clean(p?.title, 500);
    if (!permalink || !title) continue;
    const url = permalink.startsWith('http')
      ? permalink
      : `https://www.reddit.com${permalink.startsWith('/') ? permalink : `/${permalink}`}`;
    if (!url.includes('/comments/')) continue;
    out.push({
      platform: 'reddit',
      externalId: `reddit:${permalink}`,
      url,
      // Group by subreddit, not by author: the subreddit is what has a stable engagement baseline,
      // and a redditor's karma across unrelated subs is not a comparable denominator.
      accountHandle: clean(p?.subreddit, 100) || null,
      content: [title, clean(p?.selftext)].filter(Boolean).join('\n\n'),
      mediaType: 'text',
      // Reddit search is dominated by self posts; an image link post still exposes its url.
      mediaUrl: /\.(jpg|jpeg|png|gif|webp|mp4)$/i.test(String(p?.url ?? '')) ? clean(p?.url, 2000) : null,
      publishedAt: isoFromEpoch(p?.created_utc),
      metrics: {
        likes: num(p?.score ?? p?.ups),
        comments: num(p?.num_comments),
        shares: 0
      },
      query
    });
  }
  return out;
}

/** Drop repeats across queries and platforms, keeping the first (highest-ranked) sighting. */
export function dedupeDiscovered(posts: DiscoveredPost[]): DiscoveredPost[] {
  const seen = new Set<string>();
  const out: DiscoveredPost[] = [];
  for (const p of posts) {
    if (seen.has(p.externalId)) continue;
    seen.add(p.externalId);
    out.push(p);
  }
  return out;
}

// ── Fetchers (I/O) ───────────────────────────────────────────────────────────────────────────
//
// A failed source must not fail the sweep — but it must not vanish either. Swallowing the error
// and returning `[]` makes a dead endpoint indistinguishable from a genuinely quiet day, which is
// the failure mode where a source rots for weeks and the pool just looks a bit smaller. So every
// fetcher returns its reason alongside its posts, and the caller records it in the run log.

export type FetchOutcome = { posts: DiscoveredPost[]; error?: string };

export type DiscoveryError = {
  source: string;
  category: string;
  query: string;
  message: string;
};

function reasonOf(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+/g, ' ').trim().slice(0, 300) || 'unknown error';
}

async function safeGet(path: string): Promise<{ data?: unknown; error?: string }> {
  try {
    return { data: await scrapeCreatorsGet(path) };
  } catch (e) {
    return { error: reasonOf(e) };
  }
}

/** An endpoint that answers but returns nothing parseable is worth distinguishing from a 500. */
function toOutcome(
  res: { data?: unknown; error?: string },
  parse: (data: unknown) => DiscoveredPost[]
): FetchOutcome {
  if (res.error) return { posts: [], error: res.error };
  const posts = parse(res.data);
  if (!posts.length && (res.data == null || typeof res.data !== 'object')) {
    return { posts, error: 'risposta non interpretabile' };
  }
  return { posts };
}

export async function discoverThreads(query: string): Promise<FetchOutcome> {
  // NB (from radar.ts, verified live): this endpoint's start_date filter returns 0 results, so the
  // freshness cut has to happen on our side.
  const res = await safeGet(`/v1/threads/search?query=${encodeURIComponent(query)}&trim=true`);
  return toOutcome(res, (d) => parseThreadsSearch(d, query));
}

export async function discoverLinkedIn(query: string): Promise<FetchOutcome> {
  const res = await safeGet(
    `/v1/linkedin/search/posts?query=${encodeURIComponent(query)}&date_posted=last-day`
  );
  return toOutcome(res, (d) => parseLinkedInSearch(d, query));
}

export async function discoverReddit(query: string): Promise<FetchOutcome> {
  const res = await safeGet(
    `/v1/reddit/search?query=${encodeURIComponent(query)}&sort=top&timeframe=day&trim=true`
  );
  return toOutcome(res, (d) => parseRedditSearch(d, query));
}

/**
 * A subreddit's recent posts in chronological order — the unbiased sample.
 *
 * This is Reddit's equivalent of a profile history, and the distinction from `rising`/`top` is the
 * whole point: those return a community at its best, so a median computed from them sits above the
 * typical post. `sort=new` returns whatever was posted, hits and flops alike, which is the only
 * shape a denominator can honestly come from.
 */
export async function fetchSubredditBaseline(subreddit: string, limit = 30): Promise<FetchOutcome> {
  const s = subreddit.replace(/^\/?r\//i, '').trim();
  if (!s) return { posts: [] };
  const res = await safeGet(
    `/v1/reddit/subreddit?subreddit=${encodeURIComponent(s)}&sort=new&trim=true`
  );
  const outcome = toOutcome(res, (d) => parseRedditSearch(d, `r/${s}:baseline`));
  return { ...outcome, posts: outcome.posts.slice(0, limit) };
}

/** Trending within a community: `sort=rising` is Reddit's own "gaining traction now". */
export async function discoverRisingSubreddit(subreddit: string): Promise<FetchOutcome> {
  const s = subreddit.replace(/^\/?r\//i, '').trim();
  if (!s) return { posts: [] };
  const res = await safeGet(`/v1/reddit/subreddit?subreddit=${encodeURIComponent(s)}&sort=rising&trim=true`);
  return toOutcome(res, (d) => parseRedditSearch(d, `r/${s}:rising`));
}

// ── Categories ────────────────────────────────────────────────────────────────────────────────
//
// A single narrow query mix teaches the rubric one niche's quirks as if they were universal, and
// leaves the pool dominated by whichever query happened to return the most. Stratifying by category
// fixes both: the fit can be segmented per vertical, and a per-category cap stops one loud niche
// from deciding the whole correlation.
//
// COVERAGE COMES FROM ROTATION, NOT FROM VOLUME. Running every category every hour would multiply
// the ScrapeCreators bill by the number of categories; `categoriesForTick` walks a few per tick
// instead, so a full pass completes over the day at roughly the cost of one broad sweep.

export type DiscoveryCategory = {
  id: string;
  queries: string[];
  risingSubreddits?: string[];
};

/**
 * Default verticals. Deliberately broad and mixed-language: the customer base is Italian SMBs, but
 * short-form craft travels, and an English-only pool would miss how the same hook reads in Italian.
 * Override wholesale with `MARKET_DISCOVERY_CATEGORIES` (JSON) as the mix gets tuned.
 */
export const DEFAULT_CATEGORIES: DiscoveryCategory[] = [
  { id: 'food', queries: ['ristorante marketing', 'food business tips', 'restaurant owner'], risingSubreddits: ['restaurateur'] },
  { id: 'fitness', queries: ['personal trainer clienti', 'gym owner marketing', 'fitness coaching'], risingSubreddits: ['personaltraining'] },
  { id: 'beauty', queries: ['salone bellezza clienti', 'beauty salon marketing', 'estetista'], risingSubreddits: ['Esthetics'] },
  { id: 'fashion', queries: ['brand moda piccolo', 'fashion brand marketing', 'boutique owner'], risingSubreddits: ['streetwearstartup'] },
  { id: 'interiors', queries: ['arredamento su misura', 'interior design business', 'falegnameria'], risingSubreddits: ['InteriorDesign'] },
  { id: 'realestate', queries: ['agente immobiliare clienti', 'real estate agent marketing'], risingSubreddits: ['realtors'] },
  { id: 'professional', queries: ['studio commercialista clienti', 'architetto studio', 'law firm marketing'], risingSubreddits: ['smallbusiness'] },
  { id: 'ecommerce', queries: ['ecommerce conversioni', 'shopify store growth', 'dropshipping ads'], risingSubreddits: ['ecommerce'] },
  { id: 'saas', queries: ['saas marketing hook', 'indie hacker launch', 'b2b demand gen'], risingSubreddits: ['SaaS'] },
  { id: 'coaching', queries: ['business coach clienti', 'online course launch', 'formazione online'], risingSubreddits: ['Entrepreneur'] },
  { id: 'travel', queries: ['hotel marketing', 'b&b prenotazioni dirette', 'travel content'], risingSubreddits: ['hoteliers'] },
  { id: 'automotive', queries: ['concessionaria social', 'car detailing business'], risingSubreddits: ['Autodetailing'] }
];

/**
 * Which categories this tick handles. Deterministic on the tick index so a full pass is guaranteed
 * over `ceil(categories / perTick)` ticks — no randomness, no category starved by luck.
 */
export function categoriesForTick(
  categories: DiscoveryCategory[],
  tick: number,
  perTick = 2
): DiscoveryCategory[] {
  if (!categories.length || perTick <= 0) return [];
  const size = Math.min(perTick, categories.length);
  const start = ((Math.trunc(tick) % categories.length) + categories.length) % categories.length;
  return Array.from({ length: size }, (_, i) => categories[(start + i) % categories.length]);
}

/** Parse the env override. Invalid JSON falls back to the defaults rather than harvesting nothing. */
export function parseCategories(raw: string | null | undefined): DiscoveryCategory[] {
  const text = String(raw ?? '').trim();
  if (!text) return DEFAULT_CATEGORIES;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return DEFAULT_CATEGORIES;
    const out: DiscoveryCategory[] = [];
    for (const c of parsed) {
      const id = String(c?.id ?? '').trim();
      const queries = Array.isArray(c?.queries) ? c.queries.map((q: unknown) => String(q).trim()).filter(Boolean) : [];
      if (!id || !queries.length) continue;
      out.push({
        id,
        queries,
        risingSubreddits: Array.isArray(c?.risingSubreddits)
          ? c.risingSubreddits.map((s: unknown) => String(s).trim()).filter(Boolean)
          : []
      });
    }
    return out.length ? out : DEFAULT_CATEGORIES;
  } catch {
    return DEFAULT_CATEGORIES;
  }
}

export type SourceYield = { source: string; category: string; posts: number };

export type DiscoveryResult = {
  posts: DiscoveredPost[];
  /** Per-source failures. Empty is the good case; a source that appears here every tick is dead. */
  errors: DiscoveryError[];
  /**
   * Posts returned per source, per category. The page size of these endpoints is NOT documented —
   * only Threads is known ("up to 10 per query", radar.ts) — so the real yield is measured here
   * instead of assumed, and the first days of running tell us what the budget actually buys.
   */
  yields: SourceYield[];
};

export type DiscoveryPlan = {
  /** Topic/keyword queries run against every text platform. Ignored when `categories` is set. */
  queries?: string[];
  /** Subreddits polled with `sort=rising`. Ignored when `categories` is set. */
  risingSubreddits?: string[];
  /** Stratified plan. Preferred over the flat `queries`. */
  categories?: DiscoveryCategory[];
  /** Cap per category, so one loud niche cannot dominate the pool. */
  perCategoryLimit?: number;
  /** Freshness window. Hourly discovery with a 2-day window gives generous overlap for the curve. */
  freshDays?: number;
  /** Hard cap on posts returned, after dedupe and the freshness cut. */
  limit?: number;
  now?: number;
};

/**
 * Run one discovery sweep across the plan's categories.
 *
 * Each category is capped independently: an unbalanced pool means the fit is really about whichever
 * vertical returned the most posts, dressed up as a general result. Keep queries specific — a broad
 * one returns popular noise, which is exactly the material that teaches a rubric nothing.
 */
export async function runDiscovery(plan: DiscoveryPlan = {}): Promise<DiscoveryResult> {
  const categories: DiscoveryCategory[] = plan.categories?.length
    ? plan.categories
    : [{ id: 'default', queries: plan.queries ?? [], risingSubreddits: plan.risingSubreddits ?? [] }];

  const now = plan.now ?? Date.now();
  const freshDays = plan.freshDays ?? 2;
  const perCategory = plan.perCategoryLimit ?? 80;

  const yields: SourceYield[] = [];
  const errors: DiscoveryError[] = [];
  const collected: DiscoveredPost[] = [];

  for (const category of categories) {
    const queries = (category.queries ?? []).map((q) => q.trim()).filter(Boolean);
    const rising = (category.risingSubreddits ?? []).map((s) => s.trim()).filter(Boolean);
    if (!queries.length && !rising.length) continue;

    const jobs: Array<{ source: string; query: string; run: Promise<FetchOutcome> }> = [];
    for (const q of queries) {
      jobs.push(
        { source: 'threads', query: q, run: discoverThreads(q) },
        { source: 'linkedin', query: q, run: discoverLinkedIn(q) },
        { source: 'reddit', query: q, run: discoverReddit(q) }
      );
    }
    for (const s of rising) {
      jobs.push({ source: 'reddit:rising', query: `r/${s}`, run: discoverRisingSubreddit(s) });
    }

    const settled = await Promise.all(jobs.map((j) => j.run));
    const perSource = new Map<string, number>();
    settled.forEach((outcome, i) => {
      const job = jobs[i];
      perSource.set(job.source, (perSource.get(job.source) ?? 0) + outcome.posts.length);
      if (outcome.error) {
        errors.push({
          source: job.source,
          category: category.id,
          query: job.query,
          message: outcome.error
        });
      }
    });
    for (const [source, posts] of perSource) yields.push({ source, category: category.id, posts });

    const found = settled.flatMap((o) => o.posts);
    const fresh = dedupeDiscovered(found).filter((p) => isFresh(p.publishedAt, now, freshDays));
    collected.push(...fresh.slice(0, perCategory).map((p) => ({ ...p, category: category.id })));
  }

  return {
    posts: dedupeDiscovered(collected).slice(0, plan.limit ?? 600),
    yields,
    errors
  };
}
