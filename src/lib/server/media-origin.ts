import type { SupabaseClient } from '@supabase/supabase-js';
import { isVideoUrl } from '$lib/content-formats';
import type { Graphic } from '$lib/design/blocks';
import { parseGraphicRow, latestGraphic, versionSource, type GraphicVersion } from '$lib/server/design-store';
import type { GraphicSourceKind } from '$lib/design/graphic-source';

/**
 * How a post's visual was produced — what the chat / post-editor AI must know before offering
 * regenerate_image vs design_graphic vs "that's the user's photo".
 *
 * Typographic graphics look like PNGs on the post row (`media_url` + often `content_type:
 * generated_image`). The editable source lives in `graphic_designs.source` (HTML/TSX) or, for
 * older rows, `graphic_designs.spec` (block JSON, projected to HTML on read). Without this
 * classifier the model treats them as AI photos and offers to re-prompt Nano Banana.
 */

export type MediaOrigin =
  | 'typographic_graphic'
  | 'ai_generated'
  | 'user_uploaded'
  | 'video'
  | 'none';

export type GraphicSource = {
  version: number;
  brief: string | null;
  aspect: Graphic['aspect'];
  theme?: Graphic['theme'];
  /** Legacy block JSON when this version was composed that way. */
  spec: Graphic | null;
  source_chars: number;
  source_kind: GraphicSourceKind;
  media_url: string;
  editing_note: string;
};

export type MediaOriginInfo = {
  media_origin: MediaOrigin;
  media_origin_note: string;
  graphic?: GraphicSource;
};

const GRAPHIC_EDITING_NOTE =
  'This visual is a TYPOGRAPHIC graphic (HTML/CSS or React TSX). The full source is NOT in this payload. ' +
  'Patch it with grep_source → read_source (pages of 4000 chars) → replace_source. write_source only to rebuild the structure. ' +
  'High-level restyle without code: design_graphic with a brief. ' +
  'Need a photo inside the graphic? Call read_media first. If a library image fits, use_library_image then replace_source <img src="https://...">. generate_image only when nothing fits (returns image_url, does NOT change the post). Then replace_source. ' +
  'Do NOT call regenerate_image — that would replace the canvas with a photo and lose the source. ' +
  'If the user wants a VIDEO / UGC reel instead of this still, call make_video (script + ugc:true).';

/** Returned when generate_image mints an asset for a graphic without touching the post. */
export const GRAPHIC_ASSET_MINT_HINT =
  'This did NOT change the post. Insert the URL in the graphic HTML/TSX with replace_source, e.g. <img src="URL" width="W" height="H" />. Call generate_image again for more assets. https URLs are inlined at PNG render.';

/** Returned when generate_image mints an asset for a Remotion motion video. */
export const MOTION_ASSET_MINT_HINT =
  'This did NOT change the composition. Nano Banana Pro still — paste the https URL into Remotion TSX with replace_source (Motion page) or replace_motion_source (brand chat): <Img src="URL" />. Use it inside programmatic UI mockups (posts, graphs, textareas, icon wells). Call generate_image again for more assets.';

/** Returned by standalone generate_image (no post written). */
export const STANDALONE_IMAGE_HINT =
  'This did not create or change a post. Use image_url as: markdown ![alt](url); image_urls on create_post(graphic_brief) / design_graphic; replace_source <img src="URL"> on a typographic graphic; or replace_motion_source / replace_source <Img src="URL" /> on a Remotion motion video.';

const VIDEO_EDITING_NOTE =
  'This post is a VIDEO/reel. Remake it with make_video: new spoken script, more natural delivery, no on-screen subtitles. ' +
  'Pass script + ugc:true + prompt ("no on-screen text / no captions"). That keeps the clip a video. ' +
  'NEVER call design_graphic — that deletes the mp4 and replaces it with a static (often blank) graphic. ' +
  'Caption-only edits: set_text. Cover-frame look changes: regenerate_image (re-renders the clip from the stored still).';

function graphicSource(v: GraphicVersion): GraphicSource {
  const source = versionSource(v);
  return {
    version: v.version,
    brief: v.brief,
    aspect: v.aspect,
    theme: v.spec?.theme,
    spec: v.spec,
    source_chars: source.length,
    source_kind: v.sourceKind,
    media_url: v.mediaUrl,
    editing_note: GRAPHIC_EDITING_NOTE
  };
}

export type PostMediaRow = {
  content_type?: string | null;
  image_prompt?: string | null;
  media_url?: string | null;
  media_urls?: unknown;
  format?: string | null;
  video_thumbnail_url?: string | null;
};

