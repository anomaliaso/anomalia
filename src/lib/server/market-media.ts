/**
 * Permanent copies of harvested media.
 *
 * `media-archive.ts` already solves this for images and states the reason at the top: every media
 * URL a platform returns is a signed CDN link that dies within days. It refuses anything that is
 * not `image/*`, which is correct for its callers and useless for a video corpus — so this is the
 * same idea with video allowed, its own (much larger) size cap, and its own path prefix.
 *
 * It is a separate module rather than a flag on the existing one because the caps differ by an
 * order of magnitude, and quietly letting a 200MB video through a helper other code paths call with
 * a 5MB expectation is how a function memory limit becomes someone else's outage.
 *
 * Best-effort, but never silent: a failed archive returns a REASON and the caller keeps the (rotting)
 * URL. The harvest must never fail because a CDN was slow — and it must never hide that it did.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ARCHIVE_USER_AGENT, safeFetchBytes, SafeFetchError, type SafeFetchReason } from '$lib/server/tool-guard';

const BUCKET = 'brand-knowledge';
/** Harvested market media lives under its own prefix, apart from per-brand knowledge files. */
const PREFIX = 'market';

/** Images are small; the cap exists only to reject something pathological. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/**
 * Short-form clips run 5–40MB. 64MB keeps a normal Reel and rejects a long upload that would blow
 * the function's memory — the download is buffered, so this ceiling is a real constraint, not a
 * preference.
 */
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export type ArchivedMedia = {
  path: string;
  bytes: number;
  kind: 'image' | 'video';
};

/**
 * Why an archive did not happen. A bare null collapses "the CDN link had already expired" and "the
 * file was 300MB" and "the bucket rejected the upload" into one indistinguishable outcome — and
 * those three call for completely different fixes. The reason rides out to the run log.
 */
export type ArchiveFailure =
  | 'bad_url'
  | 'blocked_host'
  | 'fetch_failed'
  | 'http_error'
  | 'unsupported_type'
  | 'too_large'
  | 'empty'
  | 'upload_failed';

const FAILURE_BY_FETCH_REASON: Record<SafeFetchReason, ArchiveFailure> = {
  not_public: 'blocked_host',
  too_large: 'too_large',
  fetch_failed: 'fetch_failed'
};

export type ArchiveResult =
  | { ok: true; media: ArchivedMedia }
  | { ok: false; reason: ArchiveFailure; detail?: string };

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm'
};

/**
 * Stable, collision-free storage key for a post's media.
 *
 * The external id already carries its platform prefix (`threads:abc`), and the directory carries it
 * too, so only the id goes into the filename — otherwise every path reads `threads/threads_threads_…`.
 */
export function mediaPathFor(platform: string, externalId: string, ext: string): string {
  const safe = String(externalId).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `${PREFIX}/${platform}/${safe}.${ext}`;
}

/**
 * Download and store one media file. On failure returns the REASON — dead link, wrong type,
 * oversized, timeout — and the caller records no permanent copy for that post but keeps the reason.
 *
 * `upsert: true` makes re-archiving the same post idempotent, so a re-observation does not create a
 * second copy of a file we already hold.
 */
export async function archiveMarketMedia(
  supabase: SupabaseClient,
  opts: { platform: string; externalId: string; url: string }
): Promise<ArchiveResult> {
  const url = String(opts.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, reason: 'bad_url' };

  // The transfer ceiling is the largest thing we would ever keep; the per-kind cap below is the
  // one that decides, and it can only be applied once the content-type has arrived.
  let res;
  try {
    res = await safeFetchBytes(url, {
      maxBytes: MAX_VIDEO_BYTES,
      timeoutMs: TIMEOUT_MS,
      userAgent: ARCHIVE_USER_AGENT
    });
  } catch (e) {
    if (e instanceof SafeFetchError) {
      return { ok: false, reason: FAILURE_BY_FETCH_REASON[e.reason], detail: e.message.slice(0, 200) };
    }
    return {
      ok: false,
      reason: 'fetch_failed',
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 200)
    };
  }
  if (!res.ok) return { ok: false, reason: 'http_error', detail: String(res.status) };

  const kind: 'image' | 'video' | null = res.mime.startsWith('image/')
    ? 'image'
    : res.mime.startsWith('video/')
      ? 'video'
      : null;
  if (!kind) return { ok: false, reason: 'unsupported_type', detail: res.mime || 'no content-type' };

  const cap = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (!res.bytes.length) return { ok: false, reason: 'empty' };
  if (res.bytes.length > cap) return { ok: false, reason: 'too_large', detail: `${res.bytes.length} > ${cap}` };

  const ext = EXT_BY_MIME[res.mime] ?? (kind === 'video' ? 'mp4' : 'jpg');
  const path = mediaPathFor(opts.platform, opts.externalId, ext);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, res.bytes, { contentType: res.mime, upsert: true });
  if (error) return { ok: false, reason: 'upload_failed', detail: error.message.slice(0, 200) };

  return { ok: true, media: { path, bytes: res.bytes.length, kind } };
}

/** Signed read URLs for archived market media. Same bucket helper the rest of the app uses. */
export async function signMarketMedia(
  supabase: SupabaseClient,
  paths: string[],
  ttlSeconds = 60 * 60 * 2
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const clean = [...new Set(paths.filter(Boolean))];
  if (!clean.length) return out;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(clean, ttlSeconds);
  for (const row of data ?? []) if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  return out;
}
