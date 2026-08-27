/**
 * Where the design wall's raw material comes from — and why it cannot come from the existing sweep.
 *
 * `market-trends.ts` discovers by HASHTAG and by trending feed, on Instagram and TikTok. That is the
 * right instrument for its question ("what is working in this vertical right now") and the wrong one
 * for this one. A hashtag surfaces what is popular; design is not popular. `#arredamento` returns a
 * thousand competent phone photos and no posters, and no threshold on a beauty score fixes a corpus
 * that contains nothing beautiful — a judge shown only snapshots picks the best snapshot.
 *
 * So this source is CURATED AT THE ACCOUNT LEVEL, which is how every design wall on the internet
 * actually works: a list of accounts that set the bar, swept regularly, everything they publish put
 * in front of the judge. The list is the wall's taste, and it is stated in code rather than inferred,
 * because pretending an algorithm chose it would be a lie about a decision we made.
 *
 * WHAT IT SWEEPS. Profile history, through the same `fetchProfileHistory` the baselines use — so
 * every account here is HISTORY_CAPABLE by construction and every post it returns is labellable on
 * arrival, hits and flops alike. That is a second, quieter benefit: the design wall's corpus doubles
 * as an unbiased sample, which is exactly what `market-harvest.ts` says the discovered pool is not.
 *
 * WHAT IT KEEPS. Stills and carousels FIRST — a design wall is mostly static work, and the existing
 * sweep already covers video. A post with no visual at all is dropped here rather than stored: there
 * is nothing for a design judge to look at, and an unjudgeable row in the queue is a row that costs a
 * query every night forever.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { fetchProfileHistory, type NormalizedPost } from '$lib/server/scrapecreators';
import { CONTENT_SCORER_VERSION, checkValues, scoreContentQuality } from '$lib/server/content-quality';
import { archiveMarketMedia } from '$lib/server/market-media';
import { interactionRate } from '$lib/server/market-metrics';
import { instagramHashtag, tiktokHashtag, dedupeVideos, type TrendingVideo } from '$lib/server/market-trends';
import { trendPostRow, type HarvestError } from '$lib/server/market-harvest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type DesignAccount = { platform: string; handle: string };

/**
 * The wall's taste, as a list — and it is X-first, which the first version of it got wrong.
 *
 * The original list was assembled from memory and was Instagram-heavy: studios and design
 * publications, because that is where design "obviously" lives. Then we read the index of an
 * existing curated wall (posts.design, via `posts-design.ts`, whose Content-Signal permits
 * `use=reference`) and counted what it actually features. 461 entries: **347 on X, zero on
 * Instagram.** We had been fishing in the wrong pond, and the wall's seven cards were the result.
 *
 * The other correction was the mix. Counting their repeat accounts turns up five kinds, not three:
 *
 *   AI labs          openai, xai, claudeai — their announcement art is a design object
 *   dev tools/SaaS   figma, framer, linear, supabase, replit, resend
 *   fintech/crypto   base, robinhood, revolut
 *   consumer         nothing, lamborghini, rockstargames
 *   INDIVIDUALS      benjitaylor, oliverhamrin, avstorm, fonsmans… — the category the first list
 *                    missed entirely, and the one that matters most: a company account posts when it
 *                    ships, a designer posts what they are working on
 *
 * A caveat that keeps this honest: 78% of the accounts on that index appear exactly ONCE. Following
 * the repeat accounts does not reproduce someone else's wall and is not meant to — it identifies who
 * reliably publishes work worth grading. The long tail is what the hashtag sweep is for.
 *
 * Every handle below was probed against the live profile endpoint and returns posts WITH MEDIA;
 * `cursor_ai` and `privy_io` are featured there but return nothing we can grade, so they are not
 * here. Override the whole thing without a deploy via `WALL_DESIGN_ACCOUNTS`
 * (`instagram:figma,x:vercel,…`). Anything not in scrapecreators' FETCHERS map is dropped with a
 * named error rather than silently doing nothing.
 */
