import { rasterFileToJpegDataUrl } from '$lib/raster-image-client';

/** Downscale an image file to a JPEG data URL (max 1024px) for chat attachments. */
export function downscaleImageFile(file: File, maxEdge = 1024, quality = 0.82): Promise<string> {
  return rasterFileToJpegDataUrl(file, maxEdge, quality);
}

export type ChatAttachmentPick = {
  kind: 'brand' | 'thumb' | 'person' | 'talent';
  id: string;
  /** Cover thumb for the picker / strip chip */
  url: string;
  /** All photos for this person/talent (shown in strip, resolved again server-side) */
  urls?: string[];
  label?: string;
};

export type ChatAttachmentsPayload = {
  uploads: string[];
  brandImageIds: string[];
  postThumbIds: string[];
  peopleIds: string[];
  talentIds: string[];
};

export function buildAttachmentsPayload(
  uploads: string[],
  picks: ChatAttachmentPick[]
): ChatAttachmentsPayload | undefined {
  const brandImageIds = picks.filter((p) => p.kind === 'brand').map((p) => p.id);
  const postThumbIds = picks.filter((p) => p.kind === 'thumb').map((p) => p.id);
  const peopleIds = picks.filter((p) => p.kind === 'person').map((p) => p.id);
  const talentIds = picks.filter((p) => p.kind === 'talent').map((p) => p.id);
  if (
    !uploads.length &&
    !brandImageIds.length &&
    !postThumbIds.length &&
    !peopleIds.length &&
    !talentIds.length
  ) {
    return undefined;
  }
  return { uploads, brandImageIds, postThumbIds, peopleIds, talentIds };
}

/** Flatten picks into preview thumbs — entity picks expand to every photo. */
export function previewThumbs(
  uploads: string[],
  picks: ChatAttachmentPick[]
): Array<{ key: string; url: string; pickIndex?: number; uploadIndex?: number }> {
  const out: Array<{ key: string; url: string; pickIndex?: number; uploadIndex?: number }> = [];
  uploads.forEach((url, uploadIndex) => {
    out.push({ key: `up-${uploadIndex}`, url, uploadIndex });
  });
  picks.forEach((p, pickIndex) => {
    const urls = p.urls?.length ? p.urls : [p.url];
    urls.forEach((url, i) => {
      out.push({ key: `${p.kind}-${p.id}-${i}`, url, pickIndex });
    });
  });
  return out;
}

/** Reference clips an agent can watch. Kept in step with `EXTS` in /app/[brand]/upload-url. */
export const CHAT_VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';
/**
 * The provider downloads the clip and inlines it as base64, which inflates it by ~4/3, and Gemini's
 * request ceiling is ~20MB. 13MB raw ≈ 17MB encoded, which leaves room for the rest of the turn.
 */
export const MAX_CHAT_VIDEO_BYTES = 13 * 1024 * 1024;

/**
 * Deliberately the same set the upload endpoint signs (mp4/mov/webm). Accepting every `video/*`
 * only bought a 400 and a generic "Upload failed" for .avi and .mkv.
 */
export function isChatVideoFile(file: File): boolean {
  return /^video\/(mp4|quicktime|webm)$/i.test(file.type) || /\.(mp4|mov|webm)$/i.test(file.name);
}

/**
 * Put a reference clip in Storage and return its public URL — the form every agent already
 * understands, since a media URL on a user turn is attached as a real content part.
 */
export async function uploadChatVideo(file: File, brandSlug: string): Promise<string> {
  if (file.size > MAX_CHAT_VIDEO_BYTES) throw new Error('video_too_large');
  const ext = (file.name.split('.').pop() ?? 'mp4').toLowerCase();
  const res = await fetch(`/app/${brandSlug}/upload-url?ext=${encodeURIComponent(ext)}`);
  if (!res.ok) throw new Error('sign_failed');
  const sign = (await res.json()) as {
    uploadPath: string;
    uploadToken: string;
    contentType: string;
    publicUrl: string;
  };
  const { createSupabaseBrowserClient } = await import('$lib/supabase/client');
  const { error } = await createSupabaseBrowserClient()
    .storage.from('media')
    .uploadToSignedUrl(sign.uploadPath, sign.uploadToken, file, { contentType: sign.contentType });
  if (error) throw new Error(error.message);
  return sign.publicUrl;
}
