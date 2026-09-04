/**
 * The public copies: one still, one moving, built once and then never touched again.
 *
 * WHY DERIVATIVES AT ALL. `market-media.ts` already archives every harvested post — into
 * `brand-knowledge`, which is PRIVATE, read through signed URLs, holding 8MB stills and 64MB clips.
 * None of those three properties survives contact with a public page:
 *
 *   private   every card would need a signature, so the page cannot be cached and a crawler that
 *             stored the URL gets a 400 the next day;
 *   8MB/64MB  that is a source file, not a thumbnail — a 24-card grid would be a 200MB page;
 *   one file  a video has no still to show before it plays.
 *
 * So the wall keeps its own pair in a PUBLIC bucket, and the request path does no work at all: no
 * signing, no transcoding, no database read for the bytes. Supabase serves them as static files with
 * an immutable cache header, which is the whole answer to "senza intasare il server" — the cost of a
 * card is paid once, in a cron, not once per visitor.
 *
 * WHY AN ANIMATED WEBP AND NOT A VIDEO. The moving preview is an `<img>`, not a `<video>`:
 *   - an `<img>` has no autoplay policy to lose (muted-autoplay rules differ per browser and per
 *     "low power mode", and a grid where a third of the cards refuse to move looks broken);
 *   - twenty-four `<video>` elements on a page is twenty-four media pipelines;
 *   - WebP is roughly a quarter of the bytes of the GIF it replaces at the same size.
 * It costs the seek bar and the audio, neither of which a hover preview wants.
 *
 * BEST-EFFORT, NEVER SILENT. Every failure returns a reason and the row records it — `preview_state`
 * separates "this was always a still" from "we tried and could not", because those two look
 * identical from a null column and call for completely different fixes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

/** Where the public copies live. Created in migration 0199, `public = true`. */
export const WALL_BUCKET = 'wall';

/** Long edge of the still. 1080 covers a retina detail page; the grid downscales in the browser. */
export const POSTER_MAX_EDGE = 1080;
export const POSTER_QUALITY = 78;

/**
 * The moving preview, sized for a grid cell and nothing more.
 *
 * MEASURED, NOT ESTIMATED. The first version of these constants (360px / 10fps / 3s / q55) was
 * written expecting 150–400KB and produced 390–750KB on real TikTok clips — the estimate was simply
 * wrong, and a 750KB hover preview on a phone is not a preview, it is a download. Each of the four
 * knobs is close to linear in the output size, so the fix comes off the two that cost the least to
 * lose: half a second of loop, and a quality step that a 320px-wide image in a grid cell cannot
 * show. Expect 200–400KB now.
 *
 * The width stays at 360 rather than dropping further: the same file is what the detail page shows
 * at full width, and a preview that looks soft there would cost more than the bytes save.
 */
export const PREVIEW_WIDTH = 360;
export const PREVIEW_FPS = 10;
export const PREVIEW_SECONDS = 2.5;
export const PREVIEW_QUALITY = 45;
/**
 * Skip the first moments: short-form video routinely opens on a hard cut or a black frame, and a
 * preview that starts there animates nothing for its first third.
 */
export const PREVIEW_START_SECONDS = 0.5;
/** Frame grabbed for the still, on the same reasoning. */
export const POSTER_FRAME_SECONDS = 1;

/** ffmpeg wall-clock per clip. A short-form source that takes longer than this is pathological. */
const FFMPEG_TIMEOUT_MS = 60_000;

export type WallDerivatives = {
  posterPath: string;
  posterBytes: number;
  previewPath: string | null;
  previewBytes: number | null;
  /** 'ready' — both exist · 'still' — the source was an image, nothing to animate · 'failed'. */
  state: 'ready' | 'still' | 'failed';
  /** Populated only when the animation failed while the poster survived. */
  error?: string;
};

export type BuildFailure =
  | 'no_source'
  | 'download_failed'
  | 'unsupported_source'
  | 'poster_failed'
  | 'upload_failed';

export type BuildResult =
  | { ok: true; media: WallDerivatives }
  | { ok: false; reason: BuildFailure; detail?: string };

/**
 * Public object keys. Same stem for both derivatives so one row's files sort together in the bucket
 * and a stray file is obviously orphaned.
 */
export function wallStem(platform: string, externalId: string): string {
  const safe = String(externalId).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `${String(platform).replace(/[^a-z0-9]/gi, '') || 'unknown'}/${safe}`;
}

export const posterKey = (platform: string, externalId: string): string =>
  `${wallStem(platform, externalId)}.webp`;
export const previewKey = (platform: string, externalId: string, ext = 'webp'): string =>
  `${wallStem(platform, externalId)}-anim.${ext}`;

/**
 * The public URL of a wall object.
 *
 * Built by string rather than by `getPublicUrl`, so a page can render a card without holding a
 * Supabase client — the pages are read-only and the URL of a public bucket is a pure function of
 * the project URL.
 */
export function wallPublicUrl(supabaseUrl: string, key: string): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${WALL_BUCKET}/${key}`;
}

function ffmpeg(bin: string, args: string[]): { ok: boolean; stderr: string } {
  const r = spawnSync(bin, ['-hide_banner', '-nostdin', '-y', ...args], {
    encoding: 'utf8',
    timeout: FFMPEG_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024
  });
  return { ok: r.status === 0, stderr: (r.stderr ?? '').slice(-400) };
}

/**
 * Still → WebP, long edge capped, never upscaled.
 *
 * `withoutEnlargement` matters more than it looks: a 400px source blown up to 1080 is bigger on disk
 * AND worse on screen, and the wall's whole claim is that the work on it is well made.
 */
export async function toPoster(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'none' })
    .rotate()
    .resize({
      width: POSTER_MAX_EDGE,
      height: POSTER_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: POSTER_QUALITY })
    .toBuffer();
}

/**
 * The ffmpeg filter chain for the animation. Exported because it is the one part of this module
 * worth asserting on in a test — the rest is filesystem and network.
 *
 * `scale=-2` keeps the height even, which every encoder wants and libwebp merely tolerates.
 */
export function previewFilter(): string {
  return `fps=${PREVIEW_FPS},scale=${PREVIEW_WIDTH}:-2:flags=lanczos`;
}

/**
 * Animate a clip. Tries WebP, falls back to GIF.
 *
 * The fallback is not hypothetical: `ffmpeg-bin.ts` may download a release build at runtime, and a
 * build without libwebp fails at the encoder rather than at the argument parser — by which point the
 * only remaining choice is the format every ffmpeg has had since 2000. Four times the bytes, still a
 * preview, and the row records which one it got through its extension.
 */
function animate(bin: string, src: string, dir: string): { file: string; ext: string } | { error: string } {
  const common = [
    '-ss', String(PREVIEW_START_SECONDS),
    '-t', String(PREVIEW_SECONDS),
    '-i', src,
    '-an',
    '-vf', previewFilter(),
    '-loop', '0'
  ];

  const webp = join(dir, 'anim.webp');
  const w = ffmpeg(bin, [...common, '-c:v', 'libwebp', '-q:v', String(PREVIEW_QUALITY), '-preset', 'picture', webp]);
  if (w.ok && existsSync(webp) && statSync(webp).size > 0) return { file: webp, ext: 'webp' };

  const gif = join(dir, 'anim.gif');
  const g = ffmpeg(bin, [...common, gif]);
  if (g.ok && existsSync(gif) && statSync(gif).size > 0) return { file: gif, ext: 'gif' };

  return { error: `webp: ${w.stderr || 'no output'} | gif: ${g.stderr || 'no output'}` };
}