export const DEFAULT_DESIGN_ACCOUNTS: DesignAccount[] = [
  // ── AI labs ────────────────────────────────────────────────────────────────────────────────────
  { platform: 'x', handle: 'openai' },
  { platform: 'x', handle: 'xai' },
  { platform: 'x', handle: 'claudeai' },
  { platform: 'x', handle: 'nousresearch' },

  // ── Developer tools and SaaS ───────────────────────────────────────────────────────────────────
  { platform: 'x', handle: 'figma' },
  { platform: 'x', handle: 'framer' },
  { platform: 'x', handle: 'linear' },
  { platform: 'x', handle: 'vercel' },
  { platform: 'x', handle: 'supabase' },
  { platform: 'x', handle: 'replit' },
  { platform: 'x', handle: 'notionhq' },
  { platform: 'x', handle: 'github' },
  { platform: 'x', handle: 'resend' },
  { platform: 'x', handle: 'lovable' },

  // ── Fintech and crypto ─────────────────────────────────────────────────────────────────────────
  { platform: 'x', handle: 'base' },
  { platform: 'x', handle: 'robinhoodapp' },
  { platform: 'x', handle: 'revolut' },

  // ── Consumer, hardware, entertainment ──────────────────────────────────────────────────────────
  { platform: 'x', handle: 'nothing' },
  { platform: 'x', handle: 'cmfbynothing' },
  { platform: 'x', handle: 'lamborghini' },
  { platform: 'x', handle: 'rockstargames' },
  { platform: 'x', handle: 'uber' },

  // ── Individual designers ───────────────────────────────────────────────────────────────────────
  //
  // The category the first version of this list missed entirely, and the one that turns out to
  // matter most: a studio account posts when it ships, a designer posts what they are working on.
  { platform: 'x', handle: 'benjitaylor' },
  { platform: 'x', handle: 'oliverhamrin' },
  { platform: 'x', handle: 'avstorm' },
  { platform: 'x', handle: 'fonsmans' },
  { platform: 'x', handle: 'baseddesigner' },
  { platform: 'x', handle: 'sebcornelius' },
  { platform: 'x', handle: 'apostraphi' },
  { platform: 'x', handle: '60fpsdesign' },
  { platform: 'x', handle: 'zoink' },
  { platform: 'x', handle: 'joinedgecity' },
  { platform: 'x', handle: 'mymind' },

  // ── Publications and curation ──────────────────────────────────────────────────────────────────
  { platform: 'x', handle: 'awwwards' },
  { platform: 'instagram', handle: 'itsnicethat' },
  { platform: 'instagram', handle: 'designmilk' },
  { platform: 'instagram', handle: 'typewolf' },
  { platform: 'instagram', handle: 'creativereview' },
  { platform: 'instagram', handle: 'thebrandidentity' },
  { platform: 'threads', handle: 'itsnicethat' },

  // ── Studios on Instagram ───────────────────────────────────────────────────────────────────────
  //
  // Kept because they produced the wall's best cards (a Pentagram book cover scored 68 and a Nothing
  // product shot 70), but no longer the centre of gravity — see the header.
  { platform: 'instagram', handle: 'pentagramdesign' },
  { platform: 'instagram', handle: 'collins' },
  { platform: 'instagram', handle: 'porto.rocha' },
  { platform: 'instagram', handle: 'koto_studio' },
  { platform: 'instagram', handle: 'buck_design' },
  { platform: 'instagram', handle: 'nothing' },
  { platform: 'instagram', handle: 'figma' },
  { platform: 'instagram', handle: 'lovable.dev' },
  { platform: 'instagram', handle: 'base64' }
];

/**
 * The other half of the corpus: TOPICS.
 *
 * The curated list above is the wall's taste and it has a ceiling — twenty-odd accounts publish a
 * finite amount, and a wall that only ever shows the same studios is a directory of our bookmarks.
 * Hashtags are the opposite trade: unbounded reach, terrible precision. `#design` on Instagram is
 * mostly template work, stock photos with a headline on them and reposts of reposts.
 *
 * That trade is ACCEPTABLE HERE AND NOWHERE ELSE IN THE HARVEST, for one reason: this source feeds a
 * judge whose whole job is to say no. `is_design` throws out the photos, the score throws out the
 * template work, and what survives is the small share of a noisy surface that was worth finding. The
 * hashtag sweep is a funnel, not a feed — measured by what clears the bar, never by what it returns.
 *
 * On Instagram and TikTok a hashtag IS the category, which is why these are tags and not text
 * queries — same reasoning as `MARKET_TREND_HASHTAGS` in the trends cron. Override without a deploy
 * via `WALL_DESIGN_TOPICS`.
 */
