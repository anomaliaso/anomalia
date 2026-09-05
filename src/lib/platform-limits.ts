// Single source of truth for per-platform caption character limits. X (Twitter) is the
// tight one that actually rejects a post; the others are generous ceilings we still guard
// so nothing goes out malformed. Used by the UI (live warning + disabled approve) and by
// the server publish path (hard backstop before we ever call Zernio).
export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  twitter: 280,
  bluesky: 300,
  threads: 500,
  mastodon: 500,
  instagram: 2200,
  tiktok: 2200,
  linkedin: 3000,
  facebook: 63206,
  reddit: 40000,
  youtube: 5000
};

export const PLATFORM_LABELS: Record<string, string> = {
  x: 'X', twitter: 'X', bluesky: 'Bluesky', threads: 'Threads', mastodon: 'Mastodon',
  instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', facebook: 'Facebook', reddit: 'Reddit',
  youtube: 'YouTube'
};

export function platformLimit(platform: string | null | undefined): number | null {
  return PLATFORM_CHAR_LIMITS[(platform ?? '').toLowerCase()] ?? null;
}

export function platformLabel(platform: string | null | undefined): string {
  const k = (platform ?? '').toLowerCase();
  return PLATFORM_LABELS[k] ?? platform ?? 'this platform';
}

/** YouTube video title: explicit title, else first line of the caption, capped at 100 chars. */
export function youtubeTitleFrom(caption: string | null | undefined, explicit?: string | null): string {
  const fromExplicit = (explicit ?? '').trim();
  const fromCaption = (caption ?? '').trim().split('\n')[0]?.trim() ?? '';
  const raw = fromExplicit || fromCaption;
  return raw.slice(0, YOUTUBE_TITLE_LIMIT);
}

// Per-platform caption overrides (posts.platform_captions): {"x": "...", "threads": "..."}.
// A missing/empty entry means "publish the main caption" — the short networks are the only ones
// that need their own cut, so we only ever author these two.
export type PlatformCaptions = Record<string, string> | null | undefined;
export const ALT_CAPTION_PLATFORMS = ['x', 'threads'] as const;

/** Platforms whose publish API accepts a multi-image carousel (Zernio mediaItems). */
export const CAROUSEL_PUBLISH_PLATFORMS = new Set(['instagram', 'facebook', 'linkedin']);

/** Instagram / TikTok / YouTube cannot ship a text-only post. */
export const VISUAL_REQUIRED_PLATFORMS = new Set(['instagram', 'tiktok', 'youtube']);

/** YouTube is video-only (Zernio: one video per post). Shorts vs long-form is auto-detected. */
export const VIDEO_ONLY_PLATFORMS = new Set(['youtube']);

/** YouTube Data API title limit (Zernio `platformSpecificData.title`). */
export const YOUTUBE_TITLE_LIMIT = 100;

/**
 * Media list to send to a given network. Carousel platforms get every slide; everyone else
 * gets a single image (the cover / first slide) so X/Threads/TikTok never receive a gallery.
 */
export function mediaUrlsForPublish(
  platform: string | null | undefined,
  mediaUrl: string | null | undefined,
  mediaUrls: string[] | null | undefined
): string[] | undefined {
  const key = capKey(platform);
  const slides = (mediaUrls ?? []).map(String).filter(Boolean);
  if (CAROUSEL_PUBLISH_PLATFORMS.has(key) && slides.length > 1) return slides;
  const one = (typeof mediaUrl === 'string' && mediaUrl.trim() ? mediaUrl.trim() : '') || slides[0];
  return one ? [one] : undefined;
}

/**
 * Persist a main caption plus optional per-platform overrides. Empty or identical overrides
 * are dropped; X/Threads cuts are filled when the main caption would overflow those networks.
 */
