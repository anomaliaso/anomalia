import { swallow } from '$lib/server/swallow';
import { houseVoiceFor, loadCaptionKnowledge } from './caption-quality';
import { brandLines, client } from './plan-pipeline';
import { type AspectRatio, type QcVerdict, aspectRatioFor, brandVisualDirective, extractVisualPlaybook, loadBrandLogoImagePart, loadBrandMoodImageUrls, loadMoodRefs, renderCarouselSlide, renderWithQC, uploadPostImage } from './images';
import { imageModelFor, imageRefineModelFor } from '$lib/image-models';
import { type AnyRec, type BrandProfile, CAROUSEL_MIN_SLIDES, CAROUSEL_PLATFORMS, type ContentPrefs, type ImagePart, type PreviewPost, carouselMaxSlides, guidanceFor, platformKey } from './seed-model';
import { aiActCopyGuardrail } from '$lib/ai-act';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { fetchImagePart } from '$lib/server/brand-context';
import { structured } from '$lib/server/research';

const CREATE_SINGLE_SCHEMA = {
  type: 'object' as const,
  properties: {
    caption: { type: 'string' as const, description: "On-brand caption delivering the user's brief, at the platform's native length/register." },
    image_prompt: { type: 'string' as const, description: 'Photorealistic, scroll-stopping image description grounded in the brief (no aspect ratio — the renderer sizes it).' }
  },
  required: ['caption', 'image_prompt']
};

// Carousel variant of the single-content schema: a caption plus one prompt per slide, a coherent
// series (same as the batch EXEC_SCHEMA's slide_prompts). The slide COUNT is the model's choice
// from the brief (clamped to CAROUSEL bounds in code) — the modal takes only a brief, like the
// other formats.
const CREATE_CAROUSEL_SCHEMA = {
  type: 'object' as const,
  properties: {
    caption: { type: 'string' as const, description: "On-brand caption delivering the user's brief, at the platform's native length/register." },
    slide_prompts: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        "One image prompt per slide (3-8, prefer 4-6), forming ONE coherent visual series: same medium, palette, lighting and art direction across all slides. Slide 1 is the scroll-stopping hook/cover; each later slide advances the brief one concrete step (a list item, a process step, a comparison side). Every prompt describes its slide STANDALONE (never 'same as previous'). No aspect ratio."
    }
  },
  required: ['caption', 'slide_prompts']
};

// Whether a platform can carry a multi-image carousel (Zernio mediaItems): IG/FB/LinkedIn.
// Exported so the create-single endpoint can reject a carousel on an unsupported platform.
export function isCarouselPlatform(platform: string | null | undefined): boolean {
  return CAROUSEL_PLATFORMS.has(platformKey(platform));
}

