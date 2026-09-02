import { tool, type ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import { isUrlSafe } from '$lib/server/brand-analysis';
import { publishApprovedPost, connectedPlatforms, type ApprovablePost } from '$lib/server/publish';
import { EDITOR_POST_COLS, requireZernioCancellation } from '$lib/server/post-editing';
import { createSingleContent, CAROUSEL_PLATFORMS, carouselMaxPerBatch, attachBrandMoodImages, generateStandaloneImage, regeneratePost, loadBrandMoodImageUrls, type ContentPrefs } from '$lib/server/content-preview';
import { remaining, addUsage, monthKey } from '$lib/server/usage';
import { gateToolCall } from '$lib/server/chat/tool-policy';
import { VIDEO_BRIEF_MAX_CHARS } from '$lib/video-models';
import { GRAPHIC_ASSET_MINT_HINT, STANDALONE_IMAGE_HINT, isVideoPostRow } from '$lib/server/media-origin';
import { env } from '$env/dynamic/private';
import { loadActivePlan, currentWeekIndex } from '$lib/server/editorial-plan';
import { compactGraphicPersist } from '$lib/server/chat/graphic-source-edit';
import type { ChatToolCtx } from './shared';
import { startLongToolJob, type AnyRec } from './shared';

// ── CONTENT CREATION tools ────────────────────────────────────────────────

export function createContentTools(ctx: ChatToolCtx) {
  const { supabase, brandId, tz, userId, threadId, turnRefUrls } = ctx;
  return {
    create_post: tool({
      description:
        'Create a new social media post — caption + visual as a pending draft. MEDIA FIRST: if the brand Media library has usable assets (call read_media), pass media_ids so the post reuses those photos pixel-perfect (media_mode use_as_is) or composites them into a branded frame (composite). Only generate a brand-new AI image when no library asset fits. Set content_type to "carousel" for a multi-slide post (Instagram/Facebook/LinkedIn only), or "video" for a reel. For videos YOU choose model, duration, genre and creative brief via video_model / duration / ugc / ugc_ad / video_prompt — pass video_prompt to direct the clip freely (avoids hardcoded UGC/cinematic templates). Default video model is Grok Imagine (480p); for Seedance 2.5 (up to 30s or reference video/audio) pass video_model="bytedance/seedance-2-5". Paid UGC ads: 22s on Seedance 2.5, capped at 15s on other models.',
      inputSchema: z.object({
        brief: z.string().describe('What the post should say/show — the user\'s brief or topic'),
        platform: z.string().optional().describe('Target platform (e.g. "instagram", "tiktok", "linkedin"). Omit to use brand\'s primary platform. Carousels require instagram, facebook or linkedin. A platform the brand has NOT connected is refused before any work is done — connect it first, or pass allow_unconnected to make a draft anyway.'),
        allow_unconnected: z
          .boolean()
          .optional()
          .describe(
            'Make the post even though the requested platform has no connected account. Only when the user, told the platform is not connected, still wants a draft prepared for later — never as a way around the refusal on your own.'
          ),
        content_type: z.enum(['image', 'video', 'carousel']).optional().describe('Content type. PREFER "video" — a vertical reel is what actually travels on Instagram, TikTok and LinkedIn, and it costs about twice a still, not ten times. Reach for "image" when the idea is genuinely visual rather than spoken, and "carousel" only when the angle truly sustains several distinct slides (it is the priciest format we make — roughly double a video). If a video render fails the result comes back with video_fallback:true — say the post shipped as an image, never claim a video.'),
        ugc: z.boolean().optional().describe('Video only. Opt INTO the handheld UGC genre (phone selfie, heated delivery, no craft). Default false / omit — write video_prompt instead to direct the clip freely. Set true only when the user asks for UGC / raw phone footage. When true and the brand has People in Studio, pass people_ids so the clip shows a consistent real face.'),
        ugc_ad: z
          .boolean()
          .optional()
          .describe(
            'Video + UGC only. true = paid UGC AD (22s on Seedance 2.5 via video_model, capped at 15s on other models; fuller Demo+Proof script ~55–66 words). false/omit = organic ≤15s. Use when the user asks for an ad/boost creative.'
          ),
        video_prompt: z
          .string()
          .max(VIDEO_BRIEF_MAX_CHARS)
          .optional()
          .describe(
            'Video only. YOUR creative brief for THIS clip (camera, motion, energy, setting, genre). When set it REPLACES hardcoded UGC/cinematic motion templates — always prefer writing this over relying on ugc:true. Example: "Slow push-in on the product on a walnut desk, soft window light, no person, ambient room tone only." Keep under ' +
              VIDEO_BRIEF_MAX_CHARS +
              ' chars. Do not ask for on-screen text (captions are burned on afterwards).'
          ),
        instructions: z
          .string()
          .max(600)
          .optional()
          .describe(
            'Video only. Extra delivery direction (tone, accent, what never to do), at most 600 chars. Overrides Settings → Video instructions when set. Soft steer alongside video_prompt.'
          ),
        video_model: z
          .enum([
            'grok-imagine-video-1-5-preview',
            'bytedance/seedance-2-5',
            'bytedance/seedance-2',
            'bytedance/seedance-2-fast',
            'bytedance/seedance-2-mini'
          ])
          .optional()
          .describe(
            'Video only. kie video model for THIS clip. Default is Grok Imagine ("grok-imagine-video-1-5-preview", 480p, ≤15s). Use "bytedance/seedance-2-5" when the user asks for Seedance / Seedance 2.5, longer than 15s, or reference video/audio. Omit to use the brand Settings → Video model (or the Grok Imagine default). NEVER claim Seedance is unavailable — this parameter IS the selector.'
          ),
        duration: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe(
            'Video only. YOU choose the clip length in seconds for THIS reel — do not default everything to 13s. Size it to the spoken script at ~3.5 words/sec with headroom (Grok/Seedance 2: 10–15s; Seedance 2.5: up to 30s). Organic UGC ≤15s; ugc_ad asks for 22s — only Seedance 2.5 holds it. Prefer 10 for a punchy hook, 15 for organic Hook→Problem→Demo→Proof→CTA. Omit only if Settings → Video has a fixed length the brand wants enforced.'
          ),
        slide_count: z.number().min(3).max(8).optional().describe('Number of slides for a carousel (default 5; only used when content_type is "carousel")'),
        script: z
          .string()
          .optional()
          .describe(
            'Only for content_type "video", and you should almost always write one when someone speaks on camera — a silent clip has no hook. Structure as HOOK + BODY + CTA in one line when it is a talking reel. Budget ~3.5 words per second of the duration YOU chose (fast short-form; leave a little headroom so speech finishes). Captions are burned on afterwards; never ask for on-screen text. Omit for silent product/b-roll when video_prompt says so.'
          ),
        media_ids: z
          .array(z.string())
          .optional()
          .describe('Brand Media library ids from read_media to reuse as the post visual. Prefer these over generating a new AI image. With graphic_brief, these become AVAILABLE IMAGES the graphic can embed or use as background.'),
        people_ids: z
          .array(z.string())
          .optional()
          .describe('Brand people ids from read_people — their photos become visual refs (AI photo) or AVAILABLE IMAGES (graphic_brief).'),
        talent_ids: z
          .array(z.string())
          .optional()
          .describe('AI talent library ids from read_talents — face/body refs for generate or graphic image blocks.'),
        media_mode: z
          .enum(['use_as_is', 'composite', 'auto'])
          .optional()
          .describe(
            'How to use media_ids: use_as_is = publish the uploaded asset pixel-perfect (preferred for photos); composite = Nano Banana integrates the asset into a branded frame with high fidelity; auto = pick based on asset catalog (default). Ignored when graphic_brief is set.'
          ),
        image_urls: z
          .array(z.string())
          .optional()
          .describe(
            'https URLs to embed/use as background (graphic) or as fidelity refs — from fetch_social_thumbs, read_market_references.thumbnail_url, or a prior generate_image.'
          ),
        graphic_brief: z
          .string()
          .optional()
          .describe(
            'Set this to make the visual a typographic graphic — words on a brand-coloured canvas, optionally with embedded photos or a full-bleed photo BACKGROUND from media_ids / image_urls / people_ids / talent_ids (e.g. reuse a standalone generate_image URL). Lucide/Simple Icons and coloured shapes allowed. Reach for it when the post IS words (quote, stat, tip list, price, claim), with or without a photo. Overrides content_type and script.'
          ),
        caption: z
          .string()
          .optional()
          .describe('Only with `graphic_brief`: the caption to publish alongside the graphic. Defaults to the brief.')
      }),
      execute: async (
        {
          brief,
          platform,
          allow_unconnected,
          content_type,
          slide_count,
          script,
          ugc,
          ugc_ad,
          video_model,
          duration: video_duration,
          video_prompt,
          instructions: video_instructions,
          media_ids,
          people_ids,
          talent_ids,
          media_mode = 'auto',
          image_urls,
          graphic_brief,
          caption: caption_text
        }: {
          brief: string;
          platform?: string;
          allow_unconnected?: boolean;
          content_type?: string;
          slide_count?: number;
          script?: string;
          ugc?: boolean;
          ugc_ad?: boolean;
          video_model?: string;
          duration?: number;
          video_prompt?: string;
          instructions?: string;
          media_ids?: string[];
          people_ids?: string[];
          talent_ids?: string[];
          media_mode?: 'use_as_is' | 'composite' | 'auto';
          image_urls?: string[];
          graphic_brief?: string;
          caption?: string;
        },
        opts: ToolExecutionOptions<unknown>
      ) => {
        const { data: brandRow } = await supabase.from('brands').select('name, plan, timezone, content_prefs, target_platforms').eq('id', brandId).maybeSingle();
        const budget = await remaining(supabase, brandId, brandRow?.plan, brandRow?.timezone ?? tz);
        const gate = gateToolCall('create_post', budget, { content_type, media_mode, media_ids, graphic_brief });
        if (gate) return gate;

        // Resolve platform
        const targetPlatform = platform?.toLowerCase().trim()
          || (Array.isArray(brandRow?.target_platforms) ? (brandRow!.target_platforms as string[])[0] : null)
          || 'instagram';

        // IL CANCELLO PRIMA DELLA SPESA. Produrre per una piattaforma non collegata costa
        // esattamente quanto produrre per una collegata — un giro vero: 429 secondi e $0,19 per
        // un post TikTok su un brand senza TikTok — e il risultato non è pubblicabile da nessuno.
        // Vale SOLO quando la piattaforma è stata chiesta esplicitamente: senza `platform` siamo
        // sul default del brand, e preparare bozze prima di collegare gli account è lavoro vero
        // (onboarding). L'errore non è un muro: dice cosa dire all'utente e come procedere lo
        // stesso se l'utente lo vuole davvero, altrimenti l'agente ricomincia a tentativi.
        //
        // ponytail: il cancello scatta solo sulla piattaforma ESPLICITA. Un agente che omette
        // `platform` e finisce sul default del brand spende comunque; se succede davvero, il
        // passo successivo è gaterare anche il default quando il brand ha almeno un account
        // collegato (cioè non è più in onboarding) — non prima, o si blocca chi non ne ha ancora.
        if (platform && !allow_unconnected) {
          const connected = await connectedPlatforms(supabase, brandId, [targetPlatform]);
          if (!connected.has(targetPlatform)) {
            return {
              error: 'platform_not_connected',
              platform: targetPlatform,
              message: `${targetPlatform} is not connected for this brand, so nothing made for it can be scheduled or published. Nothing was generated and nothing was spent. Tell the user to connect ${targetPlatform} in Settings > Connectors and then ask again. If they say they want a draft prepared anyway, call this tool again with allow_unconnected: true.`
            };
          }
        }

        // Carousel guards: honour the global kill switch and the platform capability set.
        const isCarousel = content_type === 'carousel';
        if (isCarousel) {
          if (carouselMaxPerBatch() === 0) return { error: 'I caroselli sono disattivati al momento.' };
          if (!CAROUSEL_PLATFORMS.has(targetPlatform)) return { error: 'I caroselli sono supportati solo su Instagram, Facebook o LinkedIn. Scegli una di queste piattaforme.' };
        }

        // Build brand profile
        const { data: kit } = await supabase
          .from('brand_kit')
          .select('category, about, target_audience, brand_colors, fonts, ai_character, ai_context, visual_style, site_type, graphic_style, logos, favicon_url')
          .eq('brand_id', brandId)
          .maybeSingle();
        const profile: AnyRec = {
          name: brandRow?.name ?? '',
          category: kit?.category ?? '',
          about: kit?.about ?? '',
          target_audience: kit?.target_audience ?? '',
          brand_colors: kit?.brand_colors ?? [],
          fonts: kit?.fonts ?? [],
          ai_character: kit?.ai_character ?? {},
          ai_context: kit?.ai_context ?? '',
          visual_style: kit?.visual_style ?? '',
          site_type: kit?.site_type ?? 'generic'
        };
        await attachBrandMoodImages(profile, supabase, brandId);
        const prefs: ContentPrefs = (brandRow?.content_prefs as ContentPrefs) ?? {};

        try {
          // Craft + render the media. Carousel → N coherent slides; else a single image/video cover.
          let caption: string;
          let imagePrompt: string | null;
          let mediaUrl: string;
          let mediaUrls: string[] | null = null;
          let imagePrompts: string[] | null = null;
          let format: string;
          let contentTypeOut = 'generated_image';
          let fromLibrary: string | undefined;
          // Video-only outputs: clip length (persisted for cost reconciliation), whether we had
          // to fall back to the cover, and whether a real clip consumed video budget.
          let videoDurationSeconds: number | null = null;
          let videoTaskId: string | null = null;
          let videoResolution: string | null = null;
          let videoThumbnailUrl: string | null = null;
          let videoFallback = false;
          let videosUsed = 0;
          /** Set when a clip was submitted to kie and will be attached by the reconciler. */
          let videoRenderPending: import('$lib/server/video').SubmittedVideoRender | null = null;
          /** Row in video_renders holding that submission, written before the post exists. */
          let videoRenderId: string | null = null;
          // Set by the graphic branch so the spec can be logged as v1 once the post row exists.
          let graphicSpec: import('$lib/design/blocks').Graphic | import('$lib/design/graphic-source').GraphicHtmlMeta | null = null;
          let graphicSource: string | null = null;
          // Cosa il gate ha trovato sulla grafica appena composta — riportato nel risultato della
          // tool, non nascosto: la prima composizione fino a oggi non era mai stata controllata.
          let graphicWarnings: string[] = [];

          if (graphic_brief) {
            // Typographic post (optional embedded photos from media_ids). Composed on the
            // art-direction model, then set deterministically — see design-compose / design-render.
            const { composeAndRenderGraphic, withBrandKitLogos } = await import('$lib/server/design-compose');
            const { resolveTypography } = await import('$lib/design/typography');
            const { uploadPostImage } = await import('$lib/server/content-preview');
            const { isUrlSafe } = await import('$lib/server/brand-analysis');
            const {
              resolvePeopleVisualRefs,
              resolveTalentVisualRefs,
              pushVisualRefs
            } = await import('$lib/server/design-visual-refs');
            const type = resolveTypography(kit);
            const available: Array<{ url: string; label?: string | null }> = [];
            if (media_ids?.length) {
              const { resolveBrandImageIds } = await import('$lib/server/brand-media');
              const urls = await resolveBrandImageIds(supabase, brandId, media_ids);
              for (const u of urls) if (u && (u.startsWith('data:image/') || isUrlSafe(u))) available.push({ url: u, label: 'media library' });
            }
            for (const u of image_urls ?? []) {
              if (typeof u === 'string' && (u.startsWith('data:image/') || isUrlSafe(u))) {
                available.push({ url: u, label: 'prior image' });
              }
            }
            for (const u of turnRefUrls) {
              if (u && (u.startsWith('data:image/') || isUrlSafe(u))) available.push({ url: u, label: 'attachment' });
            }
            pushVisualRefs(available, await resolvePeopleVisualRefs(supabase, brandId, people_ids));
            pushVisualRefs(available, await resolveTalentVisualRefs(supabase, talent_ids));
            const catalog = withBrandKitLogos(available, {
              logos: kit?.logos,
              favicon_url: typeof kit?.favicon_url === 'string' ? kit.favicon_url : null
            });
            const photoHint = available.length
              ? `\nUSER PHOTO(S) are in AVAILABLE IMAGES. If the brief asks to add a logo / branding onto a photo, use that photo as a full-bleed background <img src="ref:N"> and place the "brand logo" as a small <img> — NEVER a blank white canvas with only the logo.`
              : '';
            const composed = await composeAndRenderGraphic(graphic_brief, {
              brandName: brandRow?.name,
              language: prefs.language,
              instructions: type.instructions,
              brandId,
              userId,
              availableImages: catalog,
              context: photoHint.trim() || null,
              render: {
                brandColors: Array.isArray(kit?.brand_colors) ? (kit.brand_colors as string[]) : null,
                typography: { display: type.display, body: type.body },
                availableImages: catalog
              }
            });
            const out = composed.rendered;
            graphicWarnings = composed.issues.map((i) => i.detail);
            const url = await uploadPostImage(
              supabase,
              userId,
              `data:image/png;base64,${out.png.toString('base64')}`
            );
            if (!url) return { error: 'La grafica è stata composta ma non è stato possibile salvarla.' };
            caption = caption_text?.trim() || brief;
            imagePrompt = null;
            mediaUrl = url;
            format = 'image';
            contentTypeOut = 'generated_graphic';
            graphicSpec = out.spec;
            graphicSource = out.source;
          } else if (isCarousel) {
            const {
              resolvePeopleVisualRefs,
              resolveTalentVisualRefs
            } = await import('$lib/server/design-visual-refs');
            const { fetchImagePart } = await import('$lib/server/brand-context');
            const personTalentUrls = [
              ...(await resolvePeopleVisualRefs(supabase, brandId, people_ids)).map((r) => r.url),
              ...(await resolveTalentVisualRefs(supabase, talent_ids)).map((r) => r.url),
              ...turnRefUrls,
              ...(image_urls ?? []).filter((u) => typeof u === 'string' && isUrlSafe(u))
            ].slice(0, 4);
            const referenceImages = (
              await Promise.all(personTalentUrls.map((u) => fetchImagePart(u)))
            ).filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;
            const carousel = await createSingleContent({
              supabase,
              userId,
              brandId,
              profile,
              platform: targetPlatform,
              format: 'carousel',
              brief,
              slideCount: slide_count ?? 5,
              prefs,
              mediaIds: media_ids,
              mediaMode: media_mode === 'use_as_is' ? 'composite' : media_mode,
              referenceImages: referenceImages.length ? referenceImages : undefined
            });
            if (!carousel.imageUrls || carousel.imageUrls.length < 2) return { error: 'Generazione carosello fallita. Riprova.' };
            caption = carousel.caption;
            imagePrompt = carousel.imagePrompts?.[0] ?? carousel.imagePrompt ?? null;
            imagePrompts = carousel.imagePrompts ?? null;
            mediaUrl = carousel.imageUrls[0];
            mediaUrls = carousel.imageUrls;
            format = 'carousel';
          } else {
            const {
              resolvePeopleVisualRefs,
              resolveTalentVisualRefs
            } = await import('$lib/server/design-visual-refs');
            const { fetchImagePart } = await import('$lib/server/brand-context');
            const personTalentUrls = [
              ...(await resolvePeopleVisualRefs(supabase, brandId, people_ids)).map((r) => r.url),
              ...(await resolveTalentVisualRefs(supabase, talent_ids)).map((r) => r.url),
              ...turnRefUrls,
              ...(image_urls ?? []).filter((u) => typeof u === 'string' && isUrlSafe(u))
            ].slice(0, 4);
            const referenceImages = (
              await Promise.all(personTalentUrls.map((u) => fetchImagePart(u)))
            ).filter(Boolean) as Array<{ inlineData: { mimeType: string; data: string } }>;
            // ugc_ad implies UGC genre (paid talking-head ads are always UGC).
            const isUgc = content_type === 'video' && (ugc === true || ugc_ad === true);
            const isUgcAd = isUgc && ugc_ad === true;
            const result = await createSingleContent({
              supabase,
              userId,
              brandId,
              profile,
              platform: targetPlatform,
              format: content_type === 'video' ? 'reel' : 'post',
              // UGC cover style only when the AI explicitly opts in — freeform clips keep brand visual style.
              ugc: isUgc,
              hook: script?.trim().split(/(?<=[.!?])\s/)[0],
              brief,
              prefs,
              mediaIds: media_ids,
              mediaMode: media_mode,
              referenceImages: referenceImages.length ? referenceImages : undefined
            });
            if (!result.imageUrl) return { error: 'Generazione immagine fallita. Riprova.' };
            caption = result.caption;
            imagePrompt = result.imagePrompt || null;
            mediaUrl = result.imageUrl;
            format = content_type === 'video' ? 'video' : 'single_image';
            if (result.contentType) contentTypeOut = result.contentType;
            fromLibrary = result.fromLibrary;

            // A 'video' post must ship an actual CLIP, not just a cover frame. The cover is
            // already QC'd and brand-grounded, so it drives image-to-video and the model only
            // directs motion. Gated on the plan's monthly video headroom (budget.videos) — a
            // clip is the priciest thing the engine buys. Best-effort: on any failure the post
            // still ships as a photo, and videoFallback tells the assistant to say so rather
            // than claim a video that isn't there.
            if (content_type === 'video' && result.imagePrompt) {
              // Outstanding renders count against the allowance: the monthly video number is only
              // charged when a clip lands, so without this a single-video budget could be spent
              // several times inside the reconcile window.
              const { countOutstandingVideoRenders } = await import('$lib/server/video-render-queue');
              const { createAdminClient: adminForCount } = await import('$lib/server/supabase-admin');
              const inFlightVideos = await countOutstandingVideoRenders(adminForCount(), brandId);
              if (env.KIE_API_KEY && budget.videos - inFlightVideos > 0) {
                const { UGC_AD_DURATION, submitVideoRender } = await import('$lib/server/video');
                // Submit and stop. kie holds the job; a cron collects the clip and attaches it to
                // this post. Waiting here was the longest block in the whole tool — up to ten
                // minutes of an invocation spent watching someone else's queue, which also capped
                // every clip at POLL_TIMEOUT_MS no matter how long it genuinely needed.
                const submitted = await submitVideoRender(result.imagePrompt, {
                  // Ads lock to 22s; else AI-chosen length wins; else Settings → Video.
                  duration: isUgcAd ? UGC_AD_DURATION : (video_duration ?? prefs.videoDuration),
                  imageUrl: result.imageUrl,
                  visualStyle: profile.visual_style || undefined,
                  // AI instructions win; else brand Settings → Video.
                  instructions: video_instructions ?? prefs.videoInstructions,
                  resolution: prefs.videoResolution,
                  // Selected model wins; else Settings; else the Grok Imagine default.
                  // Ads do NOT force a model — 22s only lands on Seedance 2.5, other models
                  // clamp to the organic 15s ceiling (ugcDurationCap).
                  model: video_model,
                  prefs,
                  // Freeform brief replaces hardcoded MOTION templates when set (buildVideoPrompt).
                  // Ads keep the UGC template (ignore freeform) so speech rails stay on.
                  prompt: isUgcAd ? undefined : video_prompt,
                  // Keep ugc when a prompt is set: prompt replaces motion templates, ugc still
                  // suppresses burned-in captions (MASTER: no subtitles on UGC).
                  ugc: isUgc,
                  ugcAd: isUgcAd,
                  // Cancels the submit itself; there is no poll here any more to cut short.
                  abortSignal: opts.abortSignal,
                  // Present → talking clip (model-generated voice + lip-sync); absent → silent b-roll.
                  script
                });
                if (submitted) {
                  // Record the handle NOW, before the post row exists. Between here and the insert
                  // are several DB round-trips and an early return on failure — and a submitted
                  // task whose id was never written down is a clip kie renders, charges for, and
                  // nobody ever collects. post_id is attached below once there is one.
                  const { createAdminClient } = await import('$lib/server/supabase-admin');
                  const { enqueueVideoRender } = await import('$lib/server/video-render-queue');
                  videoRenderId = await enqueueVideoRender(createAdminClient(), {
                    brandId,
                    userId,
                    postId: null,
                    threadId: threadId ?? null,
                    submitted
                  });
                  if (videoRenderId) {
                    // The post ships now, carrying the QC'd cover as its media. The reconciler
                    // swaps in the clip and flips content_type when kie is done; until then
                    // video_render_status keeps approve and publish from shipping a photo where a
                    // video was promised.
                    videoRenderPending = submitted;
                    videoThumbnailUrl = mediaUrl ?? null;
                    videoDurationSeconds = submitted.durationSeconds;
                    videoResolution = submitted.resolution;
                    videosUsed = 1;
                  } else {
                    // Nothing is tracking this render, so nothing will ever finish it. Marking the
                    // post `rendering` here would leave it permanently unpublishable and
                    // permanently claiming a clip is on its way. Ship it as a photo instead.
                    videoFallback = true;
                  }
                } else videoFallback = true;
              } else videoFallback = true;
            }
          }

          // Link to current editorial plan week if active
          let planId: string | null = null;
          const plan = await loadActivePlan(supabase, brandId);
          const weekIdx = plan ? currentWeekIndex(plan, brandRow?.timezone ?? tz) : null;
          if (plan?.id && weekIdx != null) {
            const { data: cps } = await supabase
              .from('content_plans')
              .select('id')
              .eq('brand_id', brandId)
              .eq('editorial_plan_id', plan.id)
              .eq('editorial_week', weekIdx)
              .limit(1);
            planId = (cps?.[0]?.id as string | undefined) ?? null;
            if (!planId) {
              const { data: cp } = await supabase
                .from('content_plans')
                .insert({
                  brand_id: brandId,
                  title: `Week ${weekIdx + 1}`,
                  status: 'proposed',
                  source: 'manual_single',
                  editorial_plan_id: plan.id,
                  editorial_week: weekIdx
                })
                .select('id')
                .single();
              planId = (cp?.id as string | undefined) ?? null;
            }
          }

          // Insert post
          const { data: row, error: insErr } = await supabase
            .from('posts')
            .insert({
              brand_id: brandId,
              plan_id: planId,
              platform: targetPlatform,
              content_type: contentTypeOut,
              source: 'manual',
              caption: caption || null,
              image_prompt: imagePrompt,
              image_prompts: imagePrompts,
              media_url: mediaUrl,
              media_urls: mediaUrls,
              video_duration_seconds: videoDurationSeconds,
              // Only write when we have a real kie handle — avoids PostgREST rejecting unknown
              // columns (migration 0127) on every non-video insert.
              ...(videoTaskId
                ? { video_task_id: videoTaskId, video_resolution: videoResolution }
                : {}),
              ...(videoThumbnailUrl ? { video_thumbnail_url: videoThumbnailUrl } : {}),
              // Marks the post as carrying a stand-in cover while the clip renders elsewhere.
              // approve_post and publish read this and refuse, so a post promised as a video can
              // never ship as the photo that is currently in media_url.
              ...(videoRenderPending ? { video_render_status: 'rendering' } : {}),
              // ContentFormat enum value (createSingleContent's 'reel' arg is its own switch).
              format,
              status: 'pending_user'
            })
            .select('id')
            .single();
          if (insErr || !row) return { error: insErr?.message ?? 'insert_failed' };

          // Point the already-recorded render at the post it belongs to. The handle was written
          // before the insert precisely so a failed insert could not lose it.
          if (videoRenderId) {
            const { createAdminClient } = await import('$lib/server/supabase-admin');
            await createAdminClient()
              .from('video_renders')
              .update({ post_id: row.id as string })
              .eq('id', videoRenderId)
              .then(undefined, () => {});
          }

          // Log the composed spec as v1 now that the post has an id — this is what makes a later
          // "change the headline" an edit of this design instead of a fresh composition.
          if (graphicSpec) {
            const { saveGraphicVersion } = await import('$lib/server/design-store');
            await saveGraphicVersion(supabase, {
              brandId,
              userId,
              target: { kind: 'post', id: row.id as string },
              spec: graphicSpec,
              source: graphicSource,
              mediaUrl,
              brief: graphic_brief
            });
            if (media_ids?.length) {
              const { recordBrandMediaUse } = await import('$lib/server/brand-media');
              await recordBrandMediaUse(supabase, brandId, media_ids);
            }
          }

          // Track usage. Only a REAL clip consumes video budget — a cover-image fallback must not,
          // or a failing model would silently eat the brand's monthly video headroom. With the
          // render deferred there is no clip yet either, so the video count moves to the
          // reconciler and is charged when one actually lands.
          await addUsage(supabase, brandId, monthKey(brandRow?.timezone ?? tz), { posts: 1, videos: 0 });
          void videosUsed;

          return {
            success: true,
            post_id: row.id,
            caption,
            media_url: mediaUrl,
            media_urls: mediaUrls ?? undefined,
            platform: targetPlatform,
            content_type: contentTypeOut,
            format,
            slide_count: mediaUrls?.length,
            from_library: fromLibrary,
            ...(graphicSpec
              ? {
                  media_origin: 'typographic_graphic' as const,
                  source_chars: graphicSource.length,
                  source_kind: 'html' as const,
                  ...(graphicWarnings.length ? { design_warnings: graphicWarnings } : {})
                }
              : fromLibrary
                ? { media_origin: 'user_uploaded' as const }
                : contentTypeOut === 'generated_video'
                  ? { media_origin: 'video' as const }
                  : { media_origin: 'ai_generated' as const }),
            video_duration_seconds: videoDurationSeconds ?? undefined,
            // Never let the assistant announce a video we didn't actually produce.
            video_fallback: videoFallback || undefined,
            // The clip is being rendered elsewhere. Say so plainly rather than let the assistant
            // read media_url — currently the cover — and announce a finished video.
            ...(videoRenderPending
              ? {
                  video_render_status: 'rendering' as const,
                  video_note:
                    'The clip is rendering in the background and is NOT ready. media_url is the cover frame, not the video. Tell the user it is being generated and that you will report back when it lands — do not claim the video exists, and do not call this tool again for it.'
                }
              : {}),
            message: isCarousel
              ? `Carosello di ${mediaUrls!.length} slide creato! È nei Contenuti in attesa della tua approvazione.`
              : videoRenderPending
                ? `Post creato: sto generando il video in background, ti avviso appena è pronto.`
                : videoFallback
                  ? `Non sono riuscito a generare il video: il post è pronto come immagine. È nei Contenuti in attesa della tua approvazione.`
                  : videoDurationSeconds
                    ? `Video di ${videoDurationSeconds}s creato! È nei Contenuti in attesa della tua approvazione.`
                    : graphicSpec
                    ? `Post tipografico creato (sorgente HTML/TSX editabile). È nei Contenuti in attesa della tua approvazione.`
                    : fromLibrary
                      ? `Post creato con un asset della Media library (pixel-perfect). È nei Contenuti in attesa della tua approvazione.`
                      : `Post creato! È nei Contenuti in attesa della tua approvazione.`
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : 'create_failed' };
        }
      }
    }),

    generate_image: tool({
      description:
        'Generate or EDIT an AI PHOTO. MEDIA FIRST: call read_media before minting. If a library photo already fits, reuse it (use_library_image for graphics/motion, or media_ids on create_post / design_graphic) — do NOT generate a duplicate. Mint only when nothing uploaded is suitable. Prefer media_ids as fidelity refs when restyling a real asset. Standalone mode (no post_id): new image from a prompt (+ optional media_ids / reference_image_urls / this-turn attachments) — returns image_url, does NOT create or change a post. On a typographic_graphic, WITH or WITHOUT post_id: same mint — returns image_url, does NOT replace the canvas. Then replace_source to put <img src="https://..."> in the HTML/TSX. On a Remotion motion video: same mint, then replace_motion_source <Img src="https://..." />. Call as many times as you need assets. When the user attached a photo (or you pass reference_image_urls / media_ids), that photo is the BASE to edit — e.g. "add the logo" keeps the frame; do NOT call design_graphic for that (it builds a blank typographic canvas). Edit mode (with post_id on an ai_generated photo): regenerates the post image using the prompt as feedback. The official brand-kit logo is ALWAYS attached as a visual reference automatically (no media_ids needed for the logo) — mention lockup/logo in the prompt when it should appear. When the user points at an image ("like this one", "same style as that post"), pass its URL in reference_image_urls. If credits are exhausted, explain and call offer_upgrade — do not retry.',
      inputSchema: z.object({
        prompt: z.string().describe('Description of the image to generate'),
        post_id: z.string().optional().describe('If provided, regenerates this post\'s image using the prompt as feedback'),
        aspect_ratio: z.enum(['1:1', '4:5', '9:16', '16:9']).optional().describe('Aspect ratio (default: 1:1 for standalone, platform-based for post edit)'),
        media_ids: z
          .array(z.string())
          .optional()
          .describe('Brand Media library ids to attach as fidelity references (from read_media)'),
        people_ids: z
          .array(z.string())
          .optional()
          .describe('Brand people ids from read_people — face refs the renderer sees.'),
        talent_ids: z
          .array(z.string())
          .optional()
          .describe('AI talent ids from read_talents — face/body refs.'),
        reference_image_urls: z
          .array(z.string())
          .optional()
          .describe(
            'Image URLs handed to the renderer as visual references: fetch_social_thumbs, market thumbnail_url, a post media_url, or attachments. Max 4, https only.'
          )
      }),
      execute: async (
        {
          prompt,
          post_id,
          aspect_ratio,
          media_ids,
          people_ids,
          talent_ids,
          reference_image_urls
        }: {
          prompt: string;
          post_id?: string;
          aspect_ratio?: string;
          media_ids?: string[];
          people_ids?: string[];
          talent_ids?: string[];
          reference_image_urls?: string[];
        },
        opts: ToolExecutionOptions<unknown>
      ) => {
        const {
          resolvePeopleVisualRefsDetailed,
          resolveTalentVisualRefs
        } = await import('$lib/server/design-visual-refs');
        // The likeness gate refuses rather than silently degrades: generating a real person without
        // their recorded consent is the one failure here the user must hear about, not discover.
        const peopleRefs = await resolvePeopleVisualRefsDetailed(supabase, brandId, people_ids);
        if (peopleRefs.blocked.length) {
          return {
            error: `Likeness consent missing for: ${peopleRefs.blocked.join(', ')}. A real person's face can only be generated once their consent is recorded on their card in Studio → People. Tell the user which person is blocked and why — this is an AI Act / image-rights requirement, not a bug.`,
            consent_blocked: peopleRefs.blocked
          };
        }
        const peopleTalent = [
          ...peopleRefs.refs.map((r) => r.url),
          ...(await resolveTalentVisualRefs(supabase, talent_ids)).map((r) => r.url)
        ];
        // References the renderer will actually SEE: what the model picked out of the conversation,
        // plus whatever the user attached to this turn. Model-supplied URLs are fetched server-side,
        // so they go through the same SSRF guard as any other outside URL.
        //
        // ATTENZIONE PRIMA DI TOCCARE QUESTO `.slice` — E PRIMA DI RIMETTERNE UNO "per sicurezza".
        //
        // Il difetto qui non è il numero 4: è che il taglio è MUTO e che l'ordine dell'array decide
        // che cosa muore per primo. Gli URL del modello vengono prima, i volti dopo — quindi con 3
        // URL e 3 persone restano i 3 URL più un volto, e due volti spariscono senza una parola.
        // Sono esattamente i volti su cui, dieci righe più su, `peopleRefs.blocked` ha appena
        // rifiutato di generare una persona reale senza consenso registrato, citando l'AI Act.
        // Fare un controllo serio su un dato e poi buttarlo via in silenzio È il difetto: chi
        // reintroduce uno `slice` qui riapre quello, non "mette un limite".
        //
        // Il tetto vero NON è nemmeno questo 4, e non è 12: è `KIE_IMAGE_INPUT_MAX` (8) in
        // `kie-jobs.ts`, perché kie è la rotta di default e conta TUTTE le parti inline — il logo
        // del brand (sempre allegato), la base in modalità modifica, e fino a 3 mood. Quello che
        // resta davvero all'utente è 3–6, non 4 e non 12. Alzare il numero qui senza alzare quello
        // sposta soltanto il taglio muto un livello più in giù, dove nessuno lo guarda.
        //
        // Nota per chi riscrive l'ordine: `referenceUrls[0]` non è solo "il primo riferimento" —
        // in `generateStandaloneImage` diventa la BASE da modificare. Mettere i volti davanti
        // renderebbe la foto di una persona la base di ogni "aggiungi il logo a questa foto".
        // I due problemi (priorità nel taglio, scelta della base) vanno sciolti insieme.
        const referenceUrls = [
          ...(reference_image_urls ?? []).filter((u) => typeof u === 'string' && isUrlSafe(u)),
          ...peopleTalent,
          ...turnRefUrls
        ].slice(0, 4);
        const { data: brandForBudget } = await supabase
          .from('brands')
          .select('plan, timezone, activated_at, status')
          .eq('id', brandId)
          .maybeSingle();
        const budget = await remaining(
          supabase,
          brandId,
          brandForBudget?.plan,
          brandForBudget?.timezone ?? tz,
          brandForBudget
            ? {
                id: brandId,
                plan: brandForBudget.plan ?? null,
                activated_at: brandForBudget.activated_at ?? null,
                status: brandForBudget.status ?? 'active'
              }
            : undefined
        );
        const gate = gateToolCall('generate_image', budget);
        if (gate) return gate;

        // Edit existing post image
        if (post_id) {
          const { data: post } = await supabase
            .from('posts')
            .select('id, brand_id, platform, caption, image_prompt, media_url, media_urls, content_type, format, product_name, status')
            .eq('id', post_id)
            .eq('brand_id', brandId)
            .maybeSingle();
          if (!post) return { error: 'Post not found' };
          if (post.content_type === 'text' || post.content_type === 'link') return { error: 'Cannot generate image for text-only posts' };

          if (isVideoPostRow(post)) {
            return {
              error: 'is_video',
              message:
                'This post is a VIDEO/reel. generate_image would replace the clip with a still. Do NOT call design_graphic either — that deletes the mp4. Remake the reel with create_post(content_type:"video") for a new draft, or open the post editor and call make_video (script + ugc:true) to remake this one.',
              action: null
            };
          }

          const { latestGraphic } = await import('$lib/server/design-store');
          const graphic = await latestGraphic(supabase, { kind: 'post', id: post_id });
          if (graphic || post.content_type === 'generated_graphic') {
            try {
              const result = await generateStandaloneImage({
                supabase,
                userId,
                brandId,
                prompt,
                aspectRatio: (aspect_ratio as '1:1' | '4:5' | '9:16' | '16:9') ?? undefined,
                mediaIds: media_ids,
                referenceUrls
              });
              if (!result.imageUrl) return { error: 'Generazione immagine fallita. Riprova.' };
              return {
                success: true,
                image_url: result.imageUrl,
                did_not_change_post: true,
                graphic_post_id: post_id,
                notes: result.notes,
                qc_score: result.qc?.score,
                qc_pass: result.qc?.pass,
                hint: GRAPHIC_ASSET_MINT_HINT
              };
            } catch (e) {
              return { error: e instanceof Error ? e.message : 'generate_failed' };
            }
          }

          // Load brand visual context
          const [{ data: kit }, { data: brandRow }] = await Promise.all([
            supabase.from('brand_kit').select('visual_style, brand_colors, fonts').eq('brand_id', brandId).maybeSingle(),
            supabase.from('brands').select('content_prefs').eq('id', brandId).maybeSingle()
          ]);
          const prefs = (brandRow?.content_prefs as AnyRec) ?? {};
          const moodImageUrls = await loadBrandMoodImageUrls(supabase, brandId);

          let productImageUrls: string[] = [];
          if (post.product_name) {
            const { data: prod } = await supabase.from('products').select('images').eq('brand_id', brandId).eq('title', post.product_name).maybeSingle();
            if (Array.isArray(prod?.images)) productImageUrls = prod.images.map(String).filter(Boolean);
          }

          const libraryRefUrls = media_ids?.length
            ? await (await import('$lib/server/brand-media')).resolveBrandImageIds(supabase, brandId, media_ids)
            : [];

          try {
            const r = await regeneratePost({
              supabase,
              userId,
              brandId,
              platform: post.platform,
              caption: post.caption,
              imagePrompt: post.image_prompt,
              feedback: prompt,
              textOnly: false,
              baseImageUrl: post.media_url,
              visualStyle: kit?.visual_style ?? null,
              brandColors: Array.isArray(kit?.brand_colors) ? (kit!.brand_colors as string[]) : null,
              brandFonts: Array.isArray(kit?.fonts) ? (kit!.fonts as AnyRec[]).map((f) => f?.name).filter(Boolean) : null,
              productImageUrls,
              moodImageUrls,
              userReferenceImageUrls: [...libraryRefUrls, ...referenceUrls].slice(0, 4),
              language: prefs.language ?? null,
              platformInstructions: prefs.platformInstructions ?? null,
              platformHashtags: prefs.platformHashtags ?? null
            });

            // Update the post with new image
            const updatePatch: AnyRec = {};
            if (r.imageUrl) {
              updatePatch.media_url = r.imageUrl;
              // Su un carosello la cover è SIA media_url SIA media_urls[0], e il publish legge
              // media_urls (mediaUrlsForPublish): aggiornare solo media_url lasciava la cover
              // nuova visibile in chat mentre le slide vecchie andavano in pubblicazione.
              const slides = Array.isArray((post as AnyRec).media_urls)
                ? ((post as AnyRec).media_urls as unknown[]).map(String).filter(Boolean)
                : [];
              if (slides.length) updatePatch.media_urls = [r.imageUrl, ...slides.slice(1)];
            }
            if (r.imagePrompt) updatePatch.image_prompt = r.imagePrompt;
            if (r.caption) updatePatch.caption = r.caption;
            if (r.imageUrl) updatePatch.content_type = 'generated_image';

            if (Object.keys(updatePatch).length) {
              await supabase.from('posts').update(updatePatch).eq('id', post_id).eq('brand_id', brandId);

              // If post was scheduled, re-sync with Zernio
              if (post.status === 'scheduled') {
                await requireZernioCancellation(supabase, post_id);
                const { data: updated } = await supabase.from('posts').select(EDITOR_POST_COLS).eq('id', post_id).maybeSingle();
                if (updated) {
                  try {
                    await publishApprovedPost(supabase, updated as ApprovablePost, tz);
                  } catch { /* best-effort */ }
                }
              }
            }

            return {
              success: true,
              post_id: post.id,
              platform: post.platform,
              caption: r.caption ?? post.caption,
              media_url: r.imageUrl ?? post.media_url,
              image_url: r.imageUrl ?? post.media_url,
              status: post.status,
              updated: Object.keys(updatePatch)
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : 'generate_failed' };
          }
        }

        // Standalone image generation
        try {
          const result = await generateStandaloneImage({
            supabase,
            userId,
            brandId,
            prompt,
            aspectRatio: (aspect_ratio as '1:1' | '4:5' | '9:16' | '16:9') ?? undefined,
            mediaIds: media_ids,
            referenceUrls
          });
          if (!result.imageUrl) return { error: 'Generazione immagine fallita. Riprova.' };
          // qc comes from the fixed renderWithQC pipeline; the image agent replaces it with `notes`
          // (what it tried and changed), which says more than a score. Whichever path ran, report
          // what it produced — both are optional, so neither path shows an empty field.
          return {
            success: true,
            image_url: result.imageUrl,
            did_not_change_post: true,
            notes: result.notes,
            qc_score: result.qc?.score,
            qc_pass: result.qc?.pass,
            hint: STANDALONE_IMAGE_HINT
          };
        } catch (e) {
          return { error: e instanceof Error ? e.message : 'generate_failed' };
        }
      }
    }),

    design_graphic: tool({
      description: [
        'Compose or REVISE a post\'s typographic graphic from HTML/CSS (or React TSX) source — words on a brand-coloured canvas, optionally with embedded photos.',
        'Use when read_posts shows media_origin typographic_graphic, or when the visual should CARRY WORDS (quote, stat, tip list, price, claim) with or without a photo inside.',
        'Pass media_ids / people_ids / talent_ids / image_urls so image blocks can embed those photos. MEDIA FIRST: read_media; if a library photo fits, pass media_ids or use_library_image then replace_source. generate_prompt mints one Nano Banana Pro still (credits) as background / in-stack — only when nothing uploaded fits. Prefer generate_image (N times) then replace_source <img src="https://...">, or pass those image_urls here.',
        'Brand kit logo/favicon are auto-included as AVAILABLE IMAGES ("brand logo") — ask for the official mark in the brief; never fake it with an icon or typed name.',
        'If the user attached a photo and only wants the logo / a light edit ON that photo, use generate_image instead — design_graphic would rebuild a blank canvas.',
        'NEVER use this on a VIDEO/reel to remove subtitles or rewrite a spoken script — that deletes the clip. Remake with create_post(content_type:"video") or the post-editor make_video tool. convert_from_video:true only if they explicitly asked to turn the reel into a still graphic.',
        'For other-brand visual refs: fetch_social_thumbs or read_market_references → image_urls.',
        'Do NOT use generate_image to REPLACE a typographic graphic. On a graphic, generate_image (with or without post_id) mints an asset and returns image_url without changing the post — then replace_source <img src>. Or pass image_urls / generate_prompt on this tool.',
        'For a copy/color/spacing patch on an existing graphic, prefer grep_source → read_source → replace_source (pass post_id). write_source only to rebuild. Use this tool for a first composition or a high-level restyle.'
      ].join('\n'),
      inputSchema: z.object({
        post_id: z.string().describe('Post whose visual to compose or revise'),
        brief: z
          .string()
          .describe('What the graphic should say — or, when one already exists, what to change. Include exact numbers/quotes/prices when they matter.'),
        slide_index: z
          .number()
          .int()
          .optional()
          .describe('Carousel only: which slide (0 = cover). Omit for a single-image post.'),
        media_ids: z.array(z.string()).optional().describe('Media library ids to embed as photos inside the graphic.'),
        people_ids: z.array(z.string()).optional().describe('Brand people ids from read_people.'),
        talent_ids: z.array(z.string()).optional().describe('AI talent ids from read_talents.'),
        image_urls: z
          .array(z.string())
          .optional()
          .describe('Extra https image URLs (social thumbs, market refs, prior generate_image).'),
        generate_prompt: z
          .string()
          .optional()
          .describe(
            'Mint one Nano Banana Pro photo (bills credits) and offer it as an image block / background inside this graphic. Use when the canvas needs a new scene, product, or texture that is not in the Media library.'
          ),
        convert_from_video: z
          .boolean()
          .optional()
          .describe(
            'Set true ONLY when the user explicitly asked to turn this VIDEO into a still graphic. Omit otherwise — without it, design_graphic refuses on reels.'
          )
      }),
      execute: async ({
        post_id,
        brief,
        slide_index,
        media_ids,
        people_ids,
        talent_ids,
        image_urls,
        generate_prompt,
        convert_from_video
      }: {
        post_id: string;
        brief: string;
        slide_index?: number;
        media_ids?: string[];
        people_ids?: string[];
        talent_ids?: string[];
        image_urls?: string[];
        generate_prompt?: string;
        convert_from_video?: boolean;
      }) => {
        const { data: post } = await supabase
          .from('posts')
          .select('id')
          .eq('id', post_id)
          .eq('brand_id', brandId)
          .maybeSingle();
        if (!post) return { error: 'Post not found' };
        const { loadEditorContext, designPostGraphic } = await import('$lib/server/chat/post-editor-tools');
        const ctx = await loadEditorContext(supabase, brandId);
        return compactGraphicPersist(
          await designPostGraphic(
            { supabase, brandId, postId: post_id, tz, userId, ctx, refUrls: turnRefUrls },
            { brief, slide_index, media_ids, people_ids, talent_ids, image_urls, generate_prompt, convert_from_video }
          )
        );
      }
    }),
  };
}
