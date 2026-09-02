import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EDITOR_POST_COLS, requireZernioCancellation } from '$lib/server/post-editing';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { regeneratePost, loadBrandMoodImageUrls } from '$lib/server/content-preview';
import { GRAPHIC_ASSET_MINT_HINT, isVideoPostRow } from '$lib/server/media-origin';
import { mintStandaloneImage } from '$lib/server/mint-standalone-image';
import { VIDEO_BRIEF_MAX_CHARS } from '$lib/video-models';
import { designGraphicVideoBlock, resolveMakeVideoSource } from '$lib/server/chat/post-editor-video';
import { resolveTypography } from '$lib/design/typography';
import {
  GRAPHIC_SOURCE_MAX_CHARS,
  formatGraphicEditorSystemSuffix,
  unwrapGraphicSource
} from '$lib/design/graphic-source';
import { createGraphicSourceEditTools, compactGraphicPersist } from '$lib/server/chat/graphic-source-edit';
import { createMediaLibraryTools } from '$lib/server/chat/media-library-tools';
import { noteRead, requireFreshRead } from '$lib/server/chat/read-guards';
import type { RenderedGraphic } from '$lib/server/design-render';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// Static per-brand context the render tools need to keep a regenerated image on-brand.
// Loaded once by the endpoint; mood/product images are resolved lazily (only when a render
// actually happens) so pure text edits stay free.
export type EditorContext = {
  visualStyle: string | null;
  brandColors: string[] | null;
  brandFonts: string[] | null;
  /** Chosen graphic typography + art direction (brand_kit.graphic_style), already resolved. */
  typography: import('$lib/design/typography').ResolvedTypography;
  /** Official marks from brand_kit — prepended into graphic AVAILABLE IMAGES as brand logo / favicon. */
  logos: unknown;
  faviconUrl: string | null;
  language: string | null;
  platformInstructions: Record<string, string> | null;
  platformHashtags: Record<string, string[]> | null;
  /** Settings → Video, so an edit re-renders a clip at the brand's own length and direction. */
  videoDuration: number | null;
  videoResolution: string | null;
  videoInstructions: string | null;
  /** Settings → Video model override (kie id). Null = platform env default. */
  videoModel: string | null;
};

/** Everything an edit op needs to touch one post. Built once per request by the caller. */
export type EditorTarget = {
  supabase: SupabaseClient;
  brandId: string;
  postId: string;
  tz: string;
  userId: string;
  ctx: EditorContext;
  /** Assets the user attached to this request, fed to renders as references. */
  refUrls: string[];
  /**
   * The editor conversation, when there is one. Deferred clip renders report back into it, so
   * without this the tool promises "I'll tell you when it lands" and nothing ever does.
   */
  threadId?: string | null;
};

/** Read the brand's visual context once — shared by the chat editor and the CLI media endpoint. */
export async function loadEditorContext(supabase: SupabaseClient, brandId: string): Promise<EditorContext> {
  const [{ data: kit }, { data: brand }] = await Promise.all([
    supabase
      .from('brand_kit')
      .select('visual_style, brand_colors, fonts, graphic_style, logos, favicon_url')
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase.from('brands').select('content_prefs').eq('id', brandId).maybeSingle()
  ]);
  const prefs = (brand?.content_prefs as AnyRec) ?? {};
  return {
    visualStyle: kit?.visual_style ?? null,
    brandColors: Array.isArray(kit?.brand_colors) ? (kit.brand_colors as string[]) : null,
    brandFonts: Array.isArray(kit?.fonts) ? (kit.fonts as AnyRec[]).map((f) => f?.name).filter(Boolean) : null,
    typography: resolveTypography(kit),
    logos: kit?.logos ?? [],
    faviconUrl: typeof kit?.favicon_url === 'string' ? kit.favicon_url : null,
    language: (prefs?.language as string) ?? null,
    platformInstructions: (prefs?.platformInstructions as Record<string, string>) ?? null,
    platformHashtags: (prefs?.platformHashtags as Record<string, string[]>) ?? null,
    videoDuration: typeof prefs?.videoDuration === 'number' ? prefs.videoDuration : null,
    videoResolution: typeof prefs?.videoResolution === 'string' ? prefs.videoResolution : null,
    videoInstructions: (prefs?.videoInstructions as string) ?? null,
    videoModel: typeof prefs?.videoModel === 'string' ? prefs.videoModel : null
  };
}

/**
 * An edit landing on an ALREADY-SCHEDULED post must be pushed to Zernio, or the copy that
 * actually goes out keeps the pre-edit content. Every edit path has to call this.
 */
export async function reschedIfNeeded(supabase: SupabaseClient, brandId: string, postId: string, tz: string) {
  const { data: cur } = await supabase.from('posts').select('status').eq('id', postId).eq('brand_id', brandId).maybeSingle();
  if (cur?.status !== 'scheduled') return;
  await requireZernioCancellation(supabase, postId);
  const { data: updated } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', postId).maybeSingle();
  if (updated) {
    try {
      await publishApprovedPost(supabase, updated as ApprovablePost, tz);
    } catch {
      /* best-effort re-sync; the edit itself already persisted */
    }
  }
}

async function loadProductImages(supabase: SupabaseClient, brandId: string, productName: string | null): Promise<string[]> {
  if (!productName) return [];
  const { data } = await supabase.from('products').select('images').eq('brand_id', brandId).eq('title', productName).maybeSingle();
  return Array.isArray(data?.images) ? data.images.map(String).filter(Boolean) : [];
}

// ── Edit operations ───────────────────────────────────────────────────────────
// Plain functions, no model involved: the chat tools below and the CLI media endpoint
// both call these, so an edit behaves identically wherever it comes from.

const POST_STATE_COLS =
  'id, platform, platforms, caption, title, first_comment, link_url, subreddit, image_prompt, image_prompts, media_url, media_urls, content_type, format, product_name, status, video_thumbnail_url, youtube_thumbnail_url, updated_at';

async function readRow(t: EditorTarget): Promise<AnyRec | null> {
  const { data } = await t.supabase
    .from('posts').select(POST_STATE_COLS)
    .eq('id', t.postId).eq('brand_id', t.brandId).maybeSingle();
  return (data as AnyRec) ?? null;
}

/** Dopo una scrittura riuscita il receipt si allinea al nuovo stato, o la patch successiva si bloccherebbe da sola. */
export async function refreshPostReceipt(supabase: EditorTarget['supabase'], brandId: string, postId: string) {
  const { data } = await supabase.from('posts').select('updated_at').eq('id', postId).maybeSingle();
  if (data) noteRead('post', postId, data.updated_at);
}

const isTextOnly = (row: AnyRec) => row.content_type === 'text' || row.content_type === 'link';