export async function createSingleContent(opts: {
  supabase: SupabaseClient;
  userId: string;
  brandId?: string;
  profile: BrandProfile; // stored profile: ai_context/visual_style/brand_colors/fonts/moodImages
  platform: string;
  // 'reel' → vertical cover frame for a video post; 'post' → regular feed image;
  // 'carousel' → a multi-slide series (N coordinated images). One user brief drives all of them.
  format: 'post' | 'reel' | 'carousel';
  // Carousel only: the exact number of slides the USER asked for (clamped to the carousel
  // bounds). Absent → the model picks 3-6 from the brief.
  slideCount?: number;
  brief: string;
  referenceImages?: Array<{ inlineData: { mimeType: string; data: string } }>;
  prefs?: ContentPrefs;
  // Brand Media library: reuse uploaded assets instead of (or as fidelity refs for) generation.
  mediaIds?: string[];
  mediaMode?: 'use_as_is' | 'composite' | 'auto';
  // 'reel' only: shoot the cover as handheld UGC instead of the brand's premium look. Swaps the
  // visual style outright — see ugc.ts for why blending the two is the wrong answer.
  ugc?: boolean;
  // 'reel' + ugc only: the opening spoken claim, so the frame's expression matches the audio.
  hook?: string;
}): Promise<{
  caption: string;
  imagePrompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  imagePrompts?: string[];
  qc?: QcVerdict;
  contentType?: string;
  fromLibrary?: string;
  knowledgeChunkIds?: string[];
}> {
  const ai = client();
  const prefs = opts.prefs ?? {};
  const { languageLine, contextBlock, visualStyleBlock, avoidLine, voiceExamplesBlock, voiceBlock, personalityLine } = brandLines(opts.profile, prefs);
  const guide = guidanceFor(opts.platform, prefs);

  const { block: knowledgeBlock, chunkIds: knowledgeChunkIds } = await loadCaptionKnowledge(
    opts.supabase,
    opts.brandId,
    opts.brief
  );
  const knowledgeSection = knowledgeBlock
    ? `\n${knowledgeBlock}\nUse facts from the brand material only when they strengthen the brief; never invent citations.\n`
    : '';
  const withKnowledge = <T extends Record<string, unknown>>(result: T): T & { knowledgeChunkIds?: string[] } =>
    knowledgeChunkIds.length ? { ...result, knowledgeChunkIds } : result;

  // Resolve library media when the agent/user picked assets.
  const mediaIds = (opts.mediaIds ?? []).filter(Boolean).slice(0, 4);
  let libraryMode: 'use_as_is' | 'composite' | null = null;
  let libraryParts: ImagePart[] | undefined;
  let stampCompositeLibrary = async (_ok: boolean) => {};
  if (mediaIds.length && opts.brandId) {
    const {
      listReadyLibraryImages,
      loadLibraryMediaParts,
      defaultLibraryMediaMode,
      publishLibraryImageAsPostMedia,
      recordBrandMediaUse
    } = await import('$lib/server/brand-media');
    const rows = await listReadyLibraryImages(opts.supabase, opts.brandId, 50);
    const picked = rows.filter((r) => mediaIds.includes(r.id));
    const primary = picked[0];
    if (opts.mediaMode === 'use_as_is' || opts.mediaMode === 'composite') {
      libraryMode = opts.mediaMode;
    } else if (primary) {
      libraryMode = defaultLibraryMediaMode(primary);
    } else {
      libraryMode = 'use_as_is';
    }

    // Pixel-perfect path: caption only + publish the asset as post media (no Nano Banana).
    // Caption is multimodal — the model LOOKS at the photo so copy matches what's visible.
    if (libraryMode === 'use_as_is' && primary && opts.format !== 'carousel') {
      const visionParts = await loadLibraryMediaParts(opts.supabase, opts.brandId, [primary.id], 1);
      const captionPrompt = `You are an expert social media copywriter. Write ONE caption for this brand that will sit under the ATTACHED photo (the user's real uploaded asset — it IS the post visual).

LOOK at the attached image carefully. Ground the caption in what is actually visible (subjects, setting, mood, products, people, text-in-image). Do NOT invent details that aren't in the photo. Do NOT invent a different image.

Brand: ${opts.profile?.name ?? ''}
About: ${opts.profile?.about ?? ''}
${contextBlock}${voiceBlock}
${personalityLine}
${languageLine}
${avoidLine}
${aiActCopyGuardrail()}
${houseVoiceFor(prefs)}
${guide ? `PLATFORM (write the caption to fit this): ${guide}` : `Platform: ${opts.platform}`}

LIBRARY CATALOG (secondary — the attached image is authoritative):
- title: ${primary.title ?? primary.file_name}
- description: ${primary.description ?? ''}
- subjects: ${(primary.subjects ?? []).join(', ')}
- mood: ${primary.mood ?? ''}
- suggested use: ${primary.suggested_use ?? ''}
- when: ${primary.when_to_use ?? ''}
- how: ${primary.how_to_use ?? ''}
- where: ${primary.where_to_use ?? ''}
- tags: ${(primary.tags ?? []).join(', ')}

USER BRIEF (steer the angle, but stay true to the photo):
${opts.brief}
${knowledgeSection}
Return JSON with "caption" and "image_prompt" (set image_prompt to "Use library asset as-is").`;
      const parsed: AnyRec = await structured(ai, captionPrompt, CREATE_SINGLE_SCHEMA,
        'Write a sharp on-brand caption for the attached real photo. Describe only what you see; never invent a different visual.',
        {
          label: 'createSingleContent',
          brandId: opts.brandId,
          userId: opts.userId,
          context: 'library_use_as_is',
          images: visionParts.length ? visionParts : undefined
        });
      const caption = String(parsed.caption ?? '').trim();
      const published = await publishLibraryImageAsPostMedia(opts.supabase, {
        brandId: opts.brandId,
        userId: opts.userId,
        mediaId: primary.id,
        platform: opts.platform
      });
      if (!('publicUrl' in published)) {
        // Fall through to generation with the asset as reference.
        libraryMode = 'composite';
      } else {
        return withKnowledge({
          caption,
          imagePrompt: 'Use library asset as-is',
          imageUrl: published.publicUrl,
          contentType: 'uploaded_image',
          fromLibrary: primary.id
        });
      }
    }

    if (libraryMode === 'composite' || (libraryMode === 'use_as_is' && opts.format === 'carousel')) {
      libraryParts = await loadLibraryMediaParts(opts.supabase, opts.brandId, mediaIds);
    }
    stampCompositeLibrary = async (ok: boolean) => {
      if (!ok) return;
      await recordBrandMediaUse(opts.supabase, opts.brandId!, mediaIds);
    };
  }

  const isVideo = opts.format === 'reel';
  const isCarousel = opts.format === 'carousel';
  const mergedRefs = [...(libraryParts ?? []), ...(opts.referenceImages ?? [])];
  const refsLine = mergedRefs.length
    ? `The user provided ${mergedRefs.length} reference photo(s) of the REAL subject — they will be attached to the image generator. Keep that subject PIXEL-FAITHFUL (do not reinvent or replace it). Write the image prompt(s) to INTEGRATE those exact pixels into a beautiful on-brand social post (scene, lighting, composition, branding around them); never redraw the subject from scratch.`
    : '';

  const [moodImages] = await Promise.all([loadMoodRefs(opts.profile?.moodImages as string[] | undefined)]);
  const brandLook = brandVisualDirective(
    opts.profile?.brand_colors,
    (opts.profile?.fonts ?? []).map((f: AnyRec) => f?.name).filter(Boolean)
  );
  // A UGC reel's cover inverts the brand look rather than applying it — moodboard, playbook and
  // brand palette all pull toward "polished", which is exactly what makes AI video read as an ad.
  const isUgcCover = opts.format === 'reel' && opts.ugc === true;
  const { UGC_VISUAL_STYLE, UGC_COVER_MODEL } = await import('$lib/server/ugc');
  const logoImage = isUgcCover
    ? undefined
    : ((await loadBrandLogoImagePart(opts.profile?.logos)) ?? undefined);
  const renderOpts = {
    referenceImages: mergedRefs.length ? (mergedRefs as ImagePart[]) : undefined,
    // Half the price, and its "lower quality" is the point on an amateur frame.
    ...(isUgcCover ? { model: UGC_COVER_MODEL } : { model: imageModelFor(prefs), refineModel: imageRefineModelFor(prefs) }),
    moodImages: isUgcCover ? undefined : moodImages,
    visualStyle: isUgcCover ? UGC_VISUAL_STYLE : (opts.profile?.visual_style as string | undefined) || undefined,
    visualPlaybook: isUgcCover ? undefined : extractVisualPlaybook(opts.profile?.ai_context),
    brandLook: isUgcCover ? undefined : brandLook || undefined,
    logoImage,
    referenceMode: mergedRefs.length ? ('product' as const) : undefined,
    // 'reel' is this path's video format — its cover goes 9:16 so the clip inherits it.
    aspectRatio: aspectRatioFor(opts.platform, opts.format)
  };
  const highStakes = !!mergedRefs.length;
  const critiqueOpts = { referenceImages: renderOpts.referenceImages, visualStyle: renderOpts.visualStyle };

  // ── Carousel: caption + N slide prompts → slide 1 (full QC) + slides 2..N (anchored, light QC) ──
  if (isCarousel) {
    const maxSlides = carouselMaxSlides();
    // The user's chosen slide count is authoritative (clamped); absent → let the model pick.
    const wanted = opts.slideCount ? Math.max(CAROUSEL_MIN_SLIDES, Math.min(maxSlides, Math.round(opts.slideCount))) : 0;
    const slideCountLine = wanted
      ? `- "slide_prompts": EXACTLY ${wanted} prompts — a coherent visual SERIES delivering the brief across ${wanted} slides, matching the brand visual style. Break the brief into ${wanted} distinct, complementary slides.`
      : `- "slide_prompts": 3-${maxSlides} prompts (prefer 4-6) — a coherent visual SERIES delivering the brief slide by slide, matching the brand visual style. Only use as many slides as the brief genuinely sustains as distinct steps.`;
    const prompt = `You are an expert social media copywriter and art director. Create ONE CAROUSEL post (a multi-slide image series) for this brand from the user's brief below.

Brand: ${opts.profile?.name ?? ''}
About: ${opts.profile?.about ?? ''}
${contextBlock}${visualStyleBlock}${voiceBlock}
${personalityLine}
${languageLine}
${avoidLine}
${aiActCopyGuardrail()}
${houseVoiceFor(prefs)}
${guide ? `PLATFORM (write the caption to fit this): ${guide}` : `Platform: ${opts.platform}`}

USER BRIEF (authoritative — this is what the carousel must say/show):
${opts.brief}
${knowledgeSection}${refsLine}

Produce:
- "caption": scroll-stopping, on-brand, at the platform's native length and hashtag count.
${slideCountLine}
Return JSON.`;
    const parsed: AnyRec = await structured(ai, prompt, CREATE_CAROUSEL_SCHEMA,
      'You are an expert performance-marketing copywriter and art director. The user brief is authoritative; design a carousel that reads as one coherent, on-brand series.',
      { label: 'createSingleContent', brandId: opts.brandId, userId: opts.userId, context: 'create_carousel' });
    const caption = String(parsed.caption ?? '').trim();
    const slidePrompts = (Array.isArray(parsed.slide_prompts) ? parsed.slide_prompts : [])
      .map((s: unknown) => String(s ?? '').trim())
      .filter(Boolean)
      .slice(0, wanted || maxSlides);

    // A carousel needs ≥2 slides; if the model under-delivered, fall through to a single image
    // on the first prompt (never ship half a series).
    if (slidePrompts.length >= 2) {
      const coverPrompt = slidePrompts[0];
      const { dataUrl, qc } = await renderWithQC(ai, coverPrompt, renderOpts, critiqueOpts, highStakes);
      if (dataUrl) {
        const cover = await uploadPostImage(opts.supabase, opts.userId, dataUrl, renderOpts.aspectRatio);
        if (cover) {
          const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          const anchor: ImagePart | undefined = m ? { inlineData: { mimeType: m[1], data: m[2] } } : undefined;
          const total = slidePrompts.length;
          const rest = await Promise.all(
            slidePrompts.slice(1).map((sp, idx) =>
              renderCarouselSlide(ai, opts.supabase, opts.userId, sp, idx + 1, total, renderOpts, anchor, critiqueOpts)
            )
          );
          const urls = [cover, ...rest.filter((u): u is string => !!u)];
          if (urls.length > 1) {
            await stampCompositeLibrary(true);
            return withKnowledge({ caption, imagePrompt: coverPrompt, imageUrl: cover, imageUrls: urls, imagePrompts: slidePrompts, qc });
          }
          // Only the cover survived → ship as a single image.
          await stampCompositeLibrary(true);
          return withKnowledge({ caption, imagePrompt: coverPrompt, imageUrl: cover, qc });
        }
      }
      return withKnowledge({ caption, imagePrompt: coverPrompt, qc });
    }
    // Under-delivered slides → single image on whatever prompt we have.
    const only = slidePrompts[0] || `Photorealistic, scroll-stopping social photo: ${opts.brief}`;
    const { dataUrl, qc } = await renderWithQC(ai, only, renderOpts, critiqueOpts, highStakes);
    const imageUrl = dataUrl ? await uploadPostImage(opts.supabase, opts.userId, dataUrl, renderOpts.aspectRatio) : undefined;
    await stampCompositeLibrary(!!imageUrl);
    return withKnowledge({ caption, imagePrompt: only, imageUrl, qc });
  }

  const prompt = `You are an expert social media copywriter and art director. Create ONE ${isVideo ? 'short-video' : 'image'} post for this brand from the user's brief below.

Brand: ${opts.profile?.name ?? ''}
About: ${opts.profile?.about ?? ''}
${contextBlock}${visualStyleBlock}${voiceExamplesBlock}${voiceBlock}
${personalityLine}
${languageLine}
${avoidLine}
${aiActCopyGuardrail()}
${houseVoiceFor(prefs)}
${guide ? `PLATFORM (write the caption to fit this): ${guide}` : `Platform: ${opts.platform}`}

USER BRIEF (authoritative — this is what the post must say/show):
${opts.brief}
${knowledgeSection}${refsLine}

Produce:
- "caption": scroll-stopping, on-brand, at the platform's native length and hashtag count.
- "image_prompt": a photorealistic, scroll-stopping ${isVideo ? 'COVER FRAME for a short vertical video' : 'image'} that delivers the brief and matches the brand visual style. Do NOT specify an aspect ratio.
Return JSON.`;

  const parsed: AnyRec = await structured(ai, prompt, CREATE_SINGLE_SCHEMA,
    'You are an expert performance-marketing copywriter with a sharp, original voice. The user brief is authoritative; be specific, on-brand and visual.',
    { label: 'createSingleContent', brandId: opts.brandId, userId: opts.userId, context: 'create_post' });
  const caption = String(parsed.caption ?? '').trim();
  const imagePrompt = String(parsed.image_prompt ?? '').trim() || `Photorealistic, scroll-stopping social photo: ${opts.brief}`;

  // The UGC cover must show a PERSON MID-SENTENCE: image-to-video fixes subject, room and wardrobe
  // from this frame, so a scene with nobody in it makes the video model invent its own speaker.
  const coverPromptFinal = isUgcCover
    ? (await import('$lib/server/ugc')).buildUgcFramePrompt({ hook: opts.hook })
    : imagePrompt;

  const { dataUrl, qc } = await renderWithQC(
    ai,
    coverPromptFinal,
    renderOpts,
    critiqueOpts,
    // Same policy as the batch renderer: user-uploaded subject references make fidelity the
    // whole point → best-of-N candidates; a pure text brief renders once.
    highStakes
  );
  let imageUrl: string | undefined;
  if (dataUrl) imageUrl = await uploadPostImage(opts.supabase, opts.userId, dataUrl, renderOpts.aspectRatio);
  await stampCompositeLibrary(!!imageUrl);
  return withKnowledge({ caption, imagePrompt, imageUrl, qc });
}

