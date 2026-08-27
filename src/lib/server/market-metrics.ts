/**
 * Market analysis maths — how a harvested post is turned into a LABEL the rubric can be fitted
 * against. Pure: no I/O, no clock, no AI.
 *
 * WHY NOT "THE MOST VIRAL POSTS IN THE WORLD". A global top-posts feed is almost entirely a ranking
 * of follower counts: a mediocre post from a 500k account beats an excellent one from a 2k account,
 * every time. Fit a rubric against raw engagement and the only thing it learns is audience size —
 * which our copy cannot change. Worse, a feed of winners has no denominator: you see what successful
 * posts look like, never what separates them from the flops of the same account.
 *
 * So the label here is OUTPERFORMANCE: this post's engagement divided by the median of the SAME
 * account. "2.4× its own baseline" is follower-free by construction, and it cancels niche, account
 * size and algorithmic tier without needing follower counts — which, as it happens, we do not store
 * anywhere (`SocialProfile` in scrapecreators.ts carries name, photo and thumbs, nothing else).
 *
 * WHERE THE DENOMINATOR COMES FROM. Discovery (keyword search, `sort=rising`, the ad library) finds
 * winners without a baseline — that is the one thing a trending feed structurally cannot give you.
 * So harvesting runs in two stages: discovery surfaces the post AND the account behind it, then the
 * account's recent history is pulled through the handle-based endpoints to get its median. Account
 * histories are cached for a week (`MEDIA_FRESH_MS`), so the baseline costs one fetch per account,
 * not one per post.
 *
 * SPEARMAN, NOT PEARSON. Engagement is a power law: a handful of posts carry values orders of
 * magnitude above the rest, and a Pearson correlation on those is decided by two outliers. Rank
 * correlation asks the question we actually mean — "do posts that score higher on this check tend
 * to rank higher on outperformance" — and is unmoved by how extreme the top of the tail is.
 */

/** Fewer posts than this from one account and its median is not a baseline, it's a coin flip. */
export const MIN_ACCOUNT_POSTS = 5;

/** Below this many scored pairs a correlation is not reported at all. */
export const MIN_CORRELATION_PAIRS = 30;

export type MarketPost = {
  id?: string;
  accountKey: string;
  platform?: string | null;
  mediaType?: string | null;
  content?: string | null;
  publishedAt?: string | null;
  metrics?: Record<string, unknown> | null;
};

const num = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

/**
 * Interactions, deliberately excluding views.
 *
 * Views are not comparable across platforms (some count a 1-second autoplay), are absent entirely on
 * several, and would make every video outrank every still regardless of quality. Likes + comments +
 * shares is available everywhere and is an ACTION, which is what we are trying to predict.
 */
export function engagementOf(post: MarketPost): number {
  const m = post.metrics ?? {};
  return num(m.likes) + num(m.comments) + num(m.shares);
}

/**
 * Interactions per view — the resonance metric, and the one that separates CONTENT from DISTRIBUTION.
 *
 * Outperformance answers "did this beat its account". This answers a different question the account
 * median cannot: a clip with ten times the usual views but the same like-rate was pushed by the
 * algorithm, while one with the usual views and triple the like-rate actually landed. Both are worth
 * knowing and they are not the same thing.
 *
 * Only meaningful where views are reported and comparable — Instagram and TikTok do, the text
 * surfaces do not — so it returns null rather than a misleading zero when views are absent.
 */
export function interactionRate(metrics: {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
}): number | null {
  const views = Number(metrics?.views) || 0;
  if (views <= 0) return null;
  const interactions =
    (Number(metrics?.likes) || 0) + (Number(metrics?.comments) || 0) + (Number(metrics?.shares) || 0);
  return Math.round((interactions / views) * 100_000) / 100_000;
}

