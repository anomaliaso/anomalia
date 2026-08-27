/**
 * Post-generation UGC edit — cut dead space before captions burn.
 *
 * The model often returns a clip that sits silent for a beat at the head and trails off into
 * empty room tone at the end. Real creators cut that. We do the same with ffmpeg silencedetect
 * (same DSP captions.ts already trusts for speech windows), then trim to the speech window with
 * a small pad so the first/last syllable is not clipped.
 *
 * Mid-clip micro-pauses are INTENTIONAL (imperfect-presence craft) — we do NOT collapse them.
 * Only leading / trailing dead space dies here.
 *
 * BEST-EFFORT: any failure returns the original bytes. A slightly long raw clip is better than a
 * failed publish.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureFfmpegPath } from '$lib/server/ffmpeg-bin';
import { speechWindow } from '$lib/server/captions';

const NOISE_FLOOR = '-35dB';
const MIN_PAUSE = 0.4;
/** Keep a little air before the first word / after the last so cuts never feel clipped. */
const PAD_SECONDS = 0.12;
/** Don't bother re-encoding for tiny trims — the gain isn't worth the quality hit. */
const MIN_TRIM_SECONDS = 0.35;
/**
 * Never keep less than this fraction of the source. Quiet phone-mic delivery was falsely detecting
 * mid-sentence "silence" and shipping 3–4s stubs from 15s Seedance takes (speech cut mid-line).
 */
const MIN_KEEP_RATIO = 0.85;

function ffLog(bin: string, args: string[]): string {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return r.stderr ?? '';
}

function probeDuration(bin: string, file: string): number {
  const m = ffLog(bin, ['-hide_banner', '-i', file]).match(/Duration: (\d+):(\d+):([0-9.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

/**
 * Compute the keep-window [start, end] for a clip given its silencedetect log.
 * Pure + exported for tests.
 */
export function deadSpaceWindow(
  log: string,
  duration: number,
  pad = PAD_SECONDS
): { start: number; end: number; trimHead: number; trimTail: number } | null {
  if (!duration || duration < 1) return null;
  const [speechStart, speechEnd] = speechWindow(log, duration);
  const start = Math.max(0, speechStart - pad);
  const end = Math.min(duration, speechEnd + pad);
  const trimHead = start;
  const trimTail = Math.max(0, duration - end);
  if (trimHead < MIN_TRIM_SECONDS && trimTail < MIN_TRIM_SECONDS) return null;
  if (end - start < 1) return null;
  // Guard against false silence mid-delivery — prefer the long raw take over a severed stub.
  if (end - start < duration * MIN_KEEP_RATIO) return null;
  return { start, end, trimHead, trimTail };
}

/**
 * Cut leading/trailing silence from an mp4. Returns original bytes when there is nothing useful
 * to cut, ffmpeg is missing, or any step fails.
 */
export async function tightenDeadSpace(mp4: Buffer): Promise<Buffer<ArrayBufferLike>> {
  const ffmpegPath = await ensureFfmpegPath();
  if (!ffmpegPath) return mp4;
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'ugc-trim-'));
    const src = join(dir, 'in.mp4');
    const out = join(dir, 'out.mp4');
    writeFileSync(src, mp4);

    const duration = probeDuration(ffmpegPath, src);
    if (!duration) return mp4;

    const log = ffLog(ffmpegPath, [
      '-hide_banner',
      '-i',
      src,
      '-af',
      `silencedetect=n=${NOISE_FLOOR}:d=${MIN_PAUSE}`,
      '-f',
      'null',
      '-'
    ]);
    const win = deadSpaceWindow(log, duration);
    if (!win) return mp4;

    // Re-encode both streams so A/V stay locked after the trim. -c copy with -ss can drift.
    const r = spawnSync(
      ffmpegPath,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'in.mp4',
        '-ss',
        win.start.toFixed(3),
        '-to',
        win.end.toFixed(3),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        'out.mp4'
      ],
      { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    if (r.status !== 0) return mp4;
    const trimmed = readFileSync(out);
    return trimmed.length > 1000 ? trimmed : mp4;
  } catch {
    return mp4;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
