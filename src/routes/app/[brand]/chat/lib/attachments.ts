import { env as publicEnv } from '$env/dynamic/public';
import { isOwnStorageUrl as isOwnStorage } from '$lib/storage-url';
import { signKnowledgePaths } from '$lib/server/media-archive';
import { signPersonImages, type PersonImage } from '$lib/server/people';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Copy this turn's attachments into the public media bucket and return their durable URLs.
 * Uploads arrive as data: URLs (too big to keep in a text column) and library picks as signed URLs
 * (they expire) — neither survives in the thread as-is. Best-effort: an image that fails to copy is
 * simply dropped, the turn still goes through.
 */
export async function persistChatAttachments(
  supabase: SupabaseClient,
  userId: string,
  urls: string[]
): Promise<string[]> {
  const out: string[] = [];
  for (const url of urls.slice(0, 8)) {
    try {
      let bytes: ArrayBuffer | Uint8Array;
      let contentType = 'image/jpeg';
      if (url.startsWith('data:')) {
        const comma = url.indexOf(',');
        contentType = url.slice(5, url.indexOf(';')) || contentType;
        bytes = Buffer.from(url.slice(comma + 1), 'base64');
      } else if (isOwnStorage(url, publicEnv.PUBLIC_SUPABASE_URL)) {
        out.push(url); // already durable in our bucket — re-uploading a clip buys nothing
        continue;
      } else {
        const res = await fetch(url);
        if (!res.ok) continue;
        contentType = res.headers.get('content-type') || contentType;
        bytes = await res.arrayBuffer();
      }
      const ext = (contentType.split('/')[1] ?? 'jpg').split('+')[0].slice(0, 4);
      const path = `${userId}/chat/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from('media').upload(path, bytes, { contentType, upsert: false });
      if (up.error) continue;
      out.push(supabase.storage.from('media').getPublicUrl(path).data.publicUrl);
    } catch {
      /* skip this image, keep the turn */
    }
  }
  return out;
}

export async function resolveChatAttachments(
  supabase: SupabaseClient,
  brandId: string,
  raw: unknown
): Promise<string[]> {
  const att = (raw ?? {}) as {
    uploads?: unknown;
    brandImageIds?: unknown;
    postThumbIds?: unknown;
    peopleIds?: unknown;
    talentIds?: unknown;
  };
  const asIds = (v: unknown) =>
    Array.isArray(v) ? (v as unknown[]).filter((s): s is string => typeof s === 'string' && !!s).slice(0, 4) : [];
  // Images arrive inline as data URLs; a clip is too big for a request body, so it is uploaded to
  // Storage first and arrives as its public URL. Only OUR bucket is accepted: this value is both
  // handed to the model and fetched server-side, so an arbitrary https URL here would be an SSRF
  // that republishes the response into a public bucket.
  const uploads = Array.isArray(att.uploads)
    ? (att.uploads as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .filter((s) => s.startsWith('data:image/') || isOwnStorage(s, publicEnv.PUBLIC_SUPABASE_URL))
        .slice(0, 4)
    : [];
  const refUrls: string[] = [...uploads];

  const brandImageIds = asIds(att.brandImageIds);
  if (brandImageIds.length) {
    const { resolveBrandImageIds } = await import('$lib/server/brand-media');
    refUrls.push(...(await resolveBrandImageIds(supabase, brandId, brandImageIds)));
  }

  const postThumbIds = asIds(att.postThumbIds);
  if (postThumbIds.length) {
    const { data } = await supabase
      .from('social_post_history')
      .select('thumbnail_path, thumbnail_url')
      .in('id', postThumbIds)
      .eq('brand_id', brandId);
    const paths = (data ?? []).map((h) => String(h.thumbnail_path ?? '')).filter(Boolean);
    const m = await signKnowledgePaths(supabase, paths);
    for (const h of data ?? []) {
      const u =
        (h.thumbnail_path ? m.get(String(h.thumbnail_path)) : null) ??
        (h.thumbnail_url ? String(h.thumbnail_url) : null);
      if (u) refUrls.push(u);
    }
  }

  // Brand people — every reference photo
  const peopleIds = asIds(att.peopleIds);
  if (peopleIds.length) {
    const { data } = await supabase
      .from('people')
      .select('id, images')
      .in('id', peopleIds)
      .eq('brand_id', brandId);
    for (const row of data ?? []) {
      const urls = await signPersonImages(supabase, (row.images ?? []) as PersonImage[]);
      refUrls.push(...urls);
    }
  }

  // Global AI talents (/talents) — every signed view
  const talentIds = asIds(att.talentIds);
  if (talentIds.length) {
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { listTalents } = await import('$lib/server/talent');
    const admin = createAdminClient();
    const all = await listTalents(admin).catch(() => []);
    const idSet = new Set(talentIds);
    for (const t of all) {
      if (!idSet.has(t.id) && !idSet.has(t.slug)) continue;
      for (const v of t.views) {
        if (v.url) refUrls.push(v.url);
      }
    }
  }

  // Cap multimodal payload size (device uploads + library + people/talent albums)
  return refUrls.slice(0, 16);
}