export function assemblePlatformCaptions(
  main: string,
  byPlatform: Record<string, string> | null | undefined,
  platforms: (string | null | undefined)[]
): { caption: string; platform_captions: Record<string, string> | null } {
  const caption = main.trim();
  const overrides: Record<string, string> = {};
  for (const raw of platforms) {
    const key = capKey(raw);
    if (!key) continue;
    const text = String(byPlatform?.[key] ?? '').trim();
    if (text && text !== caption) overrides[key] = text;
  }
  const ensured = ensureShortNetworkCuts(
    caption,
    platforms,
    Object.keys(overrides).length ? overrides : null
  );
  return { caption, platform_captions: ensured };
}

// Normalise a platform key to the one the override map is stored under (twitter === x).
const capKey = (platform: string | null | undefined) => {
  const k = (platform ?? '').toLowerCase();
  return k === 'twitter' ? 'x' : k;
};

// The text that actually goes out on `platform`: its override when set, else the main caption.
export function captionFor(
  caption: string | null | undefined,
  overrides: PlatformCaptions,
  platform: string | null | undefined
): string {
  const alt = overrides?.[capKey(platform)];
  return typeof alt === 'string' && alt.trim() ? alt : (caption ?? '');
}

/**
 * Soft-truncate prose to fit a short-network limit. Prefers a sentence/word break in the
 * second half of the budget so we don't ship a half-word mid-thought.
 */
export function truncateForPlatform(text: string, limit: number): string {
  const raw = text.trim();
  if (raw.length <= limit) return raw;
  const budget = Math.max(1, limit);
  const slice = raw.slice(0, budget);
  // Prefer breaking on sentence, then newline, then clause, then word — never too early.
  const candidates = [
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n'),
    slice.lastIndexOf(', '),
    slice.lastIndexOf('; '),
    slice.lastIndexOf(': '),
    slice.lastIndexOf(' ')
  ];
  const minBreak = Math.floor(budget * 0.5);
  let breakAt = -1;
  for (const c of candidates) {
    if (c >= minBreak) {
      breakAt = c;
      break;
    }
  }
  const cut = (breakAt >= 0 ? slice.slice(0, breakAt + (slice[breakAt] === ' ' ? 0 : 1)) : slice).trim();
  // If we still overflow somehow (edge: no spaces), hard slice.
  return cut.length <= budget ? cut : cut.slice(0, budget).trim();
}

const widestNumbering = (parts: number) => 2 * String(parts).length + 2;

const packToBudget = (text: string, budget: number): string[] => {
  const room = Math.max(1, budget);
  const parts: string[] = [];
  let rest = text;

  while (rest.length > room) {
    const head = truncateForPlatform(rest, room);
    parts.push(head);
    rest = rest.slice(head.length).trim();
  }
  if (rest) parts.push(rest);

  return parts;
};

export function splitForPlatform(text: string, limit: number): string[] {
  const raw = text.trim();
  if (raw.length <= limit) return [raw];

  let reserved = 0;
  let parts = packToBudget(raw, limit);
  while (widestNumbering(parts.length) > reserved) {
    reserved = widestNumbering(parts.length);
    parts = packToBudget(raw, limit - reserved);
  }

  return parts.map((part, i) => `${part} ${i + 1}/${parts.length}`);
}

/**
 * Ensure every short-network target in `platforms` has a usable cut when the main caption
 * exceeds that network's limit. Keeps existing valid cuts; synthesises the rest by truncation.
 * Returns null when nothing needs storing (main already fits everywhere / no short targets).
 */
export function ensureShortNetworkCuts(
  caption: string | null | undefined,
  platforms: (string | null | undefined)[] | null | undefined,
  existing?: PlatformCaptions
): Record<string, string> | null {
  const main = (caption ?? '').trim();
  const targets = new Set(
    (platforms ?? []).map((p) => capKey(p)).filter((k): k is string => !!k)
  );
  const cuts: Record<string, string> = {};
  for (const [k, v] of Object.entries(existing ?? {})) {
    const key = capKey(k);
    const text = typeof v === 'string' ? v.trim() : '';
    if (key && text) cuts[key] = text;
  }

  let touched = false;
  for (const key of ALT_CAPTION_PLATFORMS) {
    if (!targets.has(key)) continue;
    const limit = PLATFORM_CHAR_LIMITS[key];
    if (!limit) continue;
    const have = cuts[key];
    if (have && have.length <= limit) continue;
    if (main.length <= limit) {
      // Main already fits — drop a stale over-limit cut if any.
      if (have) {
        delete cuts[key];
        touched = true;
      }
      continue;
    }
    cuts[key] = truncateForPlatform(main, limit);
    touched = true;
  }

  if (!Object.keys(cuts).length) return null;
  // Return even when untouched so callers can persist writer-authored cuts as-is.
  if (!touched && existing && Object.keys(cuts).length) return cuts;
  return cuts;
}