export function median(values: number[]): number {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Coarse, cross-platform format buckets. Mirrors post-history-insights.ts so the two agree. */
export function formatBucket(mediaType: string | null | undefined): 'video' | 'carousel' | 'image' | 'text' {
  const s = String(mediaType ?? '').toLowerCase();
  if (/reel|video|short|clip/.test(s)) return 'video';
  if (/carousel|album|sidecar|multi|gallery/.test(s)) return 'carousel';
  if (/text|status|tweet|note/.test(s)) return 'text';
  return 'image';
}

export type AccountBaseline = {
  accountKey: string;
  posts: number;
  medianEngagement: number;
};

/** Median interactions per account, for accounts with enough posts to have a real baseline. */
export function accountBaselines(posts: MarketPost[]): Map<string, AccountBaseline> {
  const byAccount = new Map<string, number[]>();
  for (const p of posts) {
    const key = p.accountKey;
    if (!key) continue;
    const list = byAccount.get(key);
    if (list) list.push(engagementOf(p));
    else byAccount.set(key, [engagementOf(p)]);
  }

  const out = new Map<string, AccountBaseline>();
  for (const [accountKey, values] of byAccount) {
    if (values.length < MIN_ACCOUNT_POSTS) continue;
    const med = median(values);
    // An account whose median is 0 (brand-new, or engagement not returned) cannot be a denominator.
    if (med <= 0) continue;
    out.set(accountKey, { accountKey, posts: values.length, medianEngagement: med });
  }
  return out;
}

/**
 * How far this post beat its own account's typical post. 1.0 = exactly typical, 3.0 = triple.
 * Null when the account has no usable baseline — an unlabelled post, not a zero.
 */
export function outperformance(post: MarketPost, baselines: Map<string, AccountBaseline>): number | null {
  const base = baselines.get(post.accountKey);
  if (!base) return null;
  return engagementOf(post) / base.medianEngagement;
}

/** Average ranks, ties shared — the tie handling is what keeps Spearman correct on flat scores. */
export function ranks(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    // Ranks are 1-based; a tie group all take the average of the positions it spans.
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) out[indexed[k].i] = avg;
    i = j + 1;
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? num / den : 0;
}

/** Spearman rank correlation. 0 when there are too few pairs or either side is constant. */
export function spearman(pairs: Array<{ x: number; y: number }>): number {
  const usable = pairs.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (usable.length < 3) return 0;
  return pearson(
    ranks(usable.map((p) => p.x)),
    ranks(usable.map((p) => p.y))
  );
}

export type CheckCorrelation = {
  id: string;
  /** Spearman rho against outperformance. Positive = the check tracks posts that beat their baseline. */
  rho: number;
  n: number;
  /**
   * Whether |rho| clears the rough 95% noise floor for this n (1.96/sqrt(n-1)).
   * An approximation, and deliberately the only significance claim made here.
   */
  significant: boolean;
};

/** Rough two-sided 95% threshold for a rank correlation at this sample size. */
export function noiseFloor(n: number): number {
  if (n < 4) return 1;
  return 1.96 / Math.sqrt(n - 1);
}

export type ScoredMarketPost = {
  /** Per-check 0..1 values, as produced by `checkValues()`. */
  checks: Record<string, number>;
  /** Label: engagement relative to the account's own median. */
  outperformance: number;
  platform?: string | null;
  format?: string | null;
  category?: string | null;
};

/**
 * Fit report: for each check, does it actually track outperformance?
 *
 * This is the instrument that tells us which of the rubric's asserted weights are earned. It is
 * NOT wired to change any weight automatically — see docs/33: the rubric is a frozen measuring
 * stick, and a stick that retunes itself nightly measures nothing. This produces evidence; a person
 * decides, bumps CONTENT_SCORER_VERSION, and re-scores history.
 *
 * Expect modest numbers. Copy is a small share of the variance in engagement, so |rho| around
 * 0.1–0.25 is a real signal here, not a disappointment — and anything above ~0.5 should be treated
 * as a bug or a leak before it is celebrated.
 */