/** True when the post currently carries (or is typed as) a video clip. */
export function isVideoPostRow(row: {
  content_type?: string | null;
  format?: string | null;
  media_url?: string | null;
}): boolean {
  const ct = String(row.content_type ?? '').toLowerCase();
  if (ct === 'generated_video' || ct === 'uploaded_video' || ct.includes('video')) return true;
  const format = String(row.format ?? '').toLowerCase();
  if (format === 'video' || format === 'reel') return true;
  return isVideoUrl(row.media_url);
}

/** Image URL usable as an image-to-video first frame. Mp4/mov/webm are rejected. */
export function stillCoverUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  return isVideoUrl(url) ? null : url;
}

/**
 * Cover still for remaking a clip: the post's image when it is still a photo, otherwise the
 * stored `video_thumbnail_url`. Never returns the mp4 itself (image models / I2V reject it).
 */
export function resolvePostVideoCover(row: {
  media_url?: string | null;
  video_thumbnail_url?: string | null;
}): string | null {
  return stillCoverUrl(row.media_url) ?? stillCoverUrl(row.video_thumbnail_url);
}

function originFromRow(row: PostMediaRow, graphic: GraphicVersion | null): MediaOriginInfo {
  // A leftover graphic_designs row must not outrank a real clip — that is how the editor used
  // to offer design_graphic on a UGC reel and wipe the video.
  if (isVideoPostRow(row)) {
    return {
      media_origin: 'video',
      media_origin_note: VIDEO_EDITING_NOTE
    };
  }

  if (graphic) {
    return {
      media_origin: 'typographic_graphic',
      media_origin_note: GRAPHIC_EDITING_NOTE,
      graphic: graphicSource(graphic)
    };
  }

  const ct = String(row.content_type ?? '');
  if (ct === 'generated_graphic') {
    return {
      media_origin: 'typographic_graphic',
      media_origin_note: GRAPHIC_EDITING_NOTE
    };
  }
  if (ct.startsWith('uploaded')) {
    return {
      media_origin: 'user_uploaded',
      media_origin_note:
        'This visual is a user-uploaded / Media-library asset (pixel-perfect). Prefer keeping it; ' +
        'only regenerate or composite when the user asks to change the photo itself.'
    };
  }
  if (!row.media_url && !(Array.isArray(row.media_urls) && row.media_urls.length)) {
    return {
      media_origin: 'none',
      media_origin_note: 'This post has no visual yet.'
    };
  }
  return {
    media_origin: 'ai_generated',
    media_origin_note:
      'This visual is an AI-generated photo (image model). Edit it with regenerate_image / generate_image ' +
      'using a new instruction or prompt — there is no typographic block spec to revise.'
  };
}

/** Classify one post cover (or a carousel slide when slideIndex is set). */
export async function resolveMediaOrigin(
  supabase: SupabaseClient,
  postId: string,
  row: PostMediaRow,
  slideIndex?: number | null
): Promise<MediaOriginInfo> {
  const graphic = await latestGraphic(supabase, {
    kind: 'post',
    id: postId,
    slideIndex: slideIndex ?? null
  });
  return originFromRow(row, graphic);
}

/**
 * Latest graphic version per post id (cover only — slide_index IS NULL).
 * Used to annotate read_posts without N+1 queries.
 */
export async function latestGraphicsByPostIds(
  supabase: SupabaseClient,
  postIds: string[]
): Promise<Map<string, GraphicVersion>> {
  const out = new Map<string, GraphicVersion>();
  if (!postIds.length) return out;

  const { data, error } = await supabase
    .from('graphic_designs')
    .select('id, version, spec, source, media_url, brief, created_at, target_id')
    .eq('target_kind', 'post')
    .in('target_id', postIds)
    .is('slide_index', null)
    .order('version', { ascending: false });

  const rows =
    error && /source/i.test(error.message)
      ? (
          await supabase
            .from('graphic_designs')
            .select('id, version, spec, media_url, brief, created_at, target_id')
            .eq('target_kind', 'post')
            .in('target_id', postIds)
            .is('slide_index', null)
            .order('version', { ascending: false })
        ).data
      : data;

  for (const row of rows ?? []) {
    const id = String((row as { target_id: string }).target_id);
    if (out.has(id)) continue;
    const parsed = parseGraphicRow(row as Record<string, unknown>);
    if (parsed) out.set(id, parsed);
  }
  return out;
}

/** Annotate a post row for chat tools (read_posts / read_post). */
export function annotatePostMedia(row: PostMediaRow, graphic: GraphicVersion | null): MediaOriginInfo {
  return originFromRow(row, graphic);
}