async function renderOne(t: EditorTarget, row: AnyRec, feedback: string, baseImageUrl: string | null, currentPrompt: string | null) {
  const moodImageUrls = await loadBrandMoodImageUrls(t.supabase, t.brandId);
  const productImageUrls = await loadProductImages(t.supabase, t.brandId, row.product_name ?? null);
  return regeneratePost({
    supabase: t.supabase,
    userId: t.userId,
    brandId: t.brandId,
    platform: row.platform ?? null,
    caption: row.caption ?? null,
    imagePrompt: currentPrompt,
    feedback,
    textOnly: false,
    baseImageUrl,
    visualStyle: t.ctx.visualStyle,
    brandColors: t.ctx.brandColors,
    brandFonts: t.ctx.brandFonts,
    productName: row.product_name ?? undefined,
    productImageUrls,
    moodImageUrls,
    userReferenceImageUrls: t.refUrls.slice(0, 4),
    language: t.ctx.language,
    platformInstructions: t.ctx.platformInstructions,
    platformHashtags: t.ctx.platformHashtags
  });
}

/** Compact state of the post: what it is, and — for carousels — every slide. */
export async function readPostState(t: EditorTarget) {
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };
  noteRead('post', t.postId, row.updated_at);
  const { resolveMediaOrigin, annotatePostMedia } = await import('$lib/server/media-origin');
  const { latestGraphic } = await import('$lib/server/design-store');

  const isCarousel = Array.isArray(row.media_urls) && row.media_urls.length > 1;
  let slides: AnyRec[] | null = null;
  if (isCarousel) {
    slides = [];
    for (let i = 0; i < row.media_urls.length; i++) {
      const g = await latestGraphic(t.supabase, { kind: 'post', id: t.postId, slideIndex: i });
      const origin = annotatePostMedia(
        { content_type: row.content_type, image_prompt: row.image_prompts?.[i] ?? null, media_url: row.media_urls[i] },
        g
      );
      slides.push({
        index: i,
        image_prompt: row.image_prompts?.[i] ?? null,
        has_image: !!row.media_urls[i],
        url: row.media_urls[i],
        ...origin
      });
    }
  }

  const coverOrigin = await resolveMediaOrigin(t.supabase, t.postId, row);

  return {
    content_type: row.content_type,
    format: row.format,
    platform: row.platform,
    platforms: row.platforms,
    caption: row.caption,
    title: row.title,
    first_comment: row.first_comment,
    link_url: row.link_url,
    subreddit: row.subreddit,
    media_url: row.media_url,
    youtube_thumbnail_url: row.youtube_thumbnail_url ?? null,
    // For a video post media_url is the mp4. The cover it was animated from is the editable
    // surface — surface it so the assistant knows a visual change starts from an existing frame
    // and does not offer to "replace the image".
    ...(isVideoPostRow(row)
      ? {
          is_video: true,
          video_thumbnail_url: row.video_thumbnail_url ?? null,
          video_editing_note: row.video_thumbnail_url
            ? 'THIS IS A VIDEO. Remake spoken script / remove subtitles / UGC → make_video (script + ugc:true + prompt "no on-screen text"). NEVER design_graphic — that deletes the reel. Cover-frame look changes → regenerate_image, which re-renders the clip.'
            : 'THIS IS A VIDEO with no stored cover still. Remake via make_video with script + ugc:true (uses the existing clip as reference). NEVER design_graphic.'
        }
      : {}),
    image_prompt: slides ? undefined : row.image_prompt,
    is_carousel: !!slides,
    slide_count: slides ? slides.length : row.media_url ? 1 : 0,
    slides,
    status: row.status,
    text_only: isTextOnly(row),
    ...coverOrigin
  };
}

/** Literal text write — no model round-trip, no render. Refused on a post not read, or changed since. */
export async function setPostText(t: EditorTarget, patch: Record<string, unknown>) {
  const clean: AnyRec = {};
  for (const [k, v] of Object.entries(patch)) if (typeof v === 'string') clean[k] = v;
  if (!Object.keys(clean).length) return { error: 'No text provided' };
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };
  const stale = requireFreshRead('post', t.postId, row.updated_at, 'This post', 'read_post');
  if (stale) return stale;
  const { error } = await t.supabase.from('posts').update(clean).eq('id', t.postId).eq('brand_id', t.brandId);
  if (error) return { error: error.message };
  await reschedIfNeeded(t.supabase, t.brandId, t.postId, t.tz);
  await refreshPostReceipt(t.supabase, t.brandId, t.postId);
  return { success: true, updated: Object.keys(clean) };
}

async function applyYoutubeThumbnail(
  t: EditorTarget,
  args: { action: 'generate' | 'set' | 'clear'; brief?: string; image_url?: string }
) {
  const { persistYoutubeThumbnail, copyImageAsYoutubeThumbnail, generateYoutubeThumbnail } = await import(
    '$lib/server/youtube-thumbnail'
  );
  const { youtubeTitleFrom } = await import('$lib/platform-limits');
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };

  const save = async (url: string | null) => {
    const r = await persistYoutubeThumbnail(t.supabase, { postId: t.postId, brandId: t.brandId, url });
    if (r.error) return { error: r.error };
    await reschedIfNeeded(t.supabase, t.brandId, t.postId, t.tz);
    return { success: true, youtube_thumbnail_url: url };
  };

  if (args.action === 'clear') return save(null);

  if (args.action === 'set') {
    const src = String(args.image_url ?? '').trim();
    if (!src) return { error: 'image_url is required for action=set' };
    const url = await copyImageAsYoutubeThumbnail(t.supabase, t.userId, src);
    if (!url) return { error: 'Could not copy that image as a YouTube thumbnail' };
    return save(url);
  }

  const { remaining } = await import('$lib/server/usage');
  const { data: brand } = await t.supabase
    .from('brands')
    .select('plan')
    .eq('id', t.brandId)
    .maybeSingle();
  const budget = await remaining(t.supabase, t.brandId, brand?.plan as string | null, t.tz);
  const { gateToolCall } = await import('$lib/server/chat/tool-policy');
  const gate = gateToolCall('youtube_thumbnail', budget);
  if (gate) return gate;

  const cover = typeof row.video_thumbnail_url === 'string' ? row.video_thumbnail_url : '';
  const gen = await generateYoutubeThumbnail({
    supabase: t.supabase,
    userId: t.userId,
    brandId: t.brandId,
    title: youtubeTitleFrom(row.caption, row.title),
    caption: row.caption,
    brief: args.brief,
    referenceUrls: cover ? [cover] : t.refUrls.slice(0, 4)
  });
  if (!gen.imageUrl) return { error: gen.error ?? 'generate_failed' };
  return save(gen.imageUrl);
}

/**
 * Mint a Nano Banana Pro still as a reusable https URL. Never writes the post —
 * the caller puts the URL into graphic HTML/TSX via replace_source.
 */
export async function mintStandaloneGraphicAsset(
  t: EditorTarget,
  args: {
    prompt: string;
    aspect_ratio?: '1:1' | '4:5' | '9:16' | '16:9';
    media_ids?: string[];
    people_ids?: string[];
    talent_ids?: string[];
  }
) {
  return mintStandaloneImage({
    supabase: t.supabase,
    userId: t.userId,
    brandId: t.brandId,
    tz: t.tz,
    prompt: args.prompt,
    aspect_ratio: args.aspect_ratio,
    media_ids: args.media_ids,
    people_ids: args.people_ids,
    talent_ids: args.talent_ids,
    referenceUrls: t.refUrls,
    hint: GRAPHIC_ASSET_MINT_HINT
  });
}

