import type { SupabaseClient } from '@supabase/supabase-js';

/** Minimal prefs shape — avoids circular import with content-preview. */
export type HygienePrefs = {
  platformHashtags?: Record<string, string[]>;
};

export type HygieneWinner = {
  content: string | null;
  platform: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metrics: Record<string, any> | null;
};

/** Normalize a hashtag token to lowercase `#tag`. */
export function normHashtag(t: string): string {
  const s = t.trim().toLowerCase();
  if (!s) return '';
  return s.startsWith('#') ? s : `#${s}`;
}

/** Extract hashtags from caption text (Unicode letters allowed). */
export function extractHashtags(caption: string): string[] {
  return [...String(caption ?? '').matchAll(/#[\p{L}0-9_]+/gu)].map((m) => normHashtag(m[0]));
}

/**
 * When the brand has an approved hashtag set for `platform`, every tag in the caption
 * must be in that set. Empty allowed set → no hard gate (writer may omit tags).
 */
export function assertHashtagPrefs(
  caption: string,
  platform: string | null | undefined,
  prefs: HygienePrefs = {}
): { ok: true } | { ok: false; bad: string[]; allowed: string[] } {
  const key = String(platform ?? '')
    .toLowerCase()
    .trim();
  const allowed = (prefs.platformHashtags?.[key] ?? []).map(normHashtag).filter(Boolean);
  if (!allowed.length) return { ok: true };
  const used = extractHashtags(caption);
  const bad = used.filter((t) => !allowed.includes(t));
  if (!bad.length) return { ok: true };
  return { ok: false, bad, allowed };
}

/**
 * REACH-CHASING HASHTAGS. Tags whose only purpose is to be broad — they carry tens of millions of
 * posts, the audience they reach has no relationship to the brand, and on every current feed they
 * are a spam signal rather than a distribution one.
 *
 * The existing gate only fires when a brand has configured an approved SET. Most brands have not,
 * and for them nothing stopped a caption closing on `#viral #fyp #explorepage` — which reads as an
 * account begging, and buys impressions from people who will never convert.
 *
 * Deliberately SHORT and deliberately about REACH-CHASING, not about popularity: `#marketing` is
 * broad and legitimate, `#followforfollow` is not. A long list would start deleting a brand's real
 * category tags, and a hygiene rule that removes correct work is worse than no rule.
 */
export const REACH_CHASING_HASHTAGS = new Set([
  '#viral',
  '#viralpost',
  '#viralvideo',
  '#virale',
  '#fyp',
  '#fypage',
  '#foryou',
  '#foryoupage',
  '#perte',
  '#pertepage',
  '#explore',
  '#explorepage',
  '#instagood',
  '#instadaily',
  '#photooftheday',
  '#likeforlike',
  '#like4like',
  '#followforfollow',
  '#follow4follow',
  '#f4f',
  '#l4l',
  '#trending',
  '#trend',
  '#tiktokviral',
  '#seguimi',
  '#seguici'
]);

/** The tags in this caption that exist only to chase reach. */
export function reachChasingHashtags(caption: string): string[] {
  return [...new Set(extractHashtags(caption))].filter((t) => REACH_CHASING_HASHTAGS.has(t));
}

/**
 * Remove reach-chasing tags, whatever the brand's prefs say.
 *
 * Runs even when a brand HAS an approved set: an approved set is about which of the brand's own
 * tags to use, and nobody deliberately approves `#fyp`.
 */
export function stripReachChasingHashtags(caption: string): string {
  const bad = new Set(reachChasingHashtags(caption));
  if (!bad.size) return String(caption ?? '');
  return String(caption ?? '')
    .replace(/#[\p{L}0-9_]+/gu, (tag) => (bad.has(normHashtag(tag)) ? '' : tag))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Strip hashtags that violate brand prefs (keeps caption otherwise). */
export function stripDisallowedHashtags(
  caption: string,
  platform: string | null | undefined,
  prefs: HygienePrefs = {}
): string {
  const check = assertHashtagPrefs(caption, platform, prefs);
  if (check.ok) return caption;
  const bad = new Set(check.bad);
  return String(caption ?? '')
    .replace(/#[\p{L}0-9_]+/gu, (tag) => (bad.has(normHashtag(tag)) ? '' : tag))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type RedditCraftInput = {
  subreddit?: string | null;
  title?: string | null;
  caption?: string | null;
};

/**
 * Hard Reddit craft checks used by produce submit_batch and legacy review.
 * Does not judge sub relevance (LLM/reviewer) — only required fields + obvious promo spam.
 */
export function assertRedditCraft(
  input: RedditCraftInput
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const sub = String(input.subreddit ?? '')
    .replace(/^r\//i, '')
    .trim();
  const title = String(input.title ?? '').trim();
  const caption = String(input.caption ?? '').trim();
  if (!sub) errors.push('missing subreddit');
  if (!title) errors.push('missing title');
  // Soft promo smell: waitlist / "check us out" + naked product URL in body.
  if (/\b(waitlist|check us out|sign up now|buy now)\b/i.test(caption) && /https?:\/\//i.test(caption)) {
    errors.push('self-promo link spam risk (CTA + URL in body)');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/** Radar / brand kit known subs for planner seed guidance. */
export async function loadKnownSubreddits(
  supabase: SupabaseClient,
  brandId: string
): Promise<string[]> {
  try {
    const { data } = await supabase
      .from('brand_news_sources')
      .select('value')
      .eq('brand_id', brandId)
      .eq('kind', 'subreddit')
      .limit(12);
    const out = (data ?? [])
      .map((r) =>
        String(r.value ?? '')
          .replace(/^r\//i, '')
          .trim()
      )
      .filter(Boolean);
    return [...new Set(out)];
  } catch (e) {
    console.warn('[known-subreddits]', e instanceof Error ? e.message : e);
    return [];
  }
}

export function knownSubredditsBlock(subs: string[]): string {
  if (!subs.length) return '';
  return `KNOWN SUBREDDITS (prefer these for Reddit seeds — real brand radar sources; pick the one that fits the post's substance, or another real on-topic sub and justify):\n${subs.map((s) => `- r/${s}`).join('\n')}\n`;
}

/** Fixed WINNING PATTERNS block for produce / caption pass 2. */
export function winningPatternsBlock(
  topPosts: HygieneWinner[],
  opts?: { digest?: string; limit?: number }
): string {
  const limit = opts?.limit ?? 5;
  const digest = opts?.digest?.trim();
  const lines = topPosts.slice(0, limit).map((p) => {
    const er = p.metrics?.engagementRate;
    const likes = p.metrics?.likes;
    const comments = p.metrics?.comments;
    const stat = [
      likes != null ? `${likes} likes` : '',
      comments != null ? `${comments} comments` : '',
      er != null ? `${er}% eng.` : ''
    ]
      .filter(Boolean)
      .join(', ');
    return `- [${p.platform ?? '?'}${stat ? ` · ${stat}` : ''}] ${String(p.content ?? '')
      .replace(/\s+/g, ' ')
      .slice(0, 180)}`;
  });
  if (!digest && !lines.length) return '';
  return `WINNING PATTERNS (authoritative performance signal — mine hooks, angles, formats; do NOT copy captions verbatim):\n${digest ? `Digest: ${digest}\n` : ''}${lines.length ? `Top posts:\n${lines.join('\n')}\n` : ''}`;
}

/** Default line when brand_visual_insights has no qualifying rows — never invent winners. */
export const VISUAL_WINNERS_NO_DATA =
  "WINNING VISUALS: No own visual data yet — use the brief's recommended defaults.";

export type VisualInsightRow = {
  dimension: string;
  value: string;
  n: number;
  /** Mean ER in percent. */
  er_avg?: number | null;
  /** Percentage points vs the brand mean (35 = +35% ER). */
  delta?: number | null;
};

/**
 * Fixed VISUAL WINNERS block for produce — rows from brand_visual_insights (own posts only).
 * Only buckets that actually BEAT the brand mean (delta > 0) qualify, best first: a losing
 * bucket must never reach the produce prompt labelled as a winner.
 */
export function visualInsightsBlock(rows: VisualInsightRow[], opts?: { limit?: number }): string {
  const limit = opts?.limit ?? 8;
  const valid = rows
    .filter((r) => Number(r.n) >= 3 && r.delta != null && Number(r.delta) > 0)
    .sort((a, b) => Number(b.delta) - Number(a.delta))
    .slice(0, limit);
  if (!valid.length) return VISUAL_WINNERS_NO_DATA;
  const lines = valid.map((r) => {
    const d = Number(r.delta);
    const str = Number.isInteger(d)
      ? d.toFixed(0)
      : Math.abs(d) >= 10
        ? d.toFixed(0)
        : d.toFixed(1);
    return `- ${r.dimension}: ${String(r.value)} (${d >= 0 ? '+' : ''}${str}% ER vs avg, n=${r.n})`;
  });
  return `VISUAL WINNERS — what performs for THIS brand (from your own published posts):\n${lines.join('\n')}`;
}

/** 2–3 short hook lines for analytics week briefs. */
export function winningHookLines(topPosts: HygieneWinner[], n = 3): string[] {
  return topPosts
    .slice(0, n)
    .map((p) => {
      const text = String(p.content ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return '';
      const first = text.split(/[.!?\n]/)[0]?.trim() || text;
      return first.slice(0, 120);
    })
    .filter(Boolean);
}
