/**
 * Resolve an ffmpeg binary WITHOUT importing `ffmpeg-static`.
 *
 * Why: `import 'ffmpeg-static'` makes Vercel NFT pack the ~77MB binary into every
 * serverless function that can reach captions/video (the SvelteKit catch-all `![-]`),
 * which pushes the unzipped size over the 250MB limit.
 *
 * Resolution order:
 *   1. FFMPEG_BIN env
 *   2. Local checkout path `node_modules/ffmpeg-static/ffmpeg` (dev / CI with full node_modules)
 *   3. Download the same release ffmpeg-static uses into /tmp (Vercel runtime)
 */
import { createWriteStream, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

const RELEASE = process.env.FFMPEG_BINARY_RELEASE || 'b6.1.1';
const BASE =
  process.env.FFMPEG_BINARIES_URL ||
  'https://github.com/eugeneware/ffmpeg-static/releases/download';

let cached: string | null | undefined;
let downloadPromise: Promise<string | null> | null = null;

function localCheckoutPath(): string | null {
  const platform = process.platform;
  const name = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidate = join(process.cwd(), 'node_modules', 'ffmpeg-static', name);
  return existsSync(candidate) ? candidate : null;
}

function tmpBinPath(): string {
  return join(tmpdir(), `ffmpeg-static-${RELEASE}`);
}

async function downloadToTmp(): Promise<string | null> {
  const dest = tmpBinPath();
  if (existsSync(dest)) return dest;

  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const url = `${BASE}/${RELEASE}/ffmpeg-${platform}-${arch}.gz`;

  try {
    // Cold-start path: this runs inline inside whatever request first needs ffmpeg, so an
    // unbounded download here stalls that caller rather than just the binary fetch.
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    if (!res.ok || !res.body) {
      console.warn(`[ffmpeg-bin] download failed ${res.status} ${url}`);
      return null;
    }
    const partial = `${dest}.partial`;
    await pipeline(Readable.fromWeb(res.body as never), createGunzip(), createWriteStream(partial));
    chmodSync(partial, 0o755);
    // Atomic-ish rename into place
    const { renameSync } = await import('node:fs');
    renameSync(partial, dest);
    return dest;
  } catch (e) {
    console.warn('[ffmpeg-bin] download error:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Sync best-effort (env + local checkout). Prefer ensureFfmpegPath before burning captions. */
export function peekFfmpegPath(): string | null {
  if (process.env.FFMPEG_BIN && existsSync(process.env.FFMPEG_BIN)) return process.env.FFMPEG_BIN;
  return localCheckoutPath();
}

/**
 * Resolve ffmpeg, downloading to /tmp once when not present locally (Vercel).
 *
 * Only a SUCCESS is cached. A failed download used to be cached as `null`, and with Fluid Compute
 * reusing an instance across requests that poisoned it permanently: every later call returned null
 * without retrying, so a single transient network blip turned into "media_extract_failed" for every
 * review that instance handled — including the retries, which is why 3 attempts could all fail.
 */
export async function ensureFfmpegPath(): Promise<string | null> {
  if (cached) return cached;
  const quick = peekFfmpegPath();
  if (quick) {
    cached = quick;
    return quick;
  }
  if (existsSync(tmpBinPath())) {
    cached = tmpBinPath();
    return cached;
  }
  if (!downloadPromise) {
    downloadPromise = downloadToTmp().finally(() => {
      // Let the next caller try again; a resolved-null promise must not be reused.
      downloadPromise = null;
    });
  }
  const path = await downloadPromise;
  if (path) cached = path;
  return path;
}