/** Refine the image of a SINGLE-image post in place. Bills one render. */
export async function regeneratePostImage(t: EditorTarget, args: { instruction: string; new_prompt?: string }) {
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };
  if (isTextOnly(row)) return { error: 'This is a text/link post — there is no image to edit.' };
  if (Array.isArray(row.media_urls) && row.media_urls.length > 1) return { error: 'This is a carousel — edit a specific slide instead.' };

  // Video posts win over a leftover graphic_designs row. Checking the graphic first used to
  // redirect cover edits to design_graphic, which then wiped the reel.
  const isVideo = isVideoPostRow(row);
  if (!isVideo) {
    const { latestGraphic, versionSource } = await import('$lib/server/design-store');
    const graphic = await latestGraphic(t.supabase, { kind: 'post', id: t.postId });
    if (graphic) {
      return {
        error: 'typographic_graphic',
        message:
          'This post visual is a typographic graphic with editable HTML/TSX source — not an AI photo. Call generate_image to mint photo assets (returns image_url, does not change the post), then replace_source to put <img src="https://..."> in the HTML/TSX. Or grep_source → replace_source / design_graphic for layout and copy.',
        action: 'replace_source',
        graphic_version: graphic.version,
        source_chars: versionSource(graphic).length,
        graphic_spec: graphic.spec
      };
    }
  }

  // VIDEO POSTS edit their COVER, then re-render the clip from it.
  //
  // Two things used to go wrong here, both silently. media_url on a video post is the .mp4, so
  // feeding it as the "base image" handed an mp4 to an image model; and writing the result back to
  // media_url replaced the clip with a still while stamping content_type 'generated_image' — the
  // video was simply gone. The stored cover (video_thumbnail_url) is the correct starting point:
  // it keeps the person, room and framing, so an edit is a variation on the same clip rather than
  // a new one from scratch.
  if (isVideo) {
    const cover = row.video_thumbnail_url ?? null;
    if (!cover) {
      return {
        error:
          'This video has no stored cover frame, so its look cannot be reused as a starting point. Generate a new video post instead.'
      };
    }
    const r = await renderOne(t, row, args.instruction, cover, args.new_prompt ?? row.image_prompt ?? null);
    if (!r.imageUrl) return { error: 'Cover re-render failed. The post is unchanged.' };

    const { ugcSpokenLine } = await import('$lib/server/ugc');
    const { submitAndTrackVideoRender } = await import('$lib/server/video-render-queue');
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    // Submitted, not awaited: kie holds the job and the reconciler attaches the clip. Waiting here
    // blocked the editor for minutes on a re-render the user was not watching frame by frame.
    // Re-render from the new cover without forcing the hardcoded UGC genre template — keep the
    // brand's Settings direction and let cinematic/talking defaults apply unless prefs say otherwise.
    const clip = await submitAndTrackVideoRender({
      admin: createAdminClient(),
      brandId: t.brandId,
      userId: t.userId,
      postId: t.postId,
      threadId: t.threadId ?? null,
      imagePrompt: r.imagePrompt,
      render: {
        duration: t.ctx.videoDuration ?? undefined,
        imageUrl: r.imageUrl,
        instructions: t.ctx.videoInstructions,
        resolution: t.ctx.videoResolution,
        model: t.ctx.videoModel,
        // Prefer a free brief from the edit instruction over the UGC stamp.
        prompt: args.instruction?.trim() || undefined,
        script: row.caption ? ugcSpokenLine({ hook: String(row.caption), body: '', cta: '' }, t.ctx.videoDuration ?? 6) : undefined
      }
    }).catch(() => null);

    const { error } = await t.supabase
      .from('posts')
      .update({
        image_prompt: r.imagePrompt,
        video_thumbnail_url: r.imageUrl,
        // media_url is deliberately NOT touched: the old clip stays until the new one lands, so a
        // submission that never finishes leaves a stale video rather than a post with no media.
        ...(clip
          ? {
              video_render_status: 'rendering',
              video_resolution: clip.resolution,
              video_duration_seconds: clip.durationSeconds
            }
          : {})
      })
      .eq('id', t.postId)
      .eq('brand_id', t.brandId);
    if (error) return { error: error.message };
    // No media review here any more: the new clip does not exist yet, so scoring now would grade
    // the OLD one. The reconciler asks for it once the replacement has actually landed.
    await reschedIfNeeded(t.supabase, t.brandId, t.postId, t.tz);
    return {
      success: true,
      // Submitted, not rendered — the assistant must not tell the user the new clip is ready.
      rendered: false,
      video_render_status: clip ? ('rendering' as const) : undefined,
      video_note: clip
        ? 'The new clip is rendering in the background. The post still shows the previous video until it lands. Tell the user it is being regenerated and that you will report back — do not claim it is done.'
        : 'The re-render could not be started; the post keeps its previous video.',
      video_thumbnail_url: r.imageUrl,
      // Still the OLD clip — the new one has not landed. Reporting the eventual url here is the
      // one thing that would let the assistant announce a video nobody can play yet.
      media_url: row.media_url,
      notes: clip
        ? r.notes ?? undefined
        : 'The cover was updated but the clip could not be re-rendered — the post still carries the previous video.'
    };
  }

  const r = await renderOne(t, row, args.instruction, row.media_url ?? null, args.new_prompt ?? row.image_prompt ?? null);
  const media = r.imageUrl ?? row.media_url;
  const { error } = await t.supabase.from('posts')
    .update({ media_url: media, image_prompt: r.imagePrompt, content_type: r.imageUrl ? 'generated_image' : row.content_type })
    .eq('id', t.postId).eq('brand_id', t.brandId);
  if (error) return { error: error.message };
  await reschedIfNeeded(t.supabase, t.brandId, t.postId, t.tz);
  if (r.imageUrl) {
  }
  return { success: true, rendered: !!r.imageUrl, media_url: media, notes: r.notes ?? undefined };
}