export function correlateChecks(posts: ScoredMarketPost[]): CheckCorrelation[] {
  const ids = new Set<string>();
  for (const p of posts) for (const k of Object.keys(p.checks ?? {})) ids.add(k);

  const out: CheckCorrelation[] = [];
  for (const id of ids) {
    const pairs = posts
      .filter((p) => typeof p.checks?.[id] === 'number' && Number.isFinite(p.outperformance))
      .map((p) => ({ x: p.checks[id], y: p.outperformance }));
    if (pairs.length < MIN_CORRELATION_PAIRS) continue;
    const rho = spearman(pairs);
    out.push({
      id,
      rho: Math.round(rho * 1000) / 1000,
      n: pairs.length,
      significant: Math.abs(rho) >= noiseFloor(pairs.length)
    });
  }
  return out.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
}

/**
 * Same fit, split by vertical.
 *
 * A check that only holds for restaurants reads as a universal law once every niche is averaged
 * into one number. Segmenting is also the honest answer to "their corpus is bigger than ours": a
 * large sample of the wrong population is worth less than a small one of the right population, and
 * this is what makes that claim checkable rather than rhetorical.
 */
export function correlateByCategory(posts: ScoredMarketPost[]): Record<string, CheckCorrelation[]> {
  const buckets = new Map<string, ScoredMarketPost[]>();
  for (const p of posts) {
    const key = String(p.category ?? '').trim() || 'uncategorised';
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  const out: Record<string, CheckCorrelation[]> = {};
  for (const [key, list] of buckets) {
    const correlations = correlateChecks(list);
    if (correlations.length) out[key] = correlations;
  }
  return out;
}

/**
 * Same fit, split by format bucket.
 *
 * Fitting across formats is how you get a fake result: a check can correlate with performance purely
 * because the accounts that write good hooks also post more video. Within a bucket, that confound
 * is gone.
 */
export function correlateByFormat(posts: ScoredMarketPost[]): Record<string, CheckCorrelation[]> {
  const buckets = new Map<string, ScoredMarketPost[]>();
  for (const p of posts) {
    const key = formatBucket(p.format);
    const list = buckets.get(key);
    if (list) list.push(p);
    else buckets.set(key, [p]);
  }
  const out: Record<string, CheckCorrelation[]> = {};
  for (const [key, list] of buckets) {
    const correlations = correlateChecks(list);
    if (correlations.length) out[key] = correlations;
  }
  return out;
}

// ── Trajectory ────────────────────────────────────────────────────────────────────────────────
//
// The reason the harvest runs hourly. A single engagement reading is not comparable across posts,
// because it silently carries the post's AGE: seen 2h after publishing, a great post looks worse
// than a mediocre one seen 20h after. Re-observing the same post turns that into a curve, and a
// curve can be read at a common age — which is the only way the label means the same thing for all
// of them.

/** Hours to normalise every post to. Late enough to be past the initial spike, early enough that a
 *  post discovered today can reach it by tomorrow's fit. */
export const REFERENCE_AGE_HOURS = 24;

export type Observation = {
  /** Hours between publication and this reading. */
  ageHours: number;
  engagement: number;
};

/** Chronological, de-duplicated by age, junk dropped. */
export function normalizeObservations(observations: Observation[]): Observation[] {
  const byAge = new Map<number, Observation>();
  for (const o of observations) {
    if (!Number.isFinite(o.ageHours) || !Number.isFinite(o.engagement)) continue;
    if (o.ageHours < 0 || o.engagement < 0) continue;
    // A later reading at the same age wins: engagement only accumulates, so the larger is fresher.
    const prev = byAge.get(o.ageHours);
    if (!prev || o.engagement > prev.engagement) byAge.set(o.ageHours, o);
  }
  return [...byAge.values()].sort((a, b) => a.ageHours - b.ageHours);
}

/**
 * Engagement at `targetAge`, linearly interpolated between the two readings that straddle it.
 *
 * Returns null when the series does not straddle the target — deliberately. Extrapolating past the
 * last reading would invent the number the whole exercise exists to measure, and a post observed
 * only at 3h simply does not have a 24h value yet. It gets one tomorrow.
 *
 * The one safe exception is a target at or before the first reading: engagement only accumulates,
 * so a post already at N interactions when first seen had at most N earlier.
 */
export function engagementAtAge(observations: Observation[], targetAge = REFERENCE_AGE_HOURS): number | null {
  const series = normalizeObservations(observations);
  if (!series.length) return null;

  const first = series[0];
  const last = series[series.length - 1];
  if (targetAge < first.ageHours) return null;
  if (targetAge > last.ageHours) return null;
  if (targetAge === first.ageHours) return first.engagement;

  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    if (targetAge > cur.ageHours) continue;
    const span = cur.ageHours - prev.ageHours;
    if (span <= 0) return cur.engagement;
    const t = (targetAge - prev.ageHours) / span;
    return prev.engagement + (cur.engagement - prev.engagement) * t;
  }
  return last.engagement;
}