export const DEFAULT_DESIGN_TOPICS = [
  'design',
  'graphicdesign',
  'uidesign',
  'ui',
  'typography',
  'branding',
  'posterdesign',
  'editorialdesign',
  'logodesign',
  'webdesign',
  'productdesign',
  'motiondesign'
];

/** `design,uidesign` → tags, without the leading `#` and without duplicates. */
export function parseTopics(raw: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const chunk of String(raw ?? '').split(',')) {
    const tag = chunk.trim().replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export function designTopics(): string[] {
  const override = parseTopics(env.WALL_DESIGN_TOPICS);
  return override.length ? override : DEFAULT_DESIGN_TOPICS;
}

/** `instagram:figma,x:vercel` → accounts. Unparseable entries are dropped, not guessed at. */
export function parseAccounts(raw: string | null | undefined): DesignAccount[] {
  const out: DesignAccount[] = [];
  const seen = new Set<string>();
  for (const chunk of String(raw ?? '').split(',')) {
    const [platform, handle] = chunk.split(':').map((s) => s.trim().toLowerCase());
    if (!platform || !handle) continue;
    const key = `${platform}:${handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ platform, handle });
  }
  return out;
}

export function designAccounts(): DesignAccount[] {
  const override = parseAccounts(env.WALL_DESIGN_ACCOUNTS);
  return override.length ? override : DEFAULT_DESIGN_ACCOUNTS;
}

/**
 * Accounts swept per tick, and posts taken from each.
 *
 * THE ROTATION WAS SIZED AGAINST THE WRONG COST. It started at 8 of ~26 accounts a day, on the
 * reasoning that these accounts publish a few times a week so a deep sweep re-reads the same posts.
 * True, and irrelevant: a re-read is one profile call that upserts onto a row we already have, and
 * the same day's tick was spending 1,534 Gemini calls judging restaurant reels. The cheap thing was
 * being rationed to protect the expensive one.
 *
 * The visible cost was a design wall of seven cards, because at 8 a day each account is looked at
 * every third day — so a studio that posted on Tuesday is discovered on Friday, if at all.
 *
 * The whole list now goes every day: ~26 profile calls, which is less than one tick of the judge.
 * The cap stays because a list that grows to two hundred accounts should still not be swept in one
 * function invocation — it is a bound on a single run, not a policy about coverage.
 */
export const ACCOUNTS_PER_TICK = 40;
/**
 * Posts read per account. One page, and a page is what a profile call returns anyway — the limit
 * that matters is how far back a design wall cares about, and it is not far.
 */
export const POSTS_PER_ACCOUNT = 18;
export const SWEEP_TIME_BUDGET_MS = 180_000;
/** Media archived per tick — each is a download and an upload. */
export const MAX_ARCHIVE_PER_TICK = 30;

/**
 * Topics swept per tick, and posts kept from each.
 *
 * Fewer topics than accounts per tick, and fewer posts kept: a hashtag returns dozens of rows of
 * which a handful are design, so the expensive part is not the search — it is the archive and the
 * judge call that every stored row then costs. Keeping 10 and rejecting 8 of them is the intended
 * shape; keeping 50 would be paying to reject 45.
 */
export const TOPICS_PER_TICK = 4;
export const POSTS_PER_TOPIC = 10;

/**
 * Which slice of the list this tick sweeps.
 *
 * A deterministic rotation on the day-of-year rather than a random sample: every account gets swept
 * on a predictable cadence, and a missing account is a bug rather than bad luck. With the cap now
 * above the list size this returns everything — the rotation is the behaviour that takes over if the
 * list outgrows one run, not the normal path.
 */
export function accountsForTick(all: DesignAccount[], now = new Date(), perTick = ACCOUNTS_PER_TICK): DesignAccount[] {
  if (all.length <= perTick) return all;
  const day = Math.floor(now.getTime() / 86_400_000);
  const start = (day * perTick) % all.length;
  const out: DesignAccount[] = [];
  for (let i = 0; i < perTick; i++) out.push(all[(start + i) % all.length]);
  return out;
}

/** A post with no picture cannot be judged as design, and must never enter the queue. */
export function hasVisual(post: NormalizedPost): boolean {
  return Boolean(post.thumbnailUrl || post.videoUrl);
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * NormalizedPost → a `market_posts` row.
 *
 * Mirrors `trendPostRow` field for field where the fields exist, so a design-sourced row and a
 * trend-sourced row are the same kind of thing to everything downstream — the categoriser, the fit,
 * the wall. `query` records the provenance (`design:instagram/figma`), which is what keeps a curated
 * account's numbers separable from the hashtag sweep's when someone reads the bank later.
 */
export function designPostRow(post: NormalizedPost, account: DesignAccount): AnyRec {
  const metrics = {
    likes: num(post.metrics?.likes),
    comments: num(post.metrics?.comments),
    shares: num(post.metrics?.shares),
    views: num(post.metrics?.views)
  };
  const engagement = metrics.likes + metrics.comments + metrics.shares;
  const quality = scoreContentQuality({ caption: post.content ?? '', platform: account.platform });
  const isVideo = post.mediaType === 'video';

  return {
    platform: account.platform,
    external_id: post.externalId,
    url: post.url,
    account_key: account.handle,
    content: post.content,
    media_type: post.mediaType ?? 'image',
    format_bucket: isVideo ? 'video' : 'image',
    published_at: post.publishedAt,
    metrics,
    engagement,
    views: metrics.views || null,
    interaction_rate: interactionRate(metrics),
    // The still is what the design judge grades, so for anything that is not a clip the THUMBNAIL is
    // the media that matters — archiving the video of a carousel would be archiving the wrong thing.
    media_url: isVideo ? (post.videoUrl ?? post.thumbnailUrl) : post.thumbnailUrl,
    quality_index: quality.index,
    checks: checkValues(quality),
    scorer_version: CONTENT_SCORER_VERSION,
    query: `design:${account.platform}/${account.handle}`,
    duration_ms: post.durationMs ?? null,
    hashtags: post.hashtags?.length ? post.hashtags : null,
    region: post.region ?? null
  };
}

/**
 * A hashtag hit → a `market_posts` row.
 *
 * Reuses `trendPostRow` rather than mapping the fields again, so a design-sourced row and a
 * trend-sourced row stay literally the same shape — the categoriser, the fit and the wall all read
 * them through the same columns, and a second mapper is a second thing to keep in sync.
 *
 * Two overrides on top of it, both about STILLS. `trendPostRow` was written for a video-first sweep:
 * it hardcodes `media_type: 'video'` and archives `videoUrl`. On a design hashtag a good half of the
 * results are carousels and posters, where the video url is absent and the thing worth archiving —
 * the thing the judge will actually grade — is the image.
 */
export function designTrendRow(video: TrendingVideo, tag: string): AnyRec {
  const row = trendPostRow(video, null);
  row.query = `design:#${tag}`;
  if (!video.videoUrl && video.thumbnailUrl) {
    row.media_type = 'image';
    row.format_bucket = 'image';
    row.media_url = video.thumbnailUrl;
  }
  return row;
}

/** A hashtag hit with no handle cannot be baselined, and with no media cannot be judged. */
export function usableTrend(video: TrendingVideo): boolean {
  return Boolean(video.accountHandle && (video.videoUrl || video.thumbnailUrl));
}

/** Same deterministic day rotation as the accounts, on its own cadence. */
export function topicsForTick(all: string[], now = new Date(), perTick = TOPICS_PER_TICK): string[] {
  if (all.length <= perTick) return all;
  const day = Math.floor(now.getTime() / 86_400_000);
  const start = (day * perTick) % all.length;
  const out: string[] = [];
  for (let i = 0; i < perTick; i++) out.push(all[(start + i) % all.length]);
  return out;
}

export type TopicSweepResult = {
  topics: string[];
  fetched: number;
  kept: number;
  errors: HarvestError[];
};

/**
 * Sweep this tick's design hashtags on Instagram and TikTok.
 *
 * Returns rows rather than writing them: the account sweep and this one upsert together, in one
 * call, so a post that a studio published AND a hashtag surfaced is one row and not a race between
 * two writers on the same unique index.
 */
export async function runTopicSweep(
  opts: { topics?: string[]; deadline?: number; now?: Date } = {}
): Promise<{ rows: AnyRec[] } & TopicSweepResult> {
  const picked = topicsForTick(opts.topics ?? designTopics(), opts.now ?? new Date());
  const deadline = opts.deadline ?? Date.now() + SWEEP_TIME_BUDGET_MS;
  const errors: HarvestError[] = [];
  const rows: AnyRec[] = [];
  let fetched = 0;

  for (const tag of picked) {
    if (Date.now() > deadline) break;
    for (const [platform, fetcher] of [
      ['instagram', instagramHashtag],
      ['tiktok', tiktokHashtag]
    ] as const) {
      if (Date.now() > deadline) break;
      const out = await fetcher(tag);
      if (out.error) {
        errors.push({ stage: 'discovery', target: `design:#${tag}@${platform}`, message: out.error.slice(0, 300) });
        continue;
      }
      fetched += out.videos.length;
      const kept = dedupeVideos(out.videos.filter(usableTrend)).slice(0, POSTS_PER_TOPIC);
      for (const video of kept) rows.push(designTrendRow(video, tag));
    }
  }

  return { rows, topics: picked, fetched, kept: rows.length, errors };
}

export type DesignSweepResult = {
  accounts: number;
  /** Rows whose still copy was thrown away because this tick found the clip. See below. */
  reclipped: number;
  /** The hashtags this tick swept. Empty when the topic sweep was turned off for the run. */
  topics: string[];
  fetched: number;
  /** How many of the stored rows came from a hashtag rather than a curated account. */
  fromTopics: number;
  stored: number;
  archived: number;
  errors: HarvestError[];
};

/**
 * Sweep this tick's accounts and store what they published.
 *
 * Best-effort per account and NEVER silent: an account whose fetch fails costs that account a tick,
 * not the run, and the reason lands in `errors` — same posture as the harvest, for the same reason.
 * A sweep that returns few posts with no errors had a quiet week; the same count with a full error
 * list is broken, and the two must not look alike from the outside.
 */
export async function runDesignSweep(
  admin: SupabaseClient,
  opts: { accounts?: DesignAccount[]; topics?: string[] | false; deadline?: number; now?: Date } = {}
): Promise<DesignSweepResult> {
  const all = opts.accounts ?? designAccounts();
  const picked = accountsForTick(all, opts.now ?? new Date());
  const deadline = opts.deadline ?? Date.now() + SWEEP_TIME_BUDGET_MS;
  const errors: HarvestError[] = [];

  const rows: AnyRec[] = [];
  let fetched = 0;

  for (const account of picked) {
    if (Date.now() > deadline) break;
    let posts: NormalizedPost[] = [];
    try {
      posts = await fetchProfileHistory(
        account.platform,
        { username: account.handle, profileUrl: null },
        { maxPages: 1, maxPosts: POSTS_PER_ACCOUNT }
      );
    } catch (e) {
      errors.push({
        stage: 'discovery',
        target: `design:${account.platform}/${account.handle}`,
        message: (e instanceof Error ? e.message : String(e)).slice(0, 300)
      });
      continue;
    }
    if (!posts.length) {
      // A fetcher that exists but returned nothing is worth a line: on this list it means the handle
      // moved, not that the studio stopped publishing.
      errors.push({
        stage: 'discovery',
        target: `design:${account.platform}/${account.handle}`,
        message: 'no posts returned'
      });
      continue;
    }
    fetched += posts.length;
    for (const post of posts) {
      if (!post.externalId || !hasVisual(post)) continue;
      rows.push(designPostRow(post, account));
    }
  }

  // The hashtags, into the SAME row list. One upsert for both sources: a post that a studio
  // published and a hashtag also surfaced is one row, not two writers racing on the unique index.
  let topics: string[] = [];
  let fromTopics = 0;
  if (opts.topics !== false) {
    const topicRun = await runTopicSweep({
      topics: Array.isArray(opts.topics) ? opts.topics : undefined,
      deadline,
      now: opts.now
    });
    topics = topicRun.topics;
    fetched += topicRun.fetched;
    errors.push(...topicRun.errors);
    // Dedupe against the account sweep before the upsert: the same key twice in one payload is a
    // Postgres error ("cannot affect row a second time"), not a merge.
    const seen = new Set(rows.map((r) => `${r.platform}:${r.external_id}`));
    for (const row of topicRun.rows) {
      const key = `${row.platform}:${row.external_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      fromTopics++;
    }
  }

  if (!rows.length) {
    return { accounts: picked.length, topics, reclipped: 0, fetched, fromTopics: 0, stored: 0, archived: 0, errors };
  }

  const { data: saved, error } = await admin
    .from('market_posts')
    .upsert(rows, { onConflict: 'platform,external_id' })
    .select('id, platform, external_id, media_path, media_kind');
  if (error) {
    errors.push({ stage: 'discovery', target: 'design:upsert', message: error.message.slice(0, 300) });
    return { accounts: picked.length, topics, reclipped: 0, fetched, fromTopics, stored: 0, archived: 0, errors };
  }

  const byKey = new Map((saved ?? []).map((r: AnyRec) => [`${r.platform}:${r.external_id}`, r]));

  // A CLIP WE ONCE ARCHIVED AS A COVER IS NOT DONE.
  //
  // The Instagram and X mappers used to drop the video url the response already carried, so every
  // video from those two arrived here with only a thumbnail and was archived as a still: 96
  // Instagram rows and 13 X rows, `media_type = 'video'` sitting next to `media_kind = 'image'`, and
  // no card that could ever move. Now that the url is there, those rows have to be redone — and
  // nothing else would ever redo them, because the archive queue's whole test is "has no copy" and
  // they have one.
  //
  // The test is precise on purpose: this tick is storing a CLIP for a post whose stored copy is a
  // STILL. Not "the url changed" (every CDN link changes, they are signed) and not "it is a video"
  // (a video whose clip we already hold is finished). Clearing the derivatives too, because a poster
  // cut from a cover image and one cut from the clip are not the same picture.
  const restale: string[] = [];
  for (const row of rows) {
    const stored = byKey.get(`${row.platform}:${row.external_id}`);
    if (!stored?.media_path) continue;
    if (row.media_type === 'video' && row.media_url && stored.media_kind === 'image') {
      restale.push(String(stored.id));
      stored.media_path = null;
    }
  }
  if (restale.length) {
    await admin
      .from('market_posts')
      .update({
        media_path: null,
        media_kind: null,
        media_archived_at: null,
        media_attempted_at: null,
        media_error: null,
        poster_path: null,
        preview_path: null,
        preview_state: null,
        preview_error: null
      })
      .in('id', restale);
  }

  // The permanent copy. Every media URL a platform hands back is a signed CDN link that dies within
  // days (market-media.ts), and a wall card whose picture 404s is the one failure a gallery cannot
  // survive — so this happens now, while the link is alive, not when someone first visits the page.
  let archived = 0;
  const pending = rows
    .filter((r) => r.media_url && !byKey.get(`${r.platform}:${r.external_id}`)?.media_path)
    .slice(0, MAX_ARCHIVE_PER_TICK);

  for (const row of pending) {
    if (Date.now() > deadline) break;
    const saved_ = byKey.get(`${row.platform}:${row.external_id}`);
    if (!saved_) continue;
    const result = await archiveMarketMedia(admin, {
      platform: row.platform,
      externalId: row.external_id,
      url: row.media_url
    });
    if (!result.ok) {
      errors.push({
        stage: 'media',
        target: `${row.platform}:${row.external_id}`,
        message: `${result.reason}${result.detail ? `: ${result.detail}` : ''}`
      });
      continue;
    }
    const { error: upErr } = await admin
      .from('market_posts')
      .update({
        media_path: result.media.path,
        media_bytes: result.media.bytes,
        media_kind: result.media.kind,
        media_archived_at: new Date().toISOString()
      })
      .eq('id', saved_.id);
    if (!upErr) archived++;
  }

  return {
    accounts: picked.length,
    topics,
    reclipped: restale.length,
    fetched,
    fromTopics,
    stored: rows.length,
    archived,
    errors
  };
}