/** Re-render ONE carousel slide (zero-indexed; 0 = cover). Bills one render. */
export async function editCarouselSlide(t: EditorTarget, args: { slide_index: number; instruction?: string; new_prompt?: string }) {
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };
  const urls: string[] = Array.isArray(row.media_urls) ? [...row.media_urls] : [];
  const prompts: string[] = Array.isArray(row.image_prompts) ? [...row.image_prompts] : [];
  if (urls.length <= 1) return { error: 'This post is not a carousel.' };
  if (args.slide_index < 0 || args.slide_index >= urls.length) return { error: `Slide ${args.slide_index} does not exist (0..${urls.length - 1}).` };
  if (!args.instruction && !args.new_prompt) return { error: 'Provide an instruction or a new_prompt for the slide.' };

  const { latestGraphic, versionSource } = await import('$lib/server/design-store');
  const graphic = await latestGraphic(t.supabase, { kind: 'post', id: t.postId, slideIndex: args.slide_index });
  if (graphic) {
    return {
      error: 'typographic_graphic',
      message:
        'This carousel slide is a typographic graphic. Call generate_image to mint photo assets, then replace_source with slide_index to put <img src="https://..."> in the HTML/TSX. Or design_graphic with a change brief.',
      action: 'replace_source',
      slide_index: args.slide_index,
      graphic_version: graphic.version,
      source_chars: versionSource(graphic).length,
      graphic_spec: graphic.spec
    };
  }

  const r = await renderOne(t, row, args.instruction ?? 'Refine this slide.', urls[args.slide_index] ?? null, args.new_prompt ?? prompts[args.slide_index] ?? null);
  if (r.imageUrl) urls[args.slide_index] = r.imageUrl;
  prompts[args.slide_index] = r.imagePrompt;
  const { error } = await t.supabase.from('posts')
    .update({ media_urls: urls, image_prompts: prompts, media_url: urls[0] })
    .eq('id', t.postId).eq('brand_id', t.brandId);
  if (error) return { error: error.message };
  await reschedIfNeeded(t.supabase, t.brandId, t.postId, t.tz);
  if (r.imageUrl) {
  }
  return { success: true, slide_index: args.slide_index, rendered: !!r.imageUrl };
}

/**
 * Attach a clip to this post. Three cases:
 *  - Photo post → image-to-video from media_url.
 *  - Existing video → remake from video_thumbnail_url (or the mp4 as a Seedance reference
 *    when no still was stored). Never refuse just because media_url is already an mp4.
 *  - Graphic left over from a mistaken design_graphic + talking UGC ask → text-to-video from
 *    script/prompt instead of animating the blank canvas.
 *
 * On failure the post is unchanged (previous clip / cover stays).
 */
/** Ratios renderVideo accepts; anything else it silently rewrites to 9:16, so reject it here. */
const ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export const isAspectRatio = (v: unknown): v is AspectRatio =>
  typeof v === 'string' && (ASPECT_RATIOS as readonly string[]).includes(v);

export async function renderPostVideo(
  t: EditorTarget,
  args: {
    duration?: number;
    script?: string;
    instructions?: string;
    aspectRatio?: AspectRatio;
    model?: string;
    prompt?: string;
    ugc?: boolean;
    /** Paid UGC ad → 22s on Seedance 2.5. Implies ugc. */
    ugc_ad?: boolean;
  }
) {
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };
  if (isTextOnly(row)) return { error: 'This is a text/link post — there is no cover to animate.' };
  if (Array.isArray(row.media_urls) && row.media_urls.length > 1) return { error: 'This is a carousel — a clip needs a single cover image.' };

  const isUgcAd = args.ugc_ad === true;
  const isUgc = args.ugc === true || isUgcAd;
  const source = resolveMakeVideoSource(row, { prompt: args.prompt, script: args.script, ugc: isUgc });
  if (!source.ok) return { error: source.error, message: source.message, action: 'make_video' };

  const { data: brand } = await t.supabase.from('brands').select('plan, timezone, content_prefs').eq('id', t.brandId).maybeSingle();
  const prefs = ((brand?.content_prefs as AnyRec) ?? {});
  const tz = (brand?.timezone as string) ?? t.tz;

  const { remaining, addUsage, monthKey } = await import('$lib/server/usage');
  const budget = await remaining(t.supabase, t.brandId, brand?.plan as string | null, tz);
  // Renders already in flight count against the allowance — the monthly number is charged when a
  // clip lands, so usage alone would let one video's budget be spent repeatedly.
  const { countOutstandingVideoRenders } = await import('$lib/server/video-render-queue');
  const { createAdminClient: adminForCount } = await import('$lib/server/supabase-admin');
  const inFlight = await countOutstandingVideoRenders(adminForCount(), t.brandId);
  if (budget.videos - inFlight <= 0) {
    return { error: 'Monthly video budget exhausted for this plan (renders already in progress count against it).' };
  }

  const { isKnownVideoModel, UGC_AD_DURATION } = await import('$lib/server/video');
  const { submitAndTrackVideoRender } = await import('$lib/server/video-render-queue');
  const { createAdminClient } = await import('$lib/server/supabase-admin');
  // Ads do NOT force a model — 22s only lands on Seedance 2.5, other models clamp to the
  // organic 15s ceiling. Else AI override / brand setting / Grok Imagine default.
  const model =
    (args.model && isKnownVideoModel(args.model) ? args.model : null) ??
    (typeof prefs.videoModel === 'string' ? prefs.videoModel : null) ??
    t.ctx.videoModel;
  // Submitted, not awaited. kie owns the job from here and the reconciler attaches the clip; this
  // tool used to hold the editor for minutes watching someone else's render queue.
  const clip = await submitAndTrackVideoRender({
    admin: createAdminClient(),
    brandId: t.brandId,
    userId: t.userId,
    postId: t.postId,
    threadId: t.threadId ?? null,
    imagePrompt: source.imagePrompt,
    render: {
      // Ads lock 22s; else AI duration / Settings / script-sized inside renderVideo.
      duration: isUgcAd ? UGC_AD_DURATION : (args.duration ?? prefs.videoDuration),
      aspectRatio: args.aspectRatio,
      imageUrl: source.cover ?? undefined,
      referenceVideoUrls: source.referenceVideoUrl ? [source.referenceVideoUrl] : undefined,
      visualStyle: t.ctx.visualStyle ?? undefined,
      script: args.script,
      instructions: args.instructions ?? prefs.videoInstructions,
      resolution: prefs.videoResolution,
      prompt: isUgcAd ? undefined : args.prompt,
      // Keep ugc even when a freeform prompt is set — prompt replaces MOTION templates inside
      // buildVideoPrompt, but ugc still suppresses burned-in captions (MASTER: no subtitles).
      ugc: isUgc,
      ugcAd: isUgcAd,
      // Remakes must not add ffmpeg captions the original UGC reel never had.
      burnCaptions: source.remake ? false : undefined,
      model
    }
  });
  if (!clip) {
    return {
      error: source.remake
        ? 'The clip could not be re-rendered — the post still carries the previous video.'
        : 'The clip could not be rendered — the post keeps its cover image.'
    };
  }

  const coverToKeep =
    (typeof row.video_thumbnail_url === 'string' && row.video_thumbnail_url) ||
    source.cover ||
    clip.coverUrl ||
    null;
  // media_url and content_type stay as they are until the clip lands: on a remake that keeps the
  // previous video playable, and on a first render it keeps the cover rather than pointing the
  // post at nothing. The reconciler switches both over.
  // `format` is deliberately left alone until the clip lands: writing 'video' now and failing the
  // render leaves a publishable post labelled a reel whose media is a still image. The reconciler
  // sets it alongside media_url and content_type, so all three flip together or none do.
  const { error } = await t.supabase.from('posts').update({
    video_render_status: 'rendering',
    video_duration_seconds: clip.durationSeconds,
    video_resolution: clip.resolution,
    ...(coverToKeep ? { video_thumbnail_url: coverToKeep } : {})
  }).eq('id', t.postId).eq('brand_id', t.brandId);
  if (error) return { error: error.message };

  // Video budget is charged by the reconciler when a clip actually lands — counting it at submit
  // time would let a run of rejected renders eat the brand's monthly headroom.
  void addUsage;
  void monthKey;
  void tz;
  await reschedIfNeeded(t.supabase, t.brandId, t.postId, t.tz);
  // The media review moves to the reconciler — scoring now would grade the cover, or on a remake
  // the clip being replaced.
  return {
    success: true,
    video_render_status: 'rendering' as const,
    video_note:
      'The clip is rendering in the background and is NOT ready yet. Tell the user it is being generated and that you will report back when it lands — do not claim the video exists.',
    duration_seconds: clip.durationSeconds,
    videos_left: budget.videos - 1,
    remake: source.remake
  };
}