// ── On-demand carousel (chat tool) ──────────────────────────────────────────
// One-shot carousel from a brief: LLM writes the caption + N coherent slide prompts, then we
// render slide 1 (cover) at full quality and slides 2..N anchored to it — the exact rendering path
// the batch generator uses (renderWithQC + renderCarouselSlide), just for a single post. Returns
// the ordered slide URLs; a series that ends with < 2 usable slides returns imageUrls:[] so the
// caller can fall back to a single image.
const CAROUSEL_SINGLE_SCHEMA = {
  type: 'object' as const,
  properties: {
    caption: { type: 'string' as const, description: "On-brand caption for the whole carousel, at the platform's native length/register and hashtag count." },
    slide_prompts: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description:
        "One photorealistic image prompt per slide, forming ONE coherent visual series (same medium, palette, lighting and art direction). Slide 1 is the scroll-stopping hook/cover; each later slide advances the brief one concrete step. Every prompt describes its slide STANDALONE (never 'same as previous'). No aspect ratio."
    }
  },
  required: ['caption', 'slide_prompts']
};

export async function createSingleCarousel(opts: {
  supabase: SupabaseClient;
  userId: string;
  brandId?: string;
  profile: BrandProfile; // same stored profile shape createSingleContent receives
  platform: string;
  brief: string;
  slideCount: number;
  prefs?: ContentPrefs;
}): Promise<{ caption: string; imagePrompts: string[]; imageUrls: string[]; qc?: QcVerdict }> {
  const ai = client();
  const prefs = opts.prefs ?? {};
  const n = Math.max(CAROUSEL_MIN_SLIDES, Math.min(carouselMaxSlides(), Math.round(Number(opts.slideCount) || 5)));
  const { languageLine, contextBlock, visualStyleBlock, avoidLine, voiceExamplesBlock, voiceBlock, personalityLine } = brandLines(opts.profile, prefs);
  const guide = guidanceFor(opts.platform, prefs);

  const prompt = `You are an expert social media copywriter and art director. Create ONE ${n}-slide CAROUSEL post for this brand from the user's brief below.

Brand: ${opts.profile?.name ?? ''}
About: ${opts.profile?.about ?? ''}
${contextBlock}${visualStyleBlock}${voiceExamplesBlock}${voiceBlock}
${personalityLine}
${languageLine}
${avoidLine}
${aiActCopyGuardrail()}
${houseVoiceFor(prefs)}
${guide ? `PLATFORM (write the caption to fit this): ${guide}` : `Platform: ${opts.platform}`}

USER BRIEF (authoritative — this is what the carousel must say/show):
${opts.brief}

Produce:
- "caption": scroll-stopping, on-brand caption for the whole carousel.
- "slide_prompts": EXACTLY ${n} prompts forming one coherent visual series — slide 1 the hook/cover, each later slide advancing the brief one concrete step (a list item, a process step, a comparison side, a story beat). Each prompt standalone. Do NOT specify an aspect ratio.
Return JSON.`;

  const parsed: AnyRec = await structured(ai, prompt, CAROUSEL_SINGLE_SCHEMA,
    'You are an expert performance-marketing copywriter and art director. The user brief is authoritative; make every slide earn its place and keep the series visually coherent.',
    { label: 'createSingleCarousel', brandId: opts.brandId, userId: opts.userId, context: 'create_post_carousel' });

  const caption = String(parsed.caption ?? '').trim();
  const slidePrompts = (Array.isArray(parsed.slide_prompts) ? parsed.slide_prompts : [])
    .map((p: unknown) => String(p ?? '').trim())
    .filter(Boolean)
    .slice(0, n);
  if (slidePrompts.length < 2) return { caption, imagePrompts: slidePrompts, imageUrls: [] };

  const [moodImages] = await Promise.all([loadMoodRefs(opts.profile?.moodImages as string[] | undefined)]);
  const brandLook = brandVisualDirective(
    opts.profile?.brand_colors,
    (opts.profile?.fonts ?? []).map((f: AnyRec) => f?.name).filter(Boolean)
  );
  const renderOpts = {
    model: imageModelFor(prefs),
    refineModel: imageRefineModelFor(prefs),
    moodImages,
    visualStyle: (opts.profile?.visual_style as string | undefined) || undefined,
    visualPlaybook: extractVisualPlaybook(opts.profile?.ai_context),
    brandLook: brandLook || undefined,
    aspectRatio: aspectRatioFor(opts.platform)
  };

  // Slide 1 (cover) at full quality, then slides 2..N in parallel anchored to it.
  const { dataUrl, qc } = await renderWithQC(ai, slidePrompts[0], renderOpts, { visualStyle: renderOpts.visualStyle }, false);
  if (!dataUrl) return { caption, imagePrompts: slidePrompts, imageUrls: [], qc };
  const cover = await uploadPostImage(opts.supabase, opts.userId, dataUrl, renderOpts.aspectRatio);
  if (!cover) return { caption, imagePrompts: slidePrompts, imageUrls: [], qc };

  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const anchor: ImagePart | undefined = m ? { inlineData: { mimeType: m[1], data: m[2] } } : undefined;
  const total = slidePrompts.length;
  const rest = await Promise.all(
    slidePrompts.slice(1).map((slidePrompt, idx) =>
      renderCarouselSlide(ai, opts.supabase, opts.userId, slidePrompt, idx + 1, total, renderOpts, anchor, { visualStyle: renderOpts.visualStyle })
    )
  );
  const imageUrls = [cover, ...rest.filter((u): u is string => !!u)];
  return { caption, imagePrompts: slidePrompts, imageUrls, qc };
}

