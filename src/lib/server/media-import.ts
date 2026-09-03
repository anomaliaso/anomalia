/**
 * Persist a public URL into the brand media library.
 *
 * The URL comes from an external agent, so it is hostile input and the whole surface of this
 * module is the refusal. Everything the guard rejects — a scheme that is not https on ANY hop,
 * a host that resolves into a private network, a redirect that walks into one, a body past its
 * type's ceiling — happens before a byte reaches storage.
 *
 * IMPORTABLE below is the entire policy. A type we cannot publish is a type we do not accept,
 * and a new format is a row here rather than another `if` somewhere downstream.
 *
 * No model runs: the file is copied, not generated, so nothing here spends AI credits. The AI
 * catalog that the browser upload triggers is deliberately left out for the same reason — the
 * operator can ask for it from the library when they want it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertPublicUrl,
  safeFetchBytes,
  SafeFetchError,
  type SafeFetchReason
} from '$lib/server/tool-guard';
import {
  insertBrandMedia,
  probeImageDimensions,
  storeBrandMediaBytes,
  type BrandMediaKind
} from '$lib/server/brand-media';
import { signKnowledgePaths } from '$lib/server/media-archive';

const IMAGE_MAX_BYTES = 12_000_000;
/**
 * Il download è bufferizzato, quindi questo tetto è un vincolo reale sulla memoria della
 * funzione, non una preferenza: una clip social sta sotto, un master no.
 */
const VIDEO_MAX_BYTES = 64_000_000;

const IMPORTABLE: Record<string, { kind: BrandMediaKind; ext: string; maxBytes: number }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg', maxBytes: IMAGE_MAX_BYTES },
  'image/png': { kind: 'image', ext: 'png', maxBytes: IMAGE_MAX_BYTES },
  'image/webp': { kind: 'image', ext: 'webp', maxBytes: IMAGE_MAX_BYTES },
  'image/gif': { kind: 'image', ext: 'gif', maxBytes: IMAGE_MAX_BYTES },
  'video/mp4': { kind: 'video', ext: 'mp4', maxBytes: VIDEO_MAX_BYTES },
  'video/quicktime': { kind: 'video', ext: 'mov', maxBytes: VIDEO_MAX_BYTES },
  'video/webm': { kind: 'video', ext: 'webm', maxBytes: VIDEO_MAX_BYTES }
};

const TRANSFER_CEILING = Math.max(...Object.values(IMPORTABLE).map((t) => t.maxBytes));
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 4;

export type MediaImportFailure =
  | 'not_https'
  | 'blocked_host'
  | 'fetch_failed'
  | 'unsupported_type'
  | 'too_large'
  | 'empty'
  | 'store_failed';

const FAILURE_BY_FETCH_REASON: Record<SafeFetchReason, MediaImportFailure> = {
  not_public: 'blocked_host',
  too_large: 'too_large',
  fetch_failed: 'fetch_failed'
};

export type ImportedMedia = {
  id: string;
  kind: BrandMediaKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  source_url: string;
  signed_url: string | null;
};

export type MediaImportResult =
  | { ok: true; media: ImportedMedia }
  | { ok: false; error: MediaImportFailure };

/**
 * Il gate di ogni hop. `assertPublicUrl` da solo accetterebbe http, e un 302 da https a http
 * consegna il file a chiunque stia sul percorso — quindi lo schema si ricontrolla qui, dove il
 * controllo vale anche per le destinazioni che non abbiamo scelto noi.
 */
async function assertImportableHop(url: URL): Promise<void> {
  if (url.protocol !== 'https:') throw new SafeFetchError('not_public', 'Only https URLs can be imported');
  await assertPublicUrl(url);
}

function failureFor(e: unknown): MediaImportFailure {
  return e instanceof SafeFetchError ? FAILURE_BY_FETCH_REASON[e.reason] : 'fetch_failed';
}

export async function importBrandMediaFromUrl(
  supabase: SupabaseClient,
  opts: { brandId: string; userId: string; url: string; title?: string | null }
): Promise<MediaImportResult> {
  const requested = String(opts.url ?? '').trim();
  if (!/^https:\/\//i.test(requested)) return { ok: false, error: 'not_https' };

  let fetched;
  try {
    fetched = await safeFetchBytes(requested, {
      maxBytes: TRANSFER_CEILING,
      timeoutMs: TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      gate: assertImportableHop
    });
  } catch (e) {
    return { ok: false, error: failureFor(e) };
  }

  if (!fetched.ok) return { ok: false, error: 'fetch_failed' };

  const type = IMPORTABLE[fetched.mime];
  if (!type) return { ok: false, error: 'unsupported_type' };
  if (!fetched.bytes.length) return { ok: false, error: 'empty' };
  if (fetched.bytes.length > type.maxBytes) return { ok: false, error: 'too_large' };

  const fileName = `import-${crypto.randomUUID()}.${type.ext}`;
  const storagePath = `${opts.userId}/${opts.brandId}/media/${fileName}`;

  const stored = await storeBrandMediaBytes(supabase, storagePath, fetched.bytes, fetched.mime);
  if (stored.error) return { ok: false, error: 'store_failed' };

  const { width, height } =
    type.kind === 'image'
      ? await probeImageDimensions(fetched.bytes)
      : { width: null, height: null };

  const { row, error } = await insertBrandMedia(supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    storagePath,
    fileName,
    mime: fetched.mime,
    bytes: fetched.bytes.length,
    width,
    height,
    source: 'agent',
    sourceRef: fetched.url,
    title: opts.title?.trim() || null
  });
  if (error || !row) return { ok: false, error: 'store_failed' };

  const signed = await signKnowledgePaths(supabase, [storagePath]).catch(() => new Map<string, string>());

  return {
    ok: true,
    media: {
      id: row.id,
      kind: type.kind,
      mime: fetched.mime,
      bytes: fetched.bytes.length,
      width,
      height,
      source_url: fetched.url,
      signed_url: signed.get(storagePath) ?? null
    }
  };
}