/** Interactions gained per hour across the observed window. Null with fewer than two readings. */
export function velocity(observations: Observation[]): number | null {
  const series = normalizeObservations(observations);
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const span = last.ageHours - first.ageHours;
  if (span <= 0) return null;
  return (last.engagement - first.engagement) / span;
}

/**
 * Still climbing? A post whose last interval added nothing has settled, and its current number is
 * close to final — which is when it is safe to label. One that is still moving would be labelled
 * too early, understating it.
 */
export function hasSettled(observations: Observation[]): boolean {
  const series = normalizeObservations(observations);
  if (series.length < 2) return false;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (last.engagement <= 0) return true;
  const growth = (last.engagement - prev.engagement) / last.engagement;
  return growth < 0.02;
}

/**
 * The standouts, by outperformance rather than by raw engagement — "beat its own account by 4×"
 * rather than "belongs to a big account". This is the feed worth reading for inspiration, and the
 * one the planner should be fed.
 */
export function topOutperformers<T extends { outperformance: number }>(posts: T[], limit = 20): T[] {
  return [...posts]
    .filter((p) => Number.isFinite(p.outperformance))
    .sort((a, b) => b.outperformance - a.outperformance)
    .slice(0, limit);
}

/**
 * The hour of day a post went out, in the creator's own country.
 *
 * A UTC timestamp answers nothing on its own: "published at 19:00Z" is dinner time in Italy and
 * lunch in Los Angeles, and posting time only means anything relative to the audience awake for it.
 * So the hour is only reported when the region is known and unambiguous — a country spanning many
 * zones (US, RU, BR) gets null rather than a number picked from one of its coasts, because a wrong
 * hour would quietly group evening posts with morning ones.
 *
 * Offsets are standard time; DST shifts them by an hour. That is deliberate: correcting for DST
 * needs a real tz database, and for the question being asked here — is there a band of hours that
 * outperforms — an hour of drift does not change the answer, while a fake precision would suggest
 * it could.
 */
const REGION_UTC_OFFSET: Record<string, number> = {
  IT: 1, ES: 1, FR: 1, DE: 1, NL: 1, BE: 1, AT: 1, CH: 1, PL: 1, SE: 1, NO: 1, DK: 1,
  GB: 0, IE: 0, PT: 0,
  GR: 2, RO: 2, FI: 2, TR: 3,
  IN: 5.5, AE: 4, SG: 8, PH: 8, JP: 9, KR: 9, ID: 7, TH: 7, VN: 7,
  MX: -6, AR: -3, CL: -3, CO: -5, PE: -5
};

/** Countries wide enough that one offset would be a lie. */
export const AMBIGUOUS_REGIONS = new Set(['US', 'CA', 'RU', 'BR', 'AU', 'CN', 'KZ', 'CD', 'MN']);

export function localHour(publishedAt: string | null | undefined, region: string | null | undefined): number | null {
  if (!publishedAt || !region) return null;
  const code = region.trim().toUpperCase();
  if (AMBIGUOUS_REGIONS.has(code)) return null;
  const offset = REGION_UTC_OFFSET[code];
  if (offset == null) return null;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return null;
  const shifted = new Date(t + offset * 3_600_000);
  return shifted.getUTCHours();
}
