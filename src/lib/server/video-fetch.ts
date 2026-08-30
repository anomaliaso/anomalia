/**
 * Clip downloading and ffmpeg-based media preparation, shared by the UGC
 * breakdown, the motion reference wall and whoever else needs raw bytes or
 * labelled frames out of an mp4 — independent of any judging logic.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureFfmpegPath } from '$lib/server/ffmpeg-bin';

const MAX_INLINE_BYTES = 8 * 1024 * 1024;
const MAX_FETCH_BYTES = 128 * 1024 * 1024;
const MAX_REVIEW_SECONDS = 30;
const MAX_RAW_INLINE_MP4 = 18 * 1024 * 1024;

export type VideoFetchResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: 'blocked' | 'not_found' | 'too_large' | 'network'; detail: string };

/**
 * Why the distinction matters: reporting "extract failed" for a clip we were never allowed to
 * download sends everyone chasing the decoder. A bot-protected host (media CDNs commonly fingerprint
 * the TLS handshake, so no header changes it) can be fetched by the user's browser and never by us —
 * the only answer is "upload the file", and the message has to say so.
 */
/** A message the agent can repeat to the user verbatim — each reason has a different way out. */
export function videoFetchError(f: Extract<VideoFetchResult, { ok: false }>): string {
  switch (f.reason) {
    case 'blocked':
      return `media_host_blocked: the host refused the download (${f.detail}). It works in a browser but not from a server — the clip has to be uploaded, not linked.`;
    case 'not_found':
      return `media_not_found: the URL did not return a file (${f.detail}).`;
    case 'too_large':
      return `media_too_large: ${f.detail}.`;
    default:
      return `media_unreachable: ${f.detail}.`;
  }
}

export async function fetchVideoBytesDetailed(url: string): Promise<VideoFetchResult> {
  let res: Response;
  try {
    // Clips are capped at MAX_FETCH_BYTES, so a download that takes longer than this is a stalled
    // connection, not a big file — and it used to be able to hold a whole turn open on its own.
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn('[video-fetch] clip fetch error:', detail);
    return { ok: false, reason: 'network', detail };
  }
  if (!res.ok) {
    console.warn(`[video-fetch] clip fetch failed ${res.status}: ${url}`);
    return {
      ok: false,
      reason: res.status === 403 || res.status === 401 ? 'blocked' : 'not_found',
      detail: `HTTP ${res.status}`
    };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_FETCH_BYTES) {
    const detail = `${(bytes.length / 1e6).toFixed(1)}MB > ${MAX_FETCH_BYTES / 1e6}MB`;
    console.warn(`[video-fetch] clip too large to process: ${detail}`);
    return { ok: false, reason: 'too_large', detail };
  }
  return { ok: true, bytes };
}

export async function fetchVideoBytes(url: string): Promise<Buffer | null> {
  const r = await fetchVideoBytesDetailed(url);
  return r.ok ? r.bytes : null;
}

export type ReviewMedia = {
  duration: number;
  videoMp4?: Buffer;
  frames: Array<{ mimeType: string; data: string; label: string }>;
  audioMp3?: Buffer;
};