type PersistGraphicResult =
  | { error: string }
  | {
      success: true;
      media_origin: 'typographic_graphic';
      media_url: string;
      post_id: string;
      font: string;
      size: string;
      width: number;
      height: number;
      source_kind: RenderedGraphic['sourceKind'];
      graphic_source: string;
      graphic_spec: RenderedGraphic['spec'];
      version: number | null;
      design_warnings?: string[];
      notes?: string;
    };

/** Upload a rendered graphic, write the post row, and append a graphic_designs version. */
export async function persistRenderedGraphic(
  t: EditorTarget,
  out: RenderedGraphic,
  opts: {
    slideIndex?: number | null;
    brief?: string | null;
    format?: 'png' | 'jpeg';
  } = {}
): Promise<PersistGraphicResult> {
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };

  const format = opts.format === 'jpeg' ? 'jpeg' : 'png';
  const { pngToJpeg } = await import('$lib/server/design-render');
  const { uploadPostImage } = await import('$lib/server/content-preview');
  const { saveGraphicVersion } = await import('$lib/server/design-store');

  const bytes = format === 'jpeg' ? (out.jpeg ?? (await pngToJpeg(out.png))) : out.png;
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const url = await uploadPostImage(t.supabase, t.userId, `data:${mime};base64,${bytes.toString('base64')}`);
  if (!url) return { error: 'The graphic rendered but could not be stored.' };

  const urls: string[] = Array.isArray(row.media_urls) ? [...row.media_urls] : [];
  const isCarousel = urls.length > 1;
  let patch: AnyRec;
  if (opts.slideIndex != null) {
    if (!isCarousel) return { error: 'This post is not a carousel — omit slide_index.' };
    if (opts.slideIndex < 0 || opts.slideIndex >= urls.length) {
      return { error: `Slide ${opts.slideIndex} does not exist (0..${urls.length - 1}).` };
    }
    urls[opts.slideIndex] = url;
    patch = { media_urls: urls, media_url: urls[0] };
  } else {
    patch = {
      media_url: url,
      content_type: 'generated_graphic',
      image_prompt: null,
      ...(isCarousel ? { media_urls: [url] } : {}),
      ...(isVideoPostRow(row)
        ? { video_thumbnail_url: null, video_task_id: null, video_duration_seconds: null }
        : {})
    };
  }

  const { error } = await t.supabase.from('posts').update(patch).eq('id', t.postId).eq('brand_id', t.brandId);
  if (error) return { error: error.message };

  const version = await saveGraphicVersion(t.supabase, {
    brandId: t.brandId,
    userId: t.userId,
    target: { kind: 'post', id: t.postId, slideIndex: opts.slideIndex ?? null },
    spec: out.spec,
    source: out.source,
    mediaUrl: url,
    brief: opts.brief
  });

  await reschedIfNeeded(t.supabase, t.brandId, t.postId, t.tz);

  return {
    success: true,
    media_origin: 'typographic_graphic',
    media_url: url,
    post_id: t.postId,
    font: out.font,
    size: `${out.width}×${out.height}`,
    width: out.width,
    height: out.height,
    source_kind: out.sourceKind,
    graphic_source: out.source,
    graphic_spec: out.spec,
    version,
    // Il gate gira dentro `renderGraphicSource`, quindi arriva fin qui anche per l'editor del
    // browser — che NON deve mai vedersi rifiutare un salvataggio (motivo in graphic-source-edit).
    // Qui i difetti sono sempre e solo avvisi: chi li deve trasformare in rifiuto lo fa a monte.
    ...(out.issues.length ? { design_warnings: out.issues.map((i) => i.detail) } : {}),
    notes:
      out.font !== t.ctx.typography.display
        ? `"${t.ctx.typography.display}" is not available to the renderer, so the graphic is set in ${out.font}. Change it in Studio › Brand › Tipografia.`
        : undefined
  };
}

/**
 * Render caller-authored HTML/TSX onto this post (post-editor chat + source panel).
 * Refuses video posts — those stay on make_video.
 */
