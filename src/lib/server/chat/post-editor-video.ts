import { isVideoUrl } from '$lib/content-formats';
import { isVideoPostRow, resolvePostVideoCover } from '$lib/server/media-origin';

/**
 * Routing for the per-post editor's make_video / design_graphic tools.
 *
 * The failure mode this encodes: user asks to remake a UGC reel (new spoken script, no
 * on-screen subtitles) → model calls make_video → make_video used to reject because media_url
 * is the mp4 → error said "render its image first" → model called design_graphic → video gone,
 * blank canvas. These helpers pick a remake source and refuse converting a reel into a graphic
 * unless the user explicitly asked for that.
 */

export const DESIGN_GRAPHIC_ON_VIDEO_MESSAGE =
  'This post is a VIDEO/reel. design_graphic would DELETE the clip and replace it with a static graphic ' +
  '(often a blank canvas when the brief is "remove text/subtitles"). ' +
  'To remake the reel — new spoken script, more natural delivery, no on-screen subtitles — call make_video ' +
  'with script, ugc:true, and prompt saying no on-screen text. ' +
  'To change only the caption, call set_text. ' +
  'Pass convert_from_video:true ONLY if the user explicitly asked to turn this reel into a still graphic.';

export const MAKE_VIDEO_NO_SOURCE_MESSAGE =
  'There is no still cover, stored video, or prompt to remake from. Do NOT call design_graphic — ' +
  'that would replace the post with a static graphic. Pass a spoken script and a creative prompt ' +
  '(ugc:true for talking UGC) so make_video can render a new clip.';

const FALLBACK_PROMPT =
  'Photorealistic talking-head social clip. Keep the same person, wardrobe and location as any attached cover or reference video. No on-screen text, titles, subtitles or captions.';

export type MakeVideoRow = {
  content_type?: string | null;
  format?: string | null;
  media_url?: string | null;
  video_thumbnail_url?: string | null;
  image_prompt?: string | null;
};

export type MakeVideoArgs = {
  prompt?: string | null;
  script?: string | null;
  ugc?: boolean;
};

export type MakeVideoSource =
  | {
      ok: true;
      remake: boolean;
      cover: string | null;
      referenceVideoUrl: string | null;
      imagePrompt: string;
    }
  | { ok: false; error: 'no_source'; message: string };

export function isTypographicGraphicPost(row: { content_type?: string | null }): boolean {
  return String(row.content_type ?? '') === 'generated_graphic';
}

export function designGraphicVideoBlock(
  row: MakeVideoRow,
  convertFromVideo?: boolean
): { error: 'is_video'; message: string; action: 'make_video' } | null {
  if (!isVideoPostRow(row)) return null;
  if (convertFromVideo) return null;
  return { error: 'is_video', message: DESIGN_GRAPHIC_ON_VIDEO_MESSAGE, action: 'make_video' };
}

export function resolveMakeVideoSource(row: MakeVideoRow, args: MakeVideoArgs = {}): MakeVideoSource {
  const remake = isVideoPostRow(row);
  const wantsTalkingUgc = args.ugc === true || !!args.script?.trim();
  // A mistaken design_graphic turn leaves a word-canvas PNG. Animating that "cover" produces a
  // blank motion graphic — skip it when the user asked for a talking UGC remake.
  const skipGraphicCover = isTypographicGraphicPost(row) && wantsTalkingUgc;
  const cover = skipGraphicCover ? null : resolvePostVideoCover(row);
  const referenceVideoUrl = remake && isVideoUrl(row.media_url) && !cover ? String(row.media_url) : null;
  const imagePrompt =
    (typeof row.image_prompt === 'string' && row.image_prompt.trim()) ||
    args.prompt?.trim() ||
    (args.script?.trim() ? FALLBACK_PROMPT : '');

  if (!cover && !referenceVideoUrl && !imagePrompt) {
    return { ok: false, error: 'no_source', message: MAKE_VIDEO_NO_SOURCE_MESSAGE };
  }

  return {
    ok: true,
    remake,
    cover,
    referenceVideoUrl,
    imagePrompt: imagePrompt || FALLBACK_PROMPT
  };
}