function ffRun(bin: string, args: string[]): void {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? '').slice(-300)}`);
}

function probeDuration(bin: string, file: string): number {
  const r = spawnSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const m = (r.stderr ?? '').match(/Duration: (\d+):(\d+):([0-9.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

function extractJpeg(bin: string, src: string, stamp: number, out: string): boolean {
  try {
    ffRun(bin, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      Math.max(0, stamp).toFixed(2),
      '-i',
      src,
      '-frames:v',
      '1',
      '-q:v',
      '4',
      out
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clip length straight from the MP4 `mvhd` atom, for the path where ffmpeg is unavailable.
 * Callers quote the duration to the model, so a 0 here would read as a zero-length clip.
 */
export function mp4DurationSeconds(buf: Buffer): number {
  const i = buf.indexOf('mvhd');
  if (i < 0) return 0;
  try {
    const version = buf.readUInt8(i + 4);
    // after 'mvhd': version(1) flags(3), then created/modified, timescale, duration
    const p = i + 8 + (version === 1 ? 16 : 8);
    const timescale = buf.readUInt32BE(p);
    const units = version === 1 ? Number(buf.readBigUInt64BE(p + 4)) : buf.readUInt32BE(p + 4);
    if (!timescale || !Number.isFinite(units)) return 0;
    return units / timescale;
  } catch {
    return 0;
  }
}

/**
 * Prefer a compact mp4 the model can watch (fps metadata 4) plus hook stills for the
 * sound-off / 500ms test. Fall back to dense stills + mono audio when the clip won't inline.
 * Gemini inlines the clip into the request, so an un-shrunk MP4 is only worth sending when it is
 * small enough to survive that. Above this, no ffmpeg means no media prep.
 */
export async function prepareReviewMedia(mp4: Buffer): Promise<ReviewMedia | null> {
  const ffmpegPath = await ensureFfmpegPath();
  // The caller already hands the model the MP4 itself — the stills are an addition, not the only
  // channel. Losing ffmpeg should cost the labelled timestamps, not the whole preparation.
  if (!ffmpegPath) {
    if (mp4.byteLength > MAX_RAW_INLINE_MP4) return null;
    const duration = mp4DurationSeconds(mp4);
    if (!duration) return null;
    console.warn('[video-fetch] no ffmpeg — preparing the raw clip without extracted stills');
    // Report the REAL length here: the ffmpeg path clamps because it also trims the clip to that
    // length, and this path sends the whole thing. Clamping without trimming would tell the model
    // a 60s clip is 30s and make every timestamp it reasons about wrong.
    return { duration, videoMp4: mp4, frames: [] };
  }
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'vid-prep-'));
    const src = join(dir, 'in.mp4');
    writeFileSync(src, mp4);
    const duration = Math.min(MAX_REVIEW_SECONDS, probeDuration(ffmpegPath, src) || 15);

    const hookStamps = [0.12, 0.45, 1.0, 1.8, 3.0]
      .map((t) => Math.min(t, Math.max(0.05, duration - 0.05)))
      .filter((t, i, a) => i === 0 || t - a[i - 1] > 0.15);
    const bodyStamps = [
      Math.max(0.5, duration * 0.45),
      Math.max(0.8, duration * 0.6),
      Math.max(1, duration - 0.35)
    ].filter((t) => t > 3.1 && t < duration);

    const frames: ReviewMedia['frames'] = [];
    const push = (stamp: number, label: string) => {
      const out = join(dir!, `f${frames.length}.jpg`);
      if (!extractJpeg(ffmpegPath, src, stamp, out)) return;
      frames.push({ mimeType: 'image/jpeg', data: readFileSync(out).toString('base64'), label });
    };
    hookStamps.forEach((t, i) => push(t, `HOOK still ${i + 1} @ ${t.toFixed(2)}s (sound-off / thumb-stop)`));
    bodyStamps.forEach((t) =>
      push(t, t >= duration * 0.55 && t <= duration * 0.65 ? `REVEAL-DEADLINE still @ ${t.toFixed(2)}s` : `BODY still @ ${t.toFixed(2)}s`)
    );

    const compact = join(dir, 'rev.mp4');
    let videoMp4: Buffer | undefined;
    try {
      ffRun(ffmpegPath, [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        src,
        '-t',
        duration.toFixed(2),
        '-vf',
        'scale=-2:min(480\\,ih)',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '32',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        compact
      ]);
      const buf = readFileSync(compact);
      if (buf.length > 0 && buf.length <= MAX_INLINE_BYTES) videoMp4 = buf;
    } catch {
      videoMp4 = undefined;
    }

    let audioMp3: Buffer | undefined;
    if (!videoMp4) {
      const mp3 = join(dir, 'a.mp3');
      try {
        ffRun(ffmpegPath, [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          src,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          '64k',
          '-t',
          duration.toFixed(2),
          mp3
        ]);
        audioMp3 = readFileSync(mp3);
      } catch {
        audioMp3 = undefined;
      }
    }

    if (!frames.length && !videoMp4) return null;
    return { duration, videoMp4, frames, audioMp3 };
  } catch {
    return null;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
