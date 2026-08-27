// History mining: turn a brand's OWN post history (source='zernio' — posts the app published and
// synced back, i.e. REAL brand performance) into concrete, brand-specific performance signals for
// the planner — best posting times, winning formats, hashtags that worked, and posting cadence.
// Pure + dependency-free (the data is already in hand, so this is near-free).
//
// IMPORTANT: callers must only pass the brand's OWN rows (see own-post-history.ts). Scraped rows
// (source='scrapecreators') are pre-app/competitor data and would poison the patterns — an empty
// list is the correct input for a brand without own data (digest degrades to '').
// Times are derived in UTC (we don't know the audience timezone here) — treat them as approximate.

import { classifyHookTactic, hookCoverage, type HookCoverage, type HookUsage } from '$lib/server/hook-tactics';
import { sampleVerdict } from '$lib/server/evidence-quality';

export type HistoryPost = {
  content?: string | null;
  mediaType?: string | null;
  publishedAt?: string | null; // ISO
  metrics?: { likes?: number | null; comments?: number | null; engagementRate?: number | null } | null;
};

export type HistoryInsights = {
  postCount: number;
  bestTimes: string[]; // e.g. ["Tue 18:00", "Thu 09:00"]
  topFormats: string[]; // e.g. ["video", "carousel"]
  topHashtags: string[]; // e.g. ["#branding", "#design"]
  cadence: string; // e.g. "~4 posts/week"
  /**
   * Which of the eighteen hook tactics this brand has actually opened with, and what it has never
   * tried. Everything else in this type answers "what worked" — this one answers "what have we
   * never attempted", which is the question a planner that keeps rewriting the same three openings
   * never gets asked. See `hook-tactics.ts`.
   */
  hooks: HookCoverage;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Engagement weight for a post: prefer a real engagement rate, else likes + comments. Comments are
// a stronger signal than likes, so weight them a touch higher.
function weight(m?: HistoryPost['metrics']): number {
  if (!m) return 0;
  if (typeof m.engagementRate === 'number' && m.engagementRate > 0) return m.engagementRate;
  return (m.likes ?? 0) + (m.comments ?? 0) * 2;
}

// Normalise a platform's media type into a coarse, comparable format bucket.
function normFormat(mt?: string | null): string | null {
  if (!mt) return null;
  const s = mt.toLowerCase();
  if (/reel|video|short|clip/.test(s)) return 'video';
  if (/carousel|album|sidecar|multi|gallery/.test(s)) return 'carousel';
  if (/stor(y|ies)/.test(s)) return 'story';
  if (/image|photo|picture|graphic/.test(s)) return 'image';
  return s;
}

export function analyzePostHistory(posts: HistoryPost[]): HistoryInsights {
  const list = Array.isArray(posts) ? posts : [];

  // Hashtags weighted by engagement (baseline 1 so a tag counts even on a zero-metric post).
  const tagW = new Map<string, number>();
  for (const p of list) {
    const w = weight(p.metrics) || 1;
    for (const m of (p.content ?? '').matchAll(/#[\p{L}0-9_]{2,50}/gu)) {
      const t = m[0].toLowerCase();
      tagW.set(t, (tagW.get(t) ?? 0) + w);
    }
  }
  const topHashtags = [...tagW.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);

  // Formats weighted by engagement.
  const fmtW = new Map<string, number>();
  for (const p of list) {
    const f = normFormat(p.mediaType);
    if (f) fmtW.set(f, (fmtW.get(f) ?? 0) + (weight(p.metrics) || 1));
  }
  const topFormats = [...fmtW.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([f]) => f);

  // Best weekday+hour slots (weight + a frequency baseline) and posting cadence — need timestamps.
  const dated = list
    .map((p) => ({ d: p.publishedAt ? new Date(p.publishedAt) : null, w: weight(p.metrics) }))
    .filter((x): x is { d: Date; w: number } => !!x.d && !isNaN(x.d.getTime()));

  const slotW = new Map<string, number>();
  for (const { d, w } of dated) {
    const key = `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
    slotW.set(key, (slotW.get(key) ?? 0) + w + 1);
  }
  const bestTimes = [...slotW.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

  let cadence = '';
  if (dated.length >= 2) {
    const times = dated.map((x) => x.d.getTime()).sort((a, b) => a - b);
    const weeks = Math.max(1, (times[times.length - 1] - times[0]) / (7 * 24 * 3600 * 1000));
    const perWeek = dated.length / weeks;
    cadence = perWeek >= 1 ? `~${Math.round(perWeek)} posts/week` : `~${Math.max(1, Math.round(perWeek * 4))} posts/month`;
  }

  // Hook coverage. The tactic comes from the opening line; the format from the media type; the
  // "this one won" flag from engagement against the brand's own mean — but only once there are
  // enough posts for "won" to mean anything. Under the floor every post is just a post, and the map
  // still answers the question it exists for: what have we never tried?
  const weights = list.map((p) => weight(p.metrics));
  const meanWeight = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0;
  const winnersAreMeaningful = sampleVerdict(list.length) !== 'insufficient' && meanWeight > 0;
  const usages: HookUsage[] = list.map((p, i) => ({
    tactic: classifyHookTactic(p.content)?.tactic ?? null,
    format: normFormat(p.mediaType),
    wonAgainstAverage: winnersAreMeaningful ? weights[i] > meanWeight : null
  }));
  const hooks = hookCoverage(usages, { knownFormats: [...new Set(usages.map((u) => u.format).filter(Boolean))] as string[] });

  return { postCount: list.length, bestTimes, topFormats, topHashtags, cadence, hooks };
}

// A compact "what works here" brief to fold into the brand's ai_context so the planner schedules at
// the brand's real best times, reuses winning hashtags/formats, and matches its cadence.
// Empty when there are no OWN posts (never falls back to scraped/competitor patterns).
export function historyInsightsDigest(ins: HistoryInsights): string {
  if (!ins.postCount) return '';
  const lines = [
    ins.bestTimes.length ? `- Best times to post (UTC, from past performance): ${ins.bestTimes.join(', ')}` : '',
    ins.topFormats.length ? `- Formats that perform here: ${ins.topFormats.join(', ')}` : '',
    ins.topHashtags.length ? `- Hashtags that have worked: ${ins.topHashtags.join(' ')}` : '',
    ins.cadence ? `- Typical cadence: ${ins.cadence}` : ''
  ].filter(Boolean);
  const head = lines.length
    ? `### WHAT WORKS HERE\n(mined from the brand's own ${ins.postCount} past posts — lean into these)\n${lines.join('\n')}`
    : '';
  // The coverage map is the counterweight to everything above it: "lean into what worked" left
  // alone is how a feed converges on three openings. This says what we have never opened with.
  return [head, ins.hooks?.brief ?? ''].filter(Boolean).join('\n\n');
}