// ── Standalone image generation (chat tool) ─────────────────────────────────
// Generate a single image from a prompt, using the brand's visual context (palette, fonts,
// mood images, visual style). No post is created — returns the uploaded image URL only.

export async function generateStandaloneImage(opts: {
  supabase: SupabaseClient;
  userId: string;
  brandId: string;
  prompt: string;
  platform?: string;
  aspectRatio?: AspectRatio;
  mediaIds?: string[];
  /** Arbitrary images to hand the renderer as visual references (chat picks, user attachments). */
  referenceUrls?: string[];
}): Promise<{ imageUrl?: string; qc?: QcVerdict; notes?: string; costUsd?: number; credits?: number }> {
  const ai = client();

  const doneStandalone = async (
    result: { imageUrl?: string; qc?: QcVerdict; notes?: string; costUsd?: number; credits?: number }
  ) => {
    if (result.imageUrl && opts.mediaIds?.length) {
      const { recordBrandMediaUse } = await import('$lib/server/brand-media');
      await recordBrandMediaUse(opts.supabase, opts.brandId, opts.mediaIds);
    }
    return result;
  };

  // Load brand visual context (same assembly as createSingleContent)
  const [{ data: kit }, { data: brandRow }] = await Promise.all([
    opts.supabase.from('brand_kit')
      .select('visual_style, ai_context, brand_colors, fonts, logos')
      .eq('brand_id', opts.brandId)
      .maybeSingle(),
    opts.supabase.from('brands').select('content_prefs').eq('id', opts.brandId).maybeSingle()
  ]);

  const brandLook = brandVisualDirective(
    kit?.brand_colors as string[] | null,
    (Array.isArray(kit?.fonts) ? (kit!.fonts as AnyRec[]) : []).map((f) => f?.name).filter(Boolean) as string[]
  );
  const aspectRatio = opts.aspectRatio ?? aspectRatioFor(opts.platform);
  // Chat generate_image / design_graphic(generate_prompt): always hand the official mark to the
  // renderer — no need for the model to pass media_ids for the brand logo.
  const logoImage = (await loadBrandLogoImagePart(kit?.logos)) ?? undefined;

  // Resolve every user/library photo once. First frame = BASE to edit (add logo / light change);
  // the rest stay as fidelity refs. Same contract as media-generator generate_image.
  const libraryUrls = opts.mediaIds?.length
    ? await (await import('$lib/server/brand-media')).resolveBrandImageIds(
        opts.supabase,
        opts.brandId,
        opts.mediaIds
      )
    : [];
  const allRefUrls = [
    ...libraryUrls.filter(Boolean),
    ...(opts.referenceUrls ?? []).filter((u) => typeof u === 'string' && !!u)
  ].slice(0, 4);
  const baseUrl = allRefUrls[0];
  const extraUrls = allRefUrls.slice(1);
  const editBrief = baseUrl
    ? `${opts.prompt}\n\nEdit the attached BASE photo in place — keep the scene, subject and composition; apply only what this prompt asks (e.g. place the official brand logo). Do not replace the photo with a blank canvas.`
    : opts.prompt;

  if ((await import('$lib/server/image-agent')).isImageAgentEnabled()) {
    const { runImageAgent } = await import('$lib/server/image-agent');
    const moodUrls = await loadBrandMoodImageUrls(opts.supabase, opts.brandId).catch((error) => { swallow('load mood image urls', error); return []; });
    const agent = await runImageAgent({
      supabase: opts.supabase,
      userId: opts.userId,
      brandId: opts.brandId,
      brief: editBrief,
      platform: opts.platform ?? null,
      aspectRatio: opts.aspectRatio,
      baseImageUrl: baseUrl ?? null,
      // Base is already baseImageUrl — don't also pin it as a library ref (would double-attach).
      pinnedLibraryMediaIds: baseUrl ? undefined : opts.mediaIds,
      userRefUrls: extraUrls,
      moodImageUrls: moodUrls,
      visualStyle: (kit?.visual_style as string | undefined) || undefined,
      visualPlaybook: extractVisualPlaybook(kit?.ai_context) || undefined,
      brandLook: brandLook || undefined,
      logoImage,
      deadlineMs: 280_000
    });
    return doneStandalone({
      imageUrl: agent.imageUrl,
      notes: agent.notes,
      costUsd: agent.costUsd,
      credits: agent.credits
    });
  }

  // Load mood images as style anchors
  const moodUrls = await loadBrandMoodImageUrls(opts.supabase, opts.brandId).catch((error) => { swallow('load mood image urls', error); return []; });
  const [moodImages, baseImage, extraParts] = await Promise.all([
    loadMoodRefs(moodUrls),
    baseUrl ? fetchImagePart(baseUrl) : Promise.resolve(null),
    Promise.all(extraUrls.map((u) => fetchImagePart(u))).then(
      (parts) => parts.filter(Boolean) as ImagePart[]
    )
  ]);

  if (allRefUrls.length && !baseImage && !extraParts.length) {
    console.warn(
      '[generateStandaloneImage] reference URL(s) provided but fetchImagePart returned nothing'
    );
  }

  const renderOpts = {
    model: imageModelFor((brandRow?.content_prefs ?? {}) as ContentPrefs),
    refineModel: imageRefineModelFor((brandRow?.content_prefs ?? {}) as ContentPrefs),
    baseImage: baseImage ?? undefined,
    referenceImages: extraParts.length ? extraParts : undefined,
    referenceMode: extraParts.length ? ('product' as const) : undefined,
    moodImages,
    logoImage,
    visualStyle: (kit?.visual_style as string | undefined) || undefined,
    visualPlaybook: extractVisualPlaybook(kit?.ai_context) || undefined,
    brandLook: brandLook || undefined,
    aspectRatio
  };

  const { dataUrl, qc } = await renderWithQC(
    ai,
    editBrief,
    renderOpts,
    { referenceImages: renderOpts.referenceImages, visualStyle: renderOpts.visualStyle },
    !!baseImage || !!extraParts.length
  );

  let imageUrl: string | undefined;
  if (dataUrl) imageUrl = await uploadPostImage(opts.supabase, opts.userId, dataUrl, aspectRatio);
  return doneStandalone({ imageUrl, qc });
}