export async function applyPostGraphicSource(
  t: EditorTarget,
  args: {
    source: string;
    slide_index?: number | null;
    format?: 'png' | 'jpeg';
    brief?: string | null;
  }
): Promise<PersistGraphicResult> {
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };
  if (isVideoPostRow(row)) {
    return {
      error:
        'This post is a VIDEO. Do not replace it with a still graphic. Remake the reel with make_video.'
    };
  }

  const source = unwrapGraphicSource(args.source);
  if (!source) return { error: 'Empty source' };
  if (source.length > GRAPHIC_SOURCE_MAX_CHARS) {
    return { error: `Source exceeds ${GRAPHIC_SOURCE_MAX_CHARS} characters` };
  }

  const { renderGraphicSource } = await import('$lib/server/design-render');
  let out: RenderedGraphic;
  try {
    out = await renderGraphicSource(source, {
      brandColors: t.ctx.brandColors,
      typography: { display: t.ctx.typography.display, body: t.ctx.typography.body },
      format: args.format === 'jpeg' ? 'jpeg' : 'png'
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Render failed' };
  }

  return persistRenderedGraphic(t, out, {
    slideIndex: args.slide_index ?? null,
    brief: args.brief ?? 'source editor',
    format: args.format
  });
}

/** Metadata only — never paste the HTML/TSX into the post-editor system prompt. */
export async function loadGraphicEditorSystemSuffix(
  supabase: EditorTarget['supabase'],
  postId: string,
  opts?: { carousel?: boolean }
): Promise<string> {
  const { latestGraphic, versionSource } = await import('$lib/server/design-store');
  const graphic = await latestGraphic(supabase, {
    kind: 'post',
    id: postId,
    slideIndex: opts?.carousel ? 0 : null
  });
  if (!graphic) return '';
  try {
    const source = versionSource(graphic);
    return formatGraphicEditorSystemSuffix({
      sourceKind: graphic.sourceKind,
      version: graphic.version,
      aspect: graphic.aspect,
      sourceChars: source.length,
      carousel: opts?.carousel
    });
  } catch {
    return '';
  }
}

/**
 * Compose the post's visual as a typographic graphic — words (and optional photos/icons/shapes)
 * stacked on a brand-coloured canvas.
 *
 * The image model draws letter shapes and sometimes gets them wrong — hence the QC critic that
 * fails "garbled text" and the IMAGE_MODEL_NO_REF escape hatch in content-preview. For a post whose
 * content IS words (a quote, a stat, a list, a price), that whole risk is avoidable: satori sets the
 * type from real font outlines, so the letters are correct by construction. Photos, Lucide/Simple
 * Icons marks and coloured shapes can sit in the same stack as image/icon/shape blocks.
 *
 * Writes to a carousel slot when `slide_index` is given, otherwise replaces the post's single cover.
 */
export async function designPostGraphic(
  t: EditorTarget,
  args: {
    brief: string;
    slide_index?: number;
    /** Media library ids to embed as image blocks. */
    media_ids?: string[];
    /** Brand people ids — signed photos enter AVAILABLE IMAGES. */
    people_ids?: string[];
    /** AI talent ids — signed views enter AVAILABLE IMAGES. */
    talent_ids?: string[];
    /** Extra https/data image URLs (product shots, social thumbs, attachments). */
    image_urls?: string[];
    /** Generate one AI photo first (bills credits) and offer it as a stack ref. */
    generate_prompt?: string;
    /**
     * Required to replace a VIDEO post with a still graphic. Without this flag, a reel is
     * refused so a "remove subtitles / rewrite the spoken script" ask cannot wipe the clip.
     */
    convert_from_video?: boolean;
  }
) {
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };

  const blocked = designGraphicVideoBlock(row, args.convert_from_video === true);
  if (blocked) return blocked;

  const { composeAndRenderGraphic, withBrandKitLogos } = await import('$lib/server/design-compose');
  const { latestGraphic, versionSource } = await import('$lib/server/design-store');
  const { isUrlSafe } = await import('$lib/server/brand-analysis');
  const {
    resolvePeopleVisualRefs,
    resolveTalentVisualRefs,
    pushVisualRefs
  } = await import('$lib/server/design-visual-refs');

  type Img = { url: string; label?: string | null };
  const available: Img[] = [];
  const pushImg = (url: string, label?: string | null) => {
    if (!url || available.some((a) => a.url === url)) return;
    if (url.startsWith('data:image/') || (url.startsWith('http') && isUrlSafe(url))) {
      available.push({ url, label: label ?? null });
    }
  };

  for (const u of t.refUrls ?? []) pushImg(u, 'attachment');
  for (const u of args.image_urls ?? []) pushImg(u);

  if (args.media_ids?.length) {
    const { resolveBrandImageIds } = await import('$lib/server/brand-media');
    const urls = await resolveBrandImageIds(t.supabase, t.brandId, args.media_ids);
    for (const u of urls) pushImg(u, 'media library');
  }

  pushVisualRefs(available, await resolvePeopleVisualRefs(t.supabase, t.brandId, args.people_ids));
  pushVisualRefs(available, await resolveTalentVisualRefs(t.supabase, args.talent_ids));

  // Product images tied to the post, if any — useful refs for a product-in-graphic composition.
  if (row.product_name) {
    const productUrls = await loadProductImages(t.supabase, t.brandId, row.product_name);
    for (const u of productUrls.slice(0, 4)) pushImg(u, `product:${row.product_name}`);
  }

  let generatedUrl: string | undefined;
  if (args.generate_prompt?.trim()) {
    const { generateStandaloneImage } = await import('$lib/server/content-preview');
    const gen = await generateStandaloneImage({
      supabase: t.supabase,
      userId: t.userId,
      brandId: t.brandId,
      prompt: args.generate_prompt.trim(),
      platform: row.platform ?? undefined,
      mediaIds: args.media_ids,
      referenceUrls: available.map((a) => a.url).slice(0, 4)
    });
    if (gen.imageUrl) {
      generatedUrl = gen.imageUrl;
      pushImg(gen.imageUrl, 'ai generated');
    }
  }

  // Official brand kit marks first (ref:0 = brand logo) so the composer can place the real lockup.
  const catalog = withBrandKitLogos(available, {
    logos: t.ctx.logos,
    favicon_url: t.ctx.faviconUrl
  });

  const target = { kind: 'post' as const, id: t.postId, slideIndex: args.slide_index ?? null };
  // A graphic already here means this is an EDIT: revise the stored spec so everything the user
  // didn't mention survives, instead of composing a different graphic from a similar brief.
  const previous = await latestGraphic(t.supabase, target);

  const composeOpts = {
    language: t.ctx.language,
    instructions: t.ctx.typography.instructions,
    brandId: t.brandId,
    userId: t.userId,
    availableImages: catalog
  };

  const hasUserPhoto = catalog.some(
    (a) => a.label === 'attachment' || a.label === 'media library' || a.label === 'prior image' || (a.label?.startsWith('product:') ?? false)
  );
  const photoHint = hasUserPhoto
    ? `\nUSER PHOTO(S) are in AVAILABLE IMAGES. If the brief asks to add a logo / branding onto a photo, use that photo as a full-bleed background <img> (src=ref:N) and place the "brand logo" as a small <img> — NEVER a blank white canvas with only the logo.`
    : '';

  let composed: Awaited<ReturnType<typeof composeAndRenderGraphic>>;
  try {
    composed = await composeAndRenderGraphic(previous ? args.brief + photoHint : args.brief, {
      ...composeOpts,
      previousSource: previous ? versionSource(previous) : null,
      context: previous
        ? null
        : [[row.title, row.caption].filter(Boolean).join('\n').slice(0, 800), photoHint.trim()]
            .filter(Boolean)
            .join('\n') || null,
      render: {
        brandColors: t.ctx.brandColors,
        typography: { display: t.ctx.typography.display, body: t.ctx.typography.body },
        availableImages: catalog
      }
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The graphic could not be composed.' };
  }
  const out = composed.rendered;

  const persisted = await persistRenderedGraphic(t, out, {
    slideIndex: args.slide_index ?? null,
    brief: args.brief
  });
  if ('error' in persisted) return persisted;
  if (args.media_ids?.length && !args.generate_prompt?.trim()) {
    const { recordBrandMediaUse } = await import('$lib/server/brand-media');
    await recordBrandMediaUse(t.supabase, t.brandId, args.media_ids);
  }
  return {
    ...persisted,
    available_images: catalog.length,
    brand_logo_in_catalog: catalog.some((a) => a.label === 'brand logo'),
    generated_image_url: generatedUrl,
    edited: !!previous,
    ...(composed.issues.length ? { design_warnings: composed.issues.map((i) => i.detail) } : {}),
    ...(composed.repaired ? { repaired_after_gate: true } : {})
  };
}

/** Reorder / drop carousel slides. Pure data move — nothing is re-rendered, nothing is billed. */
export async function restructureCarouselSlides(t: EditorTarget, args: { order: number[] }) {
  const row = await readRow(t);
  if (!row) return { error: 'Post not found' };
  const urls: string[] = Array.isArray(row.media_urls) ? row.media_urls : [];
  const prompts: string[] = Array.isArray(row.image_prompts) ? row.image_prompts : [];
  if (urls.length <= 1) return { error: 'This post is not a carousel.' };
  if (args.order.some((i) => i < 0 || i >= urls.length)) return { error: `Order refers to a slide that does not exist (valid 0..${urls.length - 1}).` };
  const newUrls = args.order.map((i) => urls[i]);
  const newPrompts = args.order.map((i) => prompts[i] ?? null);
  const { error } = await t.supabase.from('posts')
    .update({ media_urls: newUrls, image_prompts: newPrompts, media_url: newUrls[0] })
    .eq('id', t.postId).eq('brand_id', t.brandId);
  if (error) return { error: error.message };
  await reschedIfNeeded(t.supabase, t.brandId, t.postId, t.tz);
  return { success: true, slide_count: newUrls.length };
}

/**
 * Tools for the per-post content editor. Deliberately small and slide-aware: the router
 * (a cheap model) reads the compact post state and calls exactly one edit. Thin wrappers over
 * the ops above — the CLI reaches the same ops through /api/v1/.../posts/:id/media.
 *
 * `refUrls` are the assets the user attached to THIS message (uploads + library picks,
 * already resolved to signed/data URLs by the endpoint), fed to renders as references.
 */
export function createPostEditorTools(
  supabase: SupabaseClient,
  brandId: string,
  postId: string,
  tz: string,
  userId: string,
  ctx: EditorContext,
  refUrls: string[],
  /** The editor conversation, so a deferred clip render can report back into it. */
  threadId?: string | null
) {
  const t: EditorTarget = { supabase, brandId, postId, tz, userId, ctx, refUrls, threadId };

  return {
    ...createMediaLibraryTools({ supabase, brandId, userId }),

    read_post: tool({
      description:
        'Read the current state of the post: caption, title, media_origin (typographic_graphic | ai_generated | user_uploaded | video | none). When media_origin is typographic_graphic, graphic.source_chars / source_kind are metadata only — grep_source → read_source → replace_source to patch the HTML/TSX (write_source only to rebuild). Photos inside the graphic: read_media first; if a library image fits, use_library_image then replace_source <img src>; generate_image only when nothing fits (returns image_url, does not change the post). Call this first. When media_origin is video (or is_video is true), remakes go through make_video — never design_graphic / write_source.',
      inputSchema: z.object({}),
      execute: async () => readPostState(t)
    }),

    set_text: tool({
      description: 'Write the post text directly. Use for any caption / title / first-comment change you can compose yourself from the user instruction. No image is touched. This is the cheap path — prefer it whenever the request is about wording. Refused unless you read_post first — and refused again if the post changed since that read.',
      inputSchema: z.object({
        caption: z.string().optional().describe('Full new caption text'),
        title: z.string().optional().describe('New title (Reddit / YouTube / carousels)'),
        first_comment: z.string().optional().describe('First comment (hashtags / CTA)')
      }),
      execute: async (patch: AnyRec, _opts: ToolExecutionOptions<unknown>) => setPostText(t, patch)
    }),

    youtube_thumbnail: tool({
      description: [
        'Set, generate, or clear the YouTube custom thumbnail (16:9 cover sent to YouTube as mediaItems[].thumbnail).',
        'Does NOT change the video itself or video_thumbnail_url (the 9:16 clip cover used for remakes).',
        'YouTube only applies custom thumbs to regular videos — Shorts ignore them via the API.',
        'Use when the user asks for a YouTube copertina / thumbnail / cover. generate bills AI credits. set copies image_url. clear removes it.',
        'Never call regenerate_image or make_video just to change the YouTube cover.'
      ].join('\n'),
      inputSchema: z.object({
        action: z.enum(['generate', 'set', 'clear']).describe('generate a 16:9 cover, set an existing https image, or clear'),
        brief: z.string().optional().describe('Direction for generate (e.g. close-up of the product, bold title)'),
        image_url: z.string().optional().describe('https image URL to copy as the thumbnail (action=set)')
      }),
      execute: async (args: { action: 'generate' | 'set' | 'clear'; brief?: string; image_url?: string }) =>
        applyYoutubeThumbnail(t, args)
    }),

    generate_image: tool({
      description: [
        'Mint a Nano Banana Pro PHOTO asset and return its https image_url. Does NOT change this post. Bills AI credits.',
        'MEDIA FIRST: call read_media before this. If a library photo fits, use_library_image instead — do not mint a duplicate.',
        'On a typographic_graphic: after minting, replace_source to put <img src="https://..."> in the HTML/TSX. https URLs are inlined at PNG render.',
        'On an ai_generated photo post, prefer regenerate_image to replace the cover. This tool is for extra assets, not for swapping the post visual.',
        'NEVER use this on a VIDEO/reel — that is make_video.'
      ].join('\n'),
      inputSchema: z.object({
        prompt: z.string().describe('Description of the still to generate'),
        aspect_ratio: z
          .enum(['1:1', '4:5', '9:16', '16:9'])
          .optional()
          .describe('Aspect ratio of the minted still (default 1:1)'),
        media_ids: z
          .array(z.string())
          .optional()
          .describe('Brand Media library ids as fidelity references'),
        people_ids: z.array(z.string()).optional().describe('Brand people ids — face refs'),
        talent_ids: z.array(z.string()).optional().describe('AI talent ids — face/body refs')
      }),
      execute: async (args: {
        prompt: string;
        aspect_ratio?: '1:1' | '4:5' | '9:16' | '16:9';
        media_ids?: string[];
        people_ids?: string[];
        talent_ids?: string[];
      }) => mintStandaloneGraphicAsset(t, args)
    }),

    regenerate_image: tool({
      description:
        'Regenerate an AI PHOTO visual from an instruction. ONLY when read_post.media_origin is ai_generated (or a video cover look-change). If media_origin is typographic_graphic, read_media then use_library_image or generate_image, then replace_source <img src>, or design_graphic for a high-level brief — unless the user asked to remake it as a UGC video, then make_video. Not for carousels — use edit_slide there. FOR A VIDEO POST this edits the stored cover frame and re-renders the clip — it is NOT the tool for rewriting the spoken script or removing subtitles (use make_video). The brand-kit logo is auto-attached as a fidelity reference.',
      inputSchema: z.object({
        instruction: z.string().describe('What to change in the image, in natural language'),
        new_prompt: z.string().optional().describe('Optionally, a full replacement image prompt to use instead of refining')
      }),
      execute: async (args: { instruction: string; new_prompt?: string }) => regeneratePostImage(t, args)
    }),

    edit_slide: tool({
      description:
        'Edit ONE AI-PHOTO carousel slide (zero-indexed). If that slide\'s media_origin is typographic_graphic, read_media then use_library_image or generate_image, then replace_source with slide_index, or design_graphic with slide_index.',
      inputSchema: z.object({
        slide_index: z.number().int().min(0).describe('Which slide to edit (0 = cover)'),
        instruction: z.string().optional().describe('What to change in this slide\'s image'),
        new_prompt: z.string().optional().describe('Full replacement image prompt for this slide')
      }),
      execute: async (args: { slide_index: number; instruction?: string; new_prompt?: string }) => editCarouselSlide(t, args)
    }),

    make_video: tool({
      description: [
        'Create or REMAKE a video/reel on THIS post. This is the tool for UGC talking-head remakes.',
        'When the post is ALREADY a video: remakes it in place from the stored cover (video_thumbnail_url) or the existing clip. Does NOT convert it into a graphic.',
        'Use when the user asks to remake the reel, rewrite the spoken script (più naturale/fluido), or remove on-screen subtitles/captions/titles — those are burned into the VIDEO, not a typographic canvas.',
        'Pass script (the spoken line), ugc:true for talking UGC (also disables burned-in captions), and prompt directing delivery ("no on-screen text, natural full sentences").',
        'Do NOT call design_graphic for subtitle/script requests. Default model is Grok Imagine (480p, ≤15s); pass model="bytedance/seedance-2-5" for Seedance 2.5. Paid UGC ads: 22s on Seedance 2.5, 15s cap elsewhere. Bills the monthly video budget.'
      ].join('\n'),
      inputSchema: z.object({
        duration: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe(
            'YOU choose clip length in seconds for THIS request — do not default to 13s. Size to the spoken script (~3.5 words/sec, fast short-form, with headroom). Grok/Seedance 2: 10–15s; Seedance 2.5: up to 30s. Omit only to use Settings → Video or script-based sizing.'
          ),
        script: z.string().optional().describe('Line to be spoken on camera; trimmed to fit the runtime. Omit for silent clips.'),
        prompt: z
          .string()
          .max(VIDEO_BRIEF_MAX_CHARS)
          .optional()
          .describe(
            'YOUR creative brief for THIS clip (camera, motion, energy, genre). When set it replaces hardcoded UGC/cinematic MOTION templates — you can still pass ugc:true together with it. Never ask the video model for on-screen text. Keep under ' +
              VIDEO_BRIEF_MAX_CHARS +
              ' chars.'
          ),
        instructions: z
          .string()
          .max(600)
          .optional()
          .describe('Extra delivery direction (tone, accent), at most 600 chars. Overrides Settings → Video when set.'),
        ugc: z
          .boolean()
          .optional()
          .describe('Talking UGC remake: pass true (handheld delivery + NO burned-in captions). Keep true even when prompt is set. Default false only for silent/cinematic b-roll.'),
        ugc_ad: z
          .boolean()
          .optional()
          .describe(
            'Paid UGC ad. Implies ugc. 22s on Seedance 2.5 (pass model), capped at 15s on other models. Omit/false = organic ≤15s when ugc.'
          ),
        model: z
          .enum([
            'grok-imagine-video-1-5-preview',
            'bytedance/seedance-2-5',
            'bytedance/seedance-2',
            'bytedance/seedance-2-fast',
            'bytedance/seedance-2-mini'
          ])
          .optional()
          .describe(
            'Video model for THIS clip. Default is Grok Imagine ("grok-imagine-video-1-5-preview", 480p, ≤15s). Pass "bytedance/seedance-2-5" for Seedance 2.5 (up to 30s or reference video/audio). Omit to use Settings → Video. This IS the manual selector — do not claim it is missing.'
          )
      }),
      execute: async (args: {
        duration?: number;
        script?: string;
        prompt?: string;
        instructions?: string;
        ugc?: boolean;
        ugc_ad?: boolean;
        model?: string;
      }) => renderPostVideo(t, args)
    }),


    design_graphic: tool({
      description: [
        'Compose or REVISE a typographic graphic from HTML/CSS (or React TSX) source — words on a brand-coloured canvas, optionally with embedded photos.',
        'Use when media_origin is typographic_graphic, or when the user asked for a STILL with WORDS (quote, stat, tip list, price, claim).',
        'NEVER use this on a VIDEO/reel to "remove subtitles", rewrite a spoken script, or remake UGC — that deletes the clip and often yields a blank canvas. Call make_video instead.',
        'To convert a reel into a still graphic you MUST pass convert_from_video:true AND the user must have explicitly asked for a graphic, not a video remake.',
        'Pass media_ids / people_ids / talent_ids / image_urls (or rely on attachments) so image blocks can embed those photos.',
        'Need a photo inside this graphic? Call read_media first. If a library asset fits, pass media_ids here or use_library_image then replace_source <img src>. generate_image only when nothing uploaded fits. generate_prompt on THIS tool is a one-shot shortcut (mint one still + composer restyle). Do not call regenerate_image for that.',
        'The official brand kit logo (and favicon) are ALWAYS offered as AVAILABLE IMAGES labeled "brand logo" / "brand favicon" — ask for them in the brief when the user wants the real mark; never fake it with an icon or typed name.',
        'Icons: Lucide (check, sparkles, arrow-right, …) or Simple Icons THIRD-PARTY brand slugs (instagram, tiktok, openai, …) — not this brand\'s own logo.',
        'Edits revise the stored HTML/TSX from the same base. For a copy/color/spacing patch prefer grep_source → replace_source. Use this tool for a high-level restyle or a first composition. Prefer over regenerate_image for word-led stills.'
      ].join('\n'),
      inputSchema: z.object({
        brief: z
          .string()
          .describe('What the graphic should say — or, when the post already has one, what to change about it. Include the exact number, quote or price if one matters.'),
        slide_index: z
          .number()
          .int()
          .optional()
          .describe('Carousel only: which slide to replace (zero-indexed, 0 = cover). Omit for a single-image post.'),
        media_ids: z
          .array(z.string())
          .optional()
          .describe('Media library asset ids to embed as photos inside the graphic.'),
        people_ids: z.array(z.string()).optional().describe('Brand people ids — their photos enter AVAILABLE IMAGES.'),
        talent_ids: z.array(z.string()).optional().describe('AI talent ids — face/body refs as image blocks.'),
        image_urls: z
          .array(z.string())
          .optional()
          .describe('Extra https image URLs (product, social thumbs, prior post) to offer as image-block refs.'),
        generate_prompt: z
          .string()
          .optional()
          .describe(
            'Mint one Nano Banana Pro photo (bills credits) and offer it as an image block / background while this tool restyles the graphic. Prefer generate_image + replace_source when you need several assets or want to place the URL yourself.'
          ),
        convert_from_video: z
          .boolean()
          .optional()
          .describe(
            'Set true ONLY when the user explicitly asked to turn this VIDEO into a still graphic. Omit for every other graphic edit. Without it, design_graphic refuses on reels so a script/subtitle remake cannot wipe the clip.'
          )
      }),
      execute: async (args: {
        brief: string;
        slide_index?: number;
        media_ids?: string[];
        people_ids?: string[];
        talent_ids?: string[];
        image_urls?: string[];
        generate_prompt?: string;
        convert_from_video?: boolean;
      }) => compactGraphicPersist(await designPostGraphic(t, args))
    }),

    ...createGraphicSourceEditTools(async () => t),

    restructure_carousel: tool({
      description: 'Reorder or remove carousel slides without re-rendering. Provide the new order as a list of current slide indices (e.g. [0,2,1] swaps slides 2 and 3; [0,1,3] drops slide 2). To ADD a slide, use edit_slide after extending — not supported here.',
      inputSchema: z.object({
        order: z.array(z.number().int().min(0)).min(1).describe('New slide order as current indices; omit an index to remove that slide')
      }),
      execute: async (args: { order: number[] }) => restructureCarouselSlides(t, args)
    })
  };
}
