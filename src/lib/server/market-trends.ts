/**
 * Trending short-form video discovery — Instagram Reels and TikTok.
 *
 * WHY THIS REPLACES THE TEXT SOURCES. The first version of discovery reused the surfaces `radar.ts`
 * already had wired: Threads, LinkedIn, Reddit. Convenient, and the wrong foundation for this
 * feature — those are CONVERSATION surfaces, and a Reddit thread tells you almost nothing about why
 * a Reel works. Short-form video is where the craft this product generates actually lives, so the
 * discovery has to look there.
 *
 * There is a second, bigger reason. Instagram and TikTok are both in scrapecreators' FETCHERS map,
 * so every account these endpoints surface can have its profile pulled immediately — which means
 * every discovered post is labellable on arrival. That was the thing LinkedIn and Reddit could not
 * do (see BASELINE_CAPABLE in market-harvest.ts).
 *
 * And a video carries the payload the caption never did. `video_url` was harvested to feed a Gemini
 * judge that returned hook type, scroll-stop, hold, reveal timing and CTA placement; that judge was
 * removed on 2026-08-29, so the column is stored and currently read by nobody. Kept because
 * harvesting it costs nothing and re-harvesting history would cost a lot — but do not assume a
 * consumer exists.
 *
 * Parsing is defensive: these payloads are third-party and change without notice. Anything
 * unparseable is dropped rather than guessed at — a post with the wrong engagement attached is worse
 * for the fit than no post at all.
 */
import { scrapeCreatorsGet } from '$lib/server/scrapecreators';
import { PLATFORM_IDS } from '$lib/platforms';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export const VIDEO_PLATFORMS = [PLATFORM_IDS.instagram, PLATFORM_IDS.tiktok] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

export type TrendingVideo = {
  platform: VideoPlatform;
  externalId: string;
  url: string;
  /** The handle, not the display name — this is what the profile fetcher takes. */
  accountHandle: string | null;
  caption: string;
  /** Direct video link. Signed and short-lived: archive it before it rots (market-media.ts). */
  videoUrl: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  metrics: { likes: number; comments: number; shares: number; views: number };
  /** What surfaced it — `trending`, `#hashtag`, a keyword. Kept so a skewed mix stays visible. */
  source: string;
  category?: string;

  /**
   * Why it might have travelled, beyond the content itself.
   *
   * A mega-viral is the case where "was it the hook?" is most interesting and most dangerous: with
   * one video there is no counterfactual, and the judge will describe a hook just as confidently
   * whether or not it mattered. These fields are the rival explanations, so the hook has to beat
   * them instead of being credited by default.
   */
  region: string | null;
  /** On TikTok the sound is the dominant confounder: forty virals on one audio means the audio. */
  soundId: string | null;
  soundName: string | null;
  /** Bought reach teaches nothing about content. */
  isAd: boolean | null;
  isPaidPartnership: boolean | null;
  /** Saving costs more than liking — it separates "useful" from "merely fun". */
  saves: number | null;
  captionLanguage: string | null;
  /** WebVTT of TikTok's own auto-captions. Signed and short-lived — read it in the same run. */
  captionsUrl: string | null;
  captionsLang: string | null;

  /** How the piece is made, and how it reached people. See migration 0192 for why each one. */
  durationMs: number | null;
  /** The hashtags the post ACTUALLY used — not the one we searched for. */
  hashtags: string[];
  /** 'original' vs TikTok's search/recommend surfaces: borrowed sound or the creator's own. */
  soundFrom: string | null;
  soundIsOriginal: boolean | null;
  createdByAi: boolean | null;
  videoRatio: string | null;
  videoWidth: number | null;
  videoHeight: number | null;
  shootMode: string | null;
  /** The watermark-free copy. Kept beside videoUrl, not instead of it — see 0192. */
  videoUrlClean: string | null;
  /** SEMANTICS UNVERIFIED — the raw play_time_prob_dist triple. See 0192. */
  watchThresholdMs: number | null;
  watchProb: number | null;
  watchAvgMs: number | null;
};

/**
 * TikTok publishes `solaria_profile.play_time_prob_dist` as a bare string like "[800,0.7566,2241]".
 *
 * There is no documentation for it. The shape is consistent across every video observed and the
 * plausible reading is threshold-ms / probability of passing it / mean watch time — retention,
 * which is the metric that matters most in short-form and which you normally cannot obtain for
 * somebody else's video. Parsed as three raw numbers and named as such: if it correlates with
 * outperformance we will find out empirically what it is, and no downstream code is entitled to
 * assume the meaning in the meantime.
 */
