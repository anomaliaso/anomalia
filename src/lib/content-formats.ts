// The shared, typed catalogue of content FORMATS the production engine can ACTUALLY produce —
// defined once and imported by every module that generates or consumes a format (Pass 1 planner,
// seed normalisation, video guardrails, the weekly-plan routes, the scheduler). Before this enum,
// `format` was a free-form LLM string ("carousel", "short video", "story"…) that was mostly
// decorative: planners invented labels the renderer ignored. Lives outside `server/` so UI code
// can import it too.
export const CONTENT_FORMATS = ['single_image', 'carousel', 'text_post', 'link_post', 'video'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export function isContentFormat(v: unknown): v is ContentFormat {
  return typeof v === 'string' && (CONTENT_FORMATS as readonly string[]).includes(v);
}

// Map any historical/free-form format string onto the enum. The legacy patterns are grounded in
// the DISTINCT values actually present in the DB as of 2026-07 (posts.format and
// content_plans.seeds[].format): null, 'post', 'image', 'carousel', 'reel', 'short',
// 'short video', 'video', 'story'. Anything unknown NEVER crashes and NEVER passes through:
// it falls back to 'single_image' ('story' lands there too — the engine never produces stories).
export function normalizeContentFormat(raw: unknown): ContentFormat {
  if (isContentFormat(raw)) return raw;
  const s = String(raw ?? '').toLowerCase().trim();
  if (!s) return 'single_image';
  if (/\b(reels?|shorts?|videos?|clip)\b/.test(s)) return 'video';
  if (/carousel|album|gallery|sidecar|slideshow/.test(s)) return 'carousel';
  if (/\btext\b/.test(s)) return 'text_post';
  if (/\blink\b/.test(s)) return 'link_post';
  return 'single_image'; // 'post', 'image', 'photo', 'story', and anything else
}

// Is this media URL a video file? The pipeline carries clips and stills in the SAME columns
// (posts.media_url, the PostCard `thumbnail` prop, Zernio's mediaUrls), so the extension is the
// only signal telling them apart — and getting it wrong is silent in both directions: a clip in
// a CSS background-image renders a blank card, a still sent as mediaItems type 'video' is
// rejected by the platform. One definition, used by the publisher, the renderer and the UI.
export function isVideoUrl(url: string | null | undefined): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(String(url ?? ''));
}

export function isImageUrl(url: string | null | undefined): boolean {
  return /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(String(url ?? ''));
}

export function isReviewableMediaUrl(url: string | null | undefined): boolean {
  return isVideoUrl(url) || isImageUrl(url);
}

/** Filename (or host) for logs/tables — query strings stripped. */
export function mediaUrlLabel(url: string): string {
  const raw = url.trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const last = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
    return decodeURIComponent(last).slice(0, 80);
  } catch {
    return raw.split('?')[0].slice(-80);
  }
}

// The delivery channel a format implies — the single source of truth binding the new `format`
// enum to the legacy `media` field the whole pipeline still reads ('video' posts deliver a cover
// IMAGE in the autopilot; real clips are a paid path).
// 'video' used to map to 'image' here, on the reasoning that the autopilot delivers a cover frame.
// That stopped being true once clips became real: the mapping made a video seed declare itself an
// image post, and since the capability clamp treats anything that isn't 'image' as non-visual, a
// reel on Instagram or TikTok was quietly downgraded. Format and media now agree.
export function mediaForFormat(f: ContentFormat): 'image' | 'text' | 'link' | 'video' {
  return f === 'text_post' ? 'text' : f === 'link_post' ? 'link' : f === 'video' ? 'video' : 'image';
}
