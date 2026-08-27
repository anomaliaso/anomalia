/**
 * Collect media URLs for social posts and package them into a ZIP download.
 */
import { swallow } from '$lib/server/swallow';
import { buildZip, safeZipName, type ZipEntry } from '$lib/server/zip';

const MAX_POSTS = 40;
const MAX_BYTES_TOTAL = 180 * 1024 * 1024; // ~180 MB hard cap for serverless

function extFrom(url: string, contentType: string | null): string {
  const path = url.split('?')[0] ?? url;
  const m = path.match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1].toLowerCase();
  if (contentType?.includes('mp4') || contentType?.includes('video')) return 'mp4';
  if (contentType?.includes('webm')) return 'webm';
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (contentType?.includes('gif')) return 'gif';
  return 'jpg';
}

function mediaUrlsFor(post: {
  media_url?: string | null;
  media_urls?: string[] | null;
}): string[] {
  const slides = Array.isArray(post.media_urls)
    ? post.media_urls.filter((u): u is string => typeof u === 'string' && !!u)
    : [];
  if (slides.length) return [...new Set(slides)];
  if (post.media_url) return [post.media_url];
  return [];
}

export async function zipPostMedia(
  posts: Array<{
    id: string;
    platform?: string | null;
    media_url?: string | null;
    media_urls?: string[] | null;
  }>
): Promise<{ zip: Uint8Array; count: number } | { error: string; status: number }> {
  const slice = posts.slice(0, MAX_POSTS);
  if (!slice.length) return { error: 'No posts selected', status: 400 };

  const entries: ZipEntry[] = [];
  let total = 0;
  let fileIdx = 0;

  for (const post of slice) {
    const urls = mediaUrlsFor(post);
    if (!urls.length) continue;
    const plat = safeZipName((post.platform ?? 'post').toLowerCase());
    const folder = `${plat}_${post.id.slice(0, 8)}`;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        total += buf.byteLength;
        if (total > MAX_BYTES_TOTAL) {
          return { error: 'Selection too large to download at once', status: 413 };
        }
        const ct = res.headers.get('content-type');
        const ext = extFrom(url, ct);
        const slide = urls.length > 1 ? `_slide${i + 1}` : '';
        entries.push({
          name: `${folder}/${fileIdx + 1}${slide}.${ext}`,
          data: buf
        });
        fileIdx += 1;
      } catch (error) { swallow('download post asset', error); }
    }
  }

  if (!entries.length) return { error: 'No media found on selected posts', status: 404 };
  return { zip: buildZip(entries), count: entries.length };
}