// ── Post-CTA click path enrichment ───────────────────────────────────────────
// At persist time, a produced post whose caption carries a link to the brand's own site gets:
//   1. UTM tags appended to the target (so the brand's analytics see the social traffic),
//   2. a post_links row (post-links.ts) pairing a short /l/[code] redirect with that tagged
//      target, whose clicks feed the weekly recap's "Link clicks" stat,
//   3. the short URL written back onto post.link_url AND swapped into the caption (the writer
//      wove the raw URL in verbatim) — the short link is what actually ships, so it's the only
//      version a reader can click and therefore the only one we can count.
// CALLER RULE (the persist sites are in scheduler.ts / onboarding-generate.ts, out of scope
// here): call this ONLY for posts whose persisted row will have source = 'plan' — the scheduler
// autopilot persist and the onboarding persist. NEVER for Radar (source = 'radar'): Radar links
// point at news source_urls (not the brand's own pages) and Radar already appends its own utm_
// tags. Also skip any link_url that already contains a utm_ parameter — a Reddit link_post
// (media:'link') with a real external target, or a user-edited URL, must never be rewritten
// twice. A failed enrichment must never block the post: everything below is try/catch-wrapped.

type EnrichBrand = { id: string; slug?: string | null };

export async function enrichCtaWithUtm(
  supabase: SupabaseClient,
  brand: EnrichBrand,
  post: PreviewPost
): Promise<void> {
  try {
    const target = String(post.link_url ?? '').trim();
    if (!target || !/^https?:\/\//i.test(target) || /[?&]utm_/i.test(target)) return;

    // Week bucket: the ISO week of the post's planned slot (its own week, not production day),
    // so the UTM campaign stays stable even when the batch is produced early.
    const slotDate = slotDateOf(post.day, post.time);
    const { buildUtm, createPostLink, postSlugOf, weekKeyOf } = await import('../post-links');
    const utm = buildUtm({
      brandSlug: brand.slug ?? 'brand',
      weekKey: weekKeyOf(slotDate),
      postSlug: postSlugOf(post.angle || post.pillar),
      platform: platformKey(post.platform)
    });
    const tagged = `${target}${target.includes('?') ? '&' : '?'}${utm}`;
    post.link_url = tagged; // stands even if the short-link insert below fails

    // The post row doesn't exist yet at enrichment time → post_id stays null (nullable column);
    // the recap window keys off post_links.created_at, so untied rows still count. target_url is
    // the TAGGED url: /l/[code] redirects to it verbatim, so the UTM survives the hop.
    const link = await createPostLink(supabase, {
      brandId: brand.id,
      postId: null,
      targetUrl: tagged,
      utmCampaign: utm.match(/utm_campaign=([^&]*)/)?.[1],
      utmContent: utm.match(/utm_content=([^&]*)/)?.[1],
      label: 'post CTA'
    });
    post.link_url = link.url;
    // The caption carries the raw target (the writer was given it verbatim) — swap every
    // occurrence for the short URL, otherwise the shipped caption bypasses the counter.
    if (post.caption?.includes(target)) post.caption = post.caption.split(target).join(link.url);
  } catch (e) {
    console.warn('[post-links] enrichCtaWithUtm failed (continuing):', e instanceof Error ? e.message : e);
  }
}

// Resolve a post's planned slot ("Monday", "10:00") to a concrete date: the next occurrence of
// that weekday from now (falling back to today when the slot can't be parsed). Date-only —
// the time is irrelevant for the week bucket.
function slotDateOf(day: string | undefined, time: string | undefined): Date {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const idx = names.indexOf(String(day ?? '').toLowerCase().trim());
  void time; // the time does not change the week bucket
  const now = new Date();
  if (idx === -1) return now;
  const d = new Date(now);
  d.setDate(d.getDate() + ((idx - d.getDay() + 7) % 7));
  return d;
}