export type PublishTarget = {
  platforms: string[];
  caption: string;
  platformCaptions?: PlatformCaptions;
  hasMedia: boolean;
  hasVideo: boolean;
  title?: string | null;
};

export type PublishBlockerCode = 'need_media' | 'need_video' | 'over_limit' | 'reddit_title';

export type PublishBlocker = { code: PublishBlockerCode; field: string; detail: string };

// Il percorso che crea un post e quello che lo controlla senza crearlo leggono questa tabella,
// nello stesso ordine: una piattaforma nuova si aggiunge in un posto solo.
const PUBLISH_REQUIREMENTS: {
  code: PublishBlockerCode;
  field: string;
  blocking: (target: PublishTarget) => string | null;
}[] = [
  {
    code: 'need_media',
    field: 'media_ids',
    blocking: ({ platforms, hasMedia }) => {
      const need = platforms.filter((p) => VISUAL_REQUIRED_PLATFORMS.has(p));
      return need.length && !hasMedia
        ? `${need.map(platformLabel).join(', ')} cannot publish text alone: attach at least one asset`
        : null;
    }
  },
  {
    code: 'need_video',
    field: 'media_ids',
    blocking: ({ platforms, hasVideo }) => {
      const need = platforms.filter((p) => VIDEO_ONLY_PLATFORMS.has(p));
      return need.length && !hasVideo
        ? `${need.map(platformLabel).join(', ')} accepts video only: the attached asset is not a video`
        : null;
    }
  },
  {
    code: 'over_limit',
    field: 'caption',
    blocking: ({ caption, platforms, platformCaptions }) => {
      const over = captionViolations(caption, platforms, platformCaptions);
      return over.length
        ? over.map((v) => `${v.label}: ${v.length} characters, limit ${v.limit}`).join('; ')
        : null;
    }
  },
  {
    code: 'reddit_title',
    field: 'title',
    blocking: ({ platforms, title }) =>
      platforms.includes('reddit') && !String(title ?? '').trim()
        ? 'Reddit needs a title of its own, max 300 characters'
        : null
  }
];

/** Which platform requirements this content fails (empty = publishable). No I/O, no model. */
export function publishBlockers(target: PublishTarget): PublishBlocker[] {
  const out: PublishBlocker[] = [];
  for (const rule of PUBLISH_REQUIREMENTS) {
    const detail = rule.blocking(target);
    if (detail) out.push({ code: rule.code, field: rule.field, detail });
  }
  return out;
}

export type CaptionViolation = { platform: string; label: string; limit: number; length: number };

// Which target platforms' char limit the post exceeds (empty = all good). Each platform is checked
// against the caption IT will actually publish (its override, else the main one). Uses raw length;
// ponytail: X shortens URLs to 23 chars so a link-heavy caption could pass at 280 real chars —
// erring strict here is fine, the offender in practice is prose way over the limit.
export function captionViolations(
  caption: string | null | undefined,
  platforms: (string | null | undefined)[],
  overrides?: PlatformCaptions
): CaptionViolation[] {
  const seen = new Set<string>();
  const out: CaptionViolation[] = [];
  for (const p of platforms) {
    const k = (p ?? '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const limit = PLATFORM_CHAR_LIMITS[k];
    const length = captionFor(caption, overrides, k).length;
    if (limit && length > limit) out.push({ platform: k, label: platformLabel(k), limit, length });
  }
  return out;
}