/** `solaria_profile.profile` is itself a JSON string wrapping the field we want. */
function tryProfile(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw);
    const v = (o as AnyRec)?.play_time_prob_dist;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export function parseWatchDist(raw: unknown): { thresholdMs: number | null; prob: number | null; avgMs: number | null } {
  const empty = { thresholdMs: null, prob: null, avgMs: null };
  if (typeof raw !== 'string' || !raw.trim()) return empty;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length < 3) return empty;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return { thresholdMs: n(arr[0]), prob: n(arr[1]), avgMs: n(arr[2]) };
  } catch {
    return empty;
  }
}

/** The hashtags the post itself carries, in order, deduplicated and without the leading #. */
export function hashtagsOf(textExtra: unknown): string[] {
  if (!Array.isArray(textExtra)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of textExtra as AnyRec[]) {
    const name = clean(t?.hashtag_name, 100).replace(/^#/, '').toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Only strings and numbers survive.
 *
 * `String(v)` on an object yields the literal "[object Object]", which is non-empty and therefore
 * beats every fallback in a `a || b || null` chain — a nested author shape silently became an
 * account handle named "[object Object]", and every post of that phantom account was then grouped
 * together and queued for a profile fetch that can never resolve.
 */
const clean = (v: unknown, max = 4000): string =>
  (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Audio is not video. A clip url that is really the track sends the judge to open a song. */
export function notAudio(url: string | null): string | null {
  if (!url) return null;
  return /\.(mp3|m4a|aac|wav|ogg)(\?|$)/i.test(url) ? null : url;
}

/** First usable URL from ScrapeCreators' `url_list` arrays. */
function firstUrl(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  for (const u of list) {
    const s = clean(u, 2000);
    if (s && /^https?:\/\//i.test(s)) return s;
  }
  return null;
}

function isoFrom(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n > 1e12 ? n : n * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Parsers ──────────────────────────────────────────────────────────────────────────────────

/**
 * TikTok wraps results in `aweme_list`.
 *
 * `author.unique_id` is the @handle and `author.nickname` is the display name; only the first can be
 * fed back to the profile endpoint, so it is preferred and nickname is the fallback.
 */
export function parseTikTokVideos(data: unknown, source: string): TrendingVideo[] {
  const list = (data as AnyRec)?.aweme_list ?? (data as AnyRec)?.videos ?? (data as AnyRec)?.data;
  if (!Array.isArray(list)) return [];
  const out: TrendingVideo[] = [];
  for (const v of list as AnyRec[]) {
    const id = clean(v?.aweme_id ?? v?.id, 100);
    if (!id) continue;
    const handle = clean(v?.author?.unique_id ?? v?.author?.uniqueId, 100) || clean(v?.author?.nickname, 100) || null;
    if (!handle) continue;
    const caption = clean(v?.desc);
    const st = v?.statistics ?? v?.stats ?? {};
    const music = v?.music ?? v?.added_sound_music_info ?? {};
    const watch = parseWatchDist(v?.solaria_profile?.profile ? tryProfile(v.solaria_profile.profile) : null);
    out.push({
      platform: 'tiktok',
      externalId: `tiktok:${id}`,
      url: clean(v?.share_url, 500) || `https://www.tiktok.com/@${handle}/video/${id}`,
      accountHandle: handle,
      caption,
      // Never the sound. Some trending payloads leave play_addr empty and the first usable url in
      // the object is the track — twelve rows in the bank ended up pointing the judge at an mp3.
      videoUrl: notAudio(
        firstUrl(v?.video?.play_addr?.url_list) ?? firstUrl(v?.video?.download_addr?.url_list)
      ),
      thumbnailUrl: firstUrl(v?.video?.cover?.url_list) ?? firstUrl(v?.video?.origin_cover?.url_list),
      publishedAt: isoFrom(v?.create_time_utc ?? v?.create_time),
      metrics: {
        likes: num(st?.digg_count),
        comments: num(st?.comment_count),
        shares: num(st?.share_count),
        views: num(st?.play_count)
      },
      region: clean(v?.region ?? v?.author?.region, 8).toUpperCase() || null,
      soundId: clean(music?.id ?? music?.mid, 64) || null,
      soundName: clean(music?.title, 200) || null,
      isAd: typeof v?.is_ad === 'boolean' ? v.is_ad : null,
      isPaidPartnership: typeof v?.is_paid_partnership === 'boolean' ? v.is_paid_partnership : null,
      saves: st?.collect_count == null ? null : num(st?.collect_count),
      captionLanguage: (clean(v?.desc_language, 8) || '').toLowerCase() === 'un' ? null : clean(v?.desc_language, 8).toLowerCase() || null,
      captionsUrl: clean(v?.video?.cla_info?.caption_infos?.[0]?.url, 2000) || null,
      captionsLang: clean(v?.video?.cla_info?.caption_infos?.[0]?.language_code, 8).toLowerCase() || null,
      durationMs: num(v?.video?.duration) || null,
      hashtags: hashtagsOf(v?.text_extra),
      soundFrom: clean(v?.music_selected_from, 64) || null,
      soundIsOriginal: v?.music_selected_from == null ? null : clean(v?.music_selected_from, 64) === 'original',
      createdByAi:
        typeof v?.aigc_info?.created_by_ai === 'boolean' ? v.aigc_info.created_by_ai : null,
      videoRatio: clean(v?.video?.ratio, 16) || null,
      videoWidth: num(v?.video?.width) || null,
      videoHeight: num(v?.video?.height) || null,
      shootMode: clean(v?.shoot_tab_name, 32) || null,
      videoUrlClean: firstUrl(v?.video?.download_no_watermark_addr?.url_list),
      watchThresholdMs: watch.thresholdMs,
      watchProb: watch.prob,
      watchAvgMs: watch.avgMs,
      source
    });
  }
  return out;
}

/** Instagram returns reels either bare or under `items`/`reels`/`data`. */
export function parseInstagramReels(data: unknown, source: string): TrendingVideo[] {
  const d = data as AnyRec;
  const list = Array.isArray(d) ? d : (d?.items ?? d?.reels ?? d?.data ?? d?.posts);
  if (!Array.isArray(list)) return [];
  const out: TrendingVideo[] = [];
  for (const raw of list as AnyRec[]) {
    // Some Instagram surfaces nest the post one level down under `media` or `node`.
    const r = raw?.media ?? raw?.node ?? raw;
    const code = clean(r?.shortcode ?? r?.code, 100);
    if (!code) continue;
    const handle = clean(r?.user?.username ?? r?.owner?.username, 100) || null;
    if (!handle) continue;
    out.push({
      platform: 'instagram',
      externalId: `instagram:${code}`,
      url: clean(r?.url, 500) || `https://www.instagram.com/reel/${code}/`,
      accountHandle: handle,
      // The caption is a plain string on some surfaces and { text } on others.
      caption: clean(typeof r?.caption === 'string' ? r.caption : r?.caption?.text),
      videoUrl: clean(r?.video_url, 2000) || firstUrl(r?.video_versions?.map((x: AnyRec) => x?.url)),
      thumbnailUrl: clean(r?.image_url ?? r?.thumbnail_url, 2000) || null,
      publishedAt: isoFrom(r?.taken_at ?? r?.taken_at_timestamp),
      metrics: {
        likes: num(r?.like_count),
        comments: num(r?.comment_count),
        shares: 0,
        views: num(r?.play_count ?? r?.ig_play_count ?? r?.view_count)
      },
      // Instagram's hashtag surface exposes none of these: no region on the media, no sound id, no
      // ad flag. Explicit nulls rather than absent keys — a missing field that looks like a present
      // one is the shape of bug this file has already produced once.
      region: null,
      soundId: null,
      soundName: null,
      isAd: null,
      isPaidPartnership: null,
      saves: null,
      captionLanguage: null,
      captionsUrl: null,
      captionsLang: null,
      durationMs: null,
      hashtags: [],
      soundFrom: null,
      soundIsOriginal: null,
      createdByAi: null,
      videoRatio: null,
      videoWidth: null,
      videoHeight: null,
      shootMode: null,
      videoUrlClean: null,
      watchThresholdMs: null,
      watchProb: null,
      watchAvgMs: null,
      source
    });
  }
  return out;
}

/** Keep one row per video across sources, first sighting wins. */
export function dedupeVideos(videos: TrendingVideo[]): TrendingVideo[] {
  const seen = new Set<string>();
  const out: TrendingVideo[] = [];
  for (const v of videos) {
    if (seen.has(v.externalId)) continue;
    seen.add(v.externalId);
    out.push(v);
  }
  return out;
}

/** Only clips we can actually analyse: the judge needs a fetchable video and a handle to baseline. */
export function analysable(videos: TrendingVideo[]): TrendingVideo[] {
  return videos.filter((v) => v.videoUrl && v.accountHandle);
}

/**
 * The TikTok calls deliberately do NOT pass `trim=true`.
 *
 * `trim` strips `music` and most of `author` from the response — which is exactly where the sound
 * id and the creator's region live, the two fields that say whether a video travelled on its own
 * content or on a trend. Verified against the live endpoint: trimmed, 0 of 20 videos carry a sound
 * id; untrimmed, 20 of 20 do. The payload is fatter; the request costs the same one credit.
 */
// ── Fetchers (best-effort, reason carried out) ───────────────────────────────────────────────

export type TrendOutcome = { videos: TrendingVideo[]; error?: string };

async function safeGet(path: string): Promise<{ data?: unknown; error?: string }> {
  try {
    return { data: await scrapeCreatorsGet(path) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: msg.replace(/\s+/g, ' ').trim().slice(0, 300) || 'unknown error' };
  }
}

/** `region` is required by this endpoint and decides which country's feed you get. */
export async function tiktokTrending(region = 'US'): Promise<TrendOutcome> {
  const res = await safeGet(`/v1/tiktok/get-trending-feed?region=${encodeURIComponent(region)}`);
  if (res.error) return { videos: [], error: res.error };
  return { videos: parseTikTokVideos(res.data, `trending:${region}`) };
}

export async function tiktokHashtag(tag: string): Promise<TrendOutcome> {
  const t = tag.replace(/^#/, '').trim();
  if (!t) return { videos: [] };
  const res = await safeGet(`/v1/tiktok/search/hashtag?hashtag=${encodeURIComponent(t)}`);
  if (res.error) return { videos: [], error: res.error };
  return { videos: parseTikTokVideos(res.data, `#${t}`) };
}

export async function tiktokKeyword(query: string): Promise<TrendOutcome> {
  const q = query.trim();
  if (!q) return { videos: [] };
  const res = await safeGet(`/v1/tiktok/search/keyword?query=${encodeURIComponent(q)}`);
  if (res.error) return { videos: [], error: res.error };
  return { videos: parseTikTokVideos(res.data, q) };
}

export async function instagramTrendingReels(): Promise<TrendOutcome> {
  const res = await safeGet('/v1/instagram/reels/trending');
  if (res.error) return { videos: [], error: res.error };
  return { videos: parseInstagramReels(res.data, 'trending') };
}

export async function instagramHashtag(tag: string): Promise<TrendOutcome> {
  const t = tag.replace(/^#/, '').trim();
  if (!t) return { videos: [] };
  const res = await safeGet(`/v1/instagram/search/hashtag?hashtag=${encodeURIComponent(t)}&trim=true`);
  if (res.error) return { videos: [], error: res.error };
  return { videos: parseInstagramReels(res.data, `#${t}`) };
}

// ── Sweep ────────────────────────────────────────────────────────────────────────────────────

export type TrendPlan = {
  /** Hashtags per vertical. On IG/TikTok a hashtag is the vertical — text queries are not. */
  hashtags?: string[];
  /** Trending feeds to pull. TikTok needs a region; Instagram's is global. */
  regions?: string[];
  includeInstagramTrending?: boolean;
  category?: string;
  limit?: number;
};

export type TrendSweep = {
  videos: TrendingVideo[];
  yields: Array<{ source: string; platform: string; videos: number }>;
  errors: Array<{ source: string; message: string }>;
};

/**
 * One trending sweep.
 *
 * The trending feeds are the cheap breadth — one call each, no query to guess — and the hashtags are
 * how a vertical gets targeted. On these platforms a hashtag IS the vertical; a text query is not,
 * which is why the category list moves from phrases to tags.
 */
export async function runTrendSweep(plan: TrendPlan = {}): Promise<TrendSweep> {
  const jobs: Array<{ source: string; platform: string; run: Promise<TrendOutcome> }> = [];

  for (const region of plan.regions ?? []) {
    jobs.push({ source: `trending:${region}`, platform: 'tiktok', run: tiktokTrending(region) });
  }
  if (plan.includeInstagramTrending) {
    jobs.push({ source: 'trending', platform: 'instagram', run: instagramTrendingReels() });
  }
  for (const tag of plan.hashtags ?? []) {
    const t = tag.replace(/^#/, '').trim();
    if (!t) continue;
    jobs.push(
      { source: `#${t}`, platform: 'tiktok', run: tiktokHashtag(t) },
      { source: `#${t}`, platform: 'instagram', run: instagramHashtag(t) }
    );
  }

  const settled = await Promise.all(jobs.map((j) => j.run));
  const yields: TrendSweep['yields'] = [];
  const errors: TrendSweep['errors'] = [];
  const all: TrendingVideo[] = [];

  settled.forEach((outcome, i) => {
    const job = jobs[i];
    yields.push({ source: job.source, platform: job.platform, videos: outcome.videos.length });
    if (outcome.error) errors.push({ source: `${job.platform}/${job.source}`, message: outcome.error });
    all.push(...outcome.videos.map((v) => ({ ...v, category: plan.category })));
  });

  // Only clips the judge can fetch and the baseline can anchor are worth storing.
  return {
    videos: analysable(dedupeVideos(all)).slice(0, plan.limit ?? 300),
    yields,
    errors
  };
}
