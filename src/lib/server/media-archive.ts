import type { SupabaseClient } from '@supabase/supabase-js';

// Tiny, dependency-free media archival helpers (deliberately imports nothing from the AI modules,
// so scrapecreators/content-preview/brand-context can all use it without import cycles).
//
// Why this exists: every scraped thumbnail is a SIGNED platform-CDN URL that expires within days.
// Anything that must survive (history thumbs, competitor reference posts) gets downloaded into the
// private brand-knowledge bucket WHILE the link is alive; consumers then sign our copy.

const BUCKET = 'brand-knowledge';
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

// Download an external image and store it at `path` in the brand-knowledge bucket. Returns the
// path on success, null on any failure (dead URL, non-image, oversized) — callers keep the URL
// fallback. Upsert so re-archiving the same key is idempotent.
export async function archiveImageToBucket(
  supabase: SupabaseClient,
  path: string,
  url: string
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AnomaliaArchive/1.0)' }
    });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

// Batch-sign brand-knowledge paths → path→signedUrl map (missing entries simply absent).
export async function signKnowledgePaths(
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
