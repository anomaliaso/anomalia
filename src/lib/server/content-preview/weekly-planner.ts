// Editorial-plan preview for onboarding: LLM plans N posts → an image each → Storage.
// IMAGES ONLY — a real clip costs ~25x an image, so video is a PAID feature rendered in the
// generate endpoint and never here: a free user can't incur video cost. Video-FORMAT seeds still
// get a strong cover, which the paid path animates.

import { swallow } from '$lib/server/swallow';
import { PRODUCT_REF_IMAGES, aspectRatioFor, brandOfferings, brandVisualDirective, extractVisualPlaybook, fetchLogoPart, loadMoodRefs, loadProductRefs, markProduceApproved, personImageMap, personReference, referenceModeFor, renderCarouselSlide, renderWithQC, resolveOffering, uploadPostImage } from './images';
import { type CaptionKnowledgeCtx, executePlan } from './caption-quality';
import { client, planStrategy, warnOnSceneCollapse } from './plan-pipeline';
import { type AnyRec, type BrandProfile, type ContentPrefs, type ImagePart, type PastWinner, type PostSeed, type PreviewPost, type Progress, VISUAL_REQUIRED, type WeeklyStrategy, carouselMaxPerBatch, clampCarousels, clampMediaCapabilities, clampVideos, platformKey } from './seed-model';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { synthesizeVisualStyle } from '$lib/server/brand-context';
import { route } from '$lib/server/model-routing';
import { upcomingTimelyHooks } from '$lib/server/thematic-calendar';
import { normalizeContentFormat } from '$lib/content-formats';
import { type LadderContext } from '$lib/server/production-ladder';
import { type Rubric } from '$lib/server/rubrics';
import { loadKnownSubreddits } from '$lib/server/platform-hygiene';

// Options shared by the planning and rendering halves. Splitting them lets a caller run the cheap
// text planning in one request and the heavy image rendering in another (see onboarding), so no
// single serverless invocation has to carry the whole pipeline and risk a timeout.
type PlanPreviewOpts = {
  platforms: string[];
  prefs?: ContentPrefs;
  // Internal video guardrail: cap on how many of the planned posts may be a video format.
  // Absent → 0 (no videos), keeping today's image/text-only behaviour for existing callers.
  maxVideos?: number;
  // Carousel guardrail: cap on how many of the planned posts may be carousels. Absent → 0, so
  // paths that never opted in (onboarding preview, radar) can't plan multi-image posts; the
  // batch paths pass carouselMaxPerBatch() (env CAROUSEL_MAX_PER_BATCH, default 1).
  maxCarousels?: number;
  // The brand's approved rubrics. Absent/empty (every brand that hasn't adopted them) → the
  // planner prompt, schema and seeds are exactly the pre-rubric ones.
  rubrics?: Rubric[];
  // Real top-performing past posts (caption + metrics) to ground the week's strategy in what
  // has actually worked. Absent (e.g. onboarding, before any history) → the strategist relies
  // on the synthesised ai_context brief alone.
  topPosts?: PastWinner[];
  // Optional competitive/strategy brief from the research pipeline (white-space + recommended
  // angles). Steers the batch toward market openings; absent → plain voice/history planning.
  strategyBrief?: string;
  // Competitor top-post thumbnail URLs (loadCompetitorThumbUrls) — the strategist's anti-moodboard.
  competitorThumbUrls?: string[];
  // Weekly market format/hook catalog (loadMarketBrief) — structural inspiration, not visuals.
  marketBrief?: string;
  // Radar subreddits (brand_news_sources). Absent → draftWeekSeeds loads when supabase+brandId set.
  knownSubreddits?: string[];
  // Pre-computed upcomingTimelyHooks() output. undefined → planStrategy computes it; a string
  // (even '' = "computed, nothing relevant") → reused as-is, avoiding a duplicate calendar call.
  calendarHooks?: string;
  // Week planner agent — default ON; WEEK_PLANNER_AGENT_ENABLED=false → legacy planStrategy.
  supabase?: SupabaseClient;
  brandId?: string;
  userId?: string;
  weekIndex?: number;
  timezone?: string;
  agentVerbose?: boolean;
  /**
   * Which angles have earned real production, from the brand's own history. Decides WHICH clips
   * survive the video cap — see `production-ladder.ts`. Omit and the cap keeps plan order, exactly
   * as before.
   */
  ladder?: LadderContext;
  onProgress?: Progress;
  /** Wall-clock for the week-planner agent. Absent → 200s (HTTP). Autopilot worker passes 1h. */
  deadlineMs?: number;
};
type RenderPreviewOpts = {
  supabase: SupabaseClient;
  userId: string;
  brandId?: string;
  onProgress?: Progress;
  onPost: (post: PreviewPost) => void;
};

// Downgrade every video-format entry past the cap to a plain image post. Shared by the one-shot
// pipeline (on posts) and the row-level editorial flow (on seeds, then again on edited posts).
// shape — rows have been through the DB and the editing grid. Drops rows with no platform.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeWeeklyStrategy(raw: any): WeeklyStrategy {
  const rawSeeds = Array.isArray(raw?.seeds) ? raw.seeds : [];
  const seeds: PostSeed[] = rawSeeds
    .map((s: AnyRec) => {
      const primary = String(s?.platform ?? '').toLowerCase().trim();
      const extra = (Array.isArray(s?.platforms) ? s.platforms : [])
        .map((p: unknown) => String(p ?? '').toLowerCase().trim())
        .filter((p: string) => p && p !== primary);
      const format = normalizeContentFormat(s?.format);
      const isVideo = format === 'video' || s?.media === 'video';
      return clampMediaCapabilities({
        // Keep an existing row id so the post→row reference stays STABLE across loads/saves; mint
        // one when missing. This is the single place row ids are derived.
        id: (typeof s?.id === 'string' && s.id) || crypto.randomUUID(),
        platform: primary,
        platforms: [primary, ...new Set(extra)].filter(Boolean),
        pillar: String(s?.pillar ?? ''),
        // Stored rows carry legacy free-form formats ('reel', 'story', 'short video'…) — always
        // mapped onto the enum here, the single rehydration point. Unknown values → single_image.
        format,
        slide_count: Number(s?.slide_count) || undefined,
        // La storia e il medium sopravvivono al giro in DB e alla griglia di editing: senza,
        // l'utente approva un racconto e il produttore riceve una riga di angle.
        beats: Array.isArray(s?.beats) ? s.beats.map((b: unknown) => String(b ?? '').trim()).filter(Boolean) : undefined,
        art_direction: String(s?.art_direction ?? '').trim() || undefined,
        // Rubric linkage survives store/edit round-trips untouched (resolution happened at plan time).
        rubric: typeof s?.rubric === 'string' && s.rubric ? s.rubric : undefined,
        rubric_id: typeof s?.rubric_id === 'string' && s.rubric_id ? s.rubric_id : undefined,
        media:
          s?.media === 'text'
            ? ('text' as const)
            : s?.media === 'link'
              ? ('link' as const)
              : isVideo
                ? ('video' as const)
                : ('image' as const),
        // UGC spoken script — must survive DB round-trips or generate renders silent clips.
        ...(isVideo
          ? {
              ugc: s?.ugc !== false,
              ugc_ad: s?.ugc_ad === true || s?.ugcAd === true,
              hook: String(s?.hook ?? '').trim(),
              hook_visual: String(s?.hook_visual ?? '').trim(),
              hook_text: String(s?.hook_text ?? '').trim(),
              body: String(s?.body ?? '').trim(),
              cta: String(s?.cta ?? '').trim()
            }
          : {}),
        day: String(s?.day ?? ''),
        time: String(s?.time ?? ''),
        // Reddit fields + the page URL for caption/link posts — carried through so an edited or
        // reloaded row keeps its title, subreddit and link (the clamp then drops a link where unusable).
        title: String(s?.title ?? ''),
        subreddit: String(s?.subreddit ?? ''),
        link_url: String(s?.link_url ?? ''),
        product: String(s?.product ?? ''),
        person: String(s?.person ?? ''),
        angle: String(s?.angle ?? ''),
        subject: String(s?.subject ?? ''),
        setting: String(s?.setting ?? ''),
        props: String(s?.props ?? ''),
        media_id: String(s?.media_id ?? s?.mediaId ?? '').trim() || undefined,
        media_mode:
          s?.media_mode === 'composite' || s?.mediaMode === 'composite'
            ? 'composite'
            : s?.media_id || s?.mediaId
              ? 'use_as_is'
              : undefined
      });
    })
    .filter((s: PostSeed) => s.platform);
  return {
    theme: String(raw?.theme ?? ''),
    rationale: String(raw?.rationale ?? ''),
    doDont: String(raw?.doDont ?? raw?.do_dont ?? ''),
    seeds
  };
}

// PASS 1 ONLY, exported for the row-level editorial plan: decide the week's strategy and return
// its seeds (one row per planned post: when/platform/format/angle/subject) WITHOUT writing any
// caption or rendering anything. The user reviews and edits these rows; executeWeekStrategy
// turns the approved rows into real posts. Video guardrail is clamped on the seeds themselves so
// the user never approves rows the budget can't honour.

/** Low-level seed draft — used by the week-planner agent's draft_seeds tool. */
export async function draftWeekSeeds(
  profile: BrandProfile,
  opts: PlanPreviewOpts,
  count: number,
  briefOverride?: string
): Promise<WeeklyStrategy> {
  const ai = client();
  const maxVideos = Math.max(0, opts.maxVideos ?? 0);
  const maxCarousels = Math.max(0, opts.maxCarousels ?? 0);
  let knownSubreddits = opts.knownSubreddits ?? [];
  if (
    !knownSubreddits.length &&
    opts.supabase &&
    opts.brandId &&
    (opts.platforms ?? []).some((p) => platformKey(p) === 'reddit')
  ) {
    knownSubreddits = await loadKnownSubreddits(opts.supabase, opts.brandId);
  }
  return planStrategy(
    ai,
    profile,
    opts.platforms ?? [],
    count,
    opts.prefs ?? {},
    maxVideos,
    opts.topPosts ?? [],
    briefOverride ?? opts.strategyBrief ?? '',
    opts.competitorThumbUrls ?? [],
    opts.calendarHooks,
    maxCarousels,
    opts.rubrics ?? [],
    opts.marketBrief ?? '',
    knownSubreddits,
    opts.ladder
  );
}

async function invokeWeekPlannerAgent(
  profile: BrandProfile,
  opts: PlanPreviewOpts,
  count: number
): Promise<WeeklyStrategy | null> {
  const { weekPlannerAgentEnabled, runWeekPlannerAgent } = await import('$lib/server/week-planner-agent');
  if (!weekPlannerAgentEnabled() || !opts.supabase || !opts.brandId) return null;
  // null → both call sites fall through to the legacy planStrategy. Same contract as
  // invokeEditorialAgent: a failed agent degrades, it does not break weekly generation.
  try {
    const result = await runWeekPlannerAgent({
      supabase: opts.supabase,
      userId: opts.userId,
      brandId: opts.brandId,
      profile,
      platforms: opts.platforms ?? [],
      count,
      weekIndex: opts.weekIndex,
      prefs: opts.prefs,
      maxVideos: opts.maxVideos,
      maxCarousels: opts.maxCarousels,
      topPosts: opts.topPosts,
      strategyBrief: opts.strategyBrief,
      competitorThumbUrls: opts.competitorThumbUrls,
      marketBrief: opts.marketBrief,
      calendarHooks: opts.calendarHooks,
      rubrics: opts.rubrics,
      timezone: opts.timezone,
      verbose: opts.agentVerbose,
      deadlineMs: opts.deadlineMs
    });
    return result.strategy;
  } catch (e) {
    console.warn('[week-planner] agent failed, falling back to legacy planStrategy:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function planWeekStrategy(
  profile: BrandProfile,
  opts: PlanPreviewOpts,
  count = 3
): Promise<WeeklyStrategy> {
  const maxVideos = Math.max(0, opts.maxVideos ?? 0);
  const agentStrategy = await invokeWeekPlannerAgent(profile, opts, count);
  if (agentStrategy) {
    clampVideos(agentStrategy.seeds, maxVideos);
    return agentStrategy;
  }
  opts.onProgress?.('planning', 'Studying what works and setting this week’s angle…');
  const strategy = await draftWeekSeeds(profile, opts, count);
  clampVideos(strategy.seeds, maxVideos);
  return strategy;
}

// PASS 2 ONLY, exported for the row-level editorial plan: turn the (possibly user-edited) seeds
// into final posts — captions + image_prompts, no images yet. Re-clamps videos because edited
// rows may have introduced video formats the plan's budget can't cover.
export async function executeWeekStrategy(
  profile: BrandProfile,
  strategy: WeeklyStrategy,
  prefs: ContentPrefs = {},
  maxVideos = 0,
  // Carousel guardrail re-applied on execution because edited/stored rows may carry carousels the
  // batch budget can't cover. Clamped on the SEEDS (before Pass 2) so the slide prompts are only
  // ever written for carousels that will actually render.
  maxCarousels = 0,
  knowledge?: CaptionKnowledgeCtx,
  // Which angles have earned real production. Optional: without it the clamp keeps whichever clips
  // came first, exactly as before — the ladder engages only where the brand's history is already in
  // hand, so nothing here pays for an extra query.
  ladder?: LadderContext
): Promise<PreviewPost[]> {
  const ai = client();
  // Defensive re-normalisation: some callers (the CLI produce route) pass seeds straight from the
  // DB without going through normalizeWeeklyStrategy — legacy formats and edited rows land here.
  // Idempotent for already-normalised input (row ids are preserved).
  const normalized = normalizeWeeklyStrategy(strategy);
  clampCarousels(normalized.seeds, Math.max(0, maxCarousels));

  // Produce agent loop (Grok 4.5): research → justified captions/image briefs → render → multimodal
  // reviewer → retry up to 4× with the same conversation. Default ON; PRODUCE_AGENT_ENABLED=false → legacy.
  if (knowledge?.supabase && knowledge?.brandId && knowledge?.userId) {
    try {
      const { produceAgentEnabled, runProduceAgentLoop } = await import('$lib/server/produce-agent');
      if (produceAgentEnabled()) {
        const agented = await runProduceAgentLoop({
          supabase: knowledge.supabase,
          userId: knowledge.userId,
          brandId: knowledge.brandId,
          profile,
          strategy: normalized,
          prefs,
          maxVideos,
          maxCarousels,
          timezone: knowledge.timezone,
          strategyBrief: knowledge.strategyBrief,
          topPosts: knowledge.topPosts,
          onProgress: knowledge.onProgress
        });
        if (agented?.posts?.length) {
          clampVideos(agented.posts, Math.max(0, maxVideos));
          return markProduceApproved(warnOnSceneCollapse(agented.posts), !!agented.approved);
        }
        console.warn('[executeWeekStrategy] produce agent returned null — falling back to legacy executePlan');
      }
    } catch (e) {
      console.warn(
        '[executeWeekStrategy] produce agent failed, legacy fallback:',
        e instanceof Error ? e.message : e
      );
    }
  }

  const posts = await executePlan(ai, profile, normalized, prefs, knowledge);
  clampVideos(posts, Math.max(0, maxVideos), ladder);
  return markProduceApproved(warnOnSceneCollapse(posts), false);
}

// PLAN ONLY: the two text passes (strategy → captions + image_prompt) plus the video clamp. Returns
// the posts WITHOUT images. This is LLM-text work only — quick relative to rendering — so it can run
// in its own short request, decoupled from the (slow, parallel) image generation below.
export async function planPreviewPosts(
  profile: BrandProfile,
  opts: PlanPreviewOpts,
  count = 3
): Promise<PreviewPost[]> {
  const maxVideos = Math.max(0, opts.maxVideos ?? 0);
  const maxCarousels = Math.max(0, opts.maxCarousels ?? 0);

  // PASS 1: set the week's angle and break it into deliberate, spread-out seeds.
  opts.onProgress?.('planning', 'Aligning this batch with your editorial plan…');
  const agentStrategy = await invokeWeekPlannerAgent(profile, opts, count);
  const strategy =
    agentStrategy ??
    (await draftWeekSeeds(profile, opts, count));

  // PASS 2: captions + image briefs (produce-agent loop by default when userId is present).
  opts.onProgress?.('writing', `Writing ${strategy.seeds.length} captions…`);
  const posts = await executeWeekStrategy(profile, strategy, opts.prefs ?? {}, maxVideos, maxCarousels, {
    supabase: opts.supabase,
    brandId: opts.brandId,
    userId: opts.userId,
    timezone: opts.timezone,
    strategyBrief: opts.strategyBrief,
    topPosts: opts.topPosts,
    onProgress: opts.onProgress
  }, opts.ladder);
  opts.onProgress?.('captions_ready', `Captions ready — preparing images…`);

  // Hard-clamp the guardrail: the strategist may ignore the prompt and over-produce videos, so we
  // downgrade every video-format post past the cap to a strong single image. With a ladder context
  // the clips whose ANGLE has earned the spend keep their format and the unproven ones become the
  // statics; without one we keep plan order. Either way the brand still gets a full plan, just
  // fewer (expensive) clips than the model wanted.
  clampVideos(posts, maxVideos, opts.ladder);
  return posts;
}

// RENDER ONLY: take already-planned posts and render + upload each image in parallel, emitting each
// post (imageUrl set when rendering succeeds) via onPost. Builds the shared render context (offerings,
// people, visual style, brand look, logo) once per batch from the profile, so this is a faithful,
// stateless continuation of planPreviewPosts — runnable in a separate request.
export async function renderPreviewImages(
  profile: BrandProfile,
  posts: PreviewPost[],
  opts: RenderPreviewOpts
): Promise<void> {
  const ai = client();

  opts.onProgress?.('generating', `Generating images for ${posts.length} posts…`);

  const offeringList = brandOfferings(profile);
  const personImages = personImageMap(profile);
  const siteType = String(profile?.site_type ?? 'generic');
  let doneCount = 0;

  // Person name → "gender, ageRange" descriptor for the QC gate: an image whose person presents
  // as the wrong gender/age must FAIL QC, not slip through on composition alone.
  const personAttrsMap = new Map<string, string>();
  for (const p of (Array.isArray(profile?.people) ? profile.people : []) as AnyRec[]) {
    const name = String(p?.name ?? '').toLowerCase().trim();
    const a = p?.attributes ?? {};
    const desc = [a?.gender, a?.ageRange].filter(Boolean).join(', ');
    if (name && desc) personAttrsMap.set(name, desc);
  }

  // Visual anchor: prefer the history-derived visual_style; if absent (e.g. a brand-new brand with
  // no scraped posts), synthesise a BASELINE from the brand's own site images + colours so the very
  // first posts are already on-brand instead of free-styled.
  let visualStyle = profile?.visual_style as string | undefined;
  if (!visualStyle && Array.isArray(profile?.images) && profile.images.length) {
    visualStyle =
      (await synthesizeVisualStyle(ai, profile.images, { brandColors: profile?.brand_colors, archetype: profile?.site_type }).catch((error) => { swallow('synthesize visual style', error); return ''; })) || undefined;
  }
  // Concrete palette/typography directive enforced on every render (stops off-brand graphics).
  const brandLook = brandVisualDirective(profile?.brand_colors, (profile?.fonts ?? []).map((f: AnyRec) => f?.name).filter(Boolean));

  // Performance-mined visual directives: synthesizeVisualPlaybook folds a "WHAT WORKS VISUALLY"
  // block into ai_context for the copywriter — surface that SAME block to the image renderer,
  // which otherwise never sees it (the strongest visual signal we have was text-only).
  const visualPlaybook = extractVisualPlaybook(profile?.ai_context);

  // The brand's real logo (rasterised if SVG), fed as a reference on branded/graphic posts so the
  // model reproduces the ACTUAL logo instead of inventing a wordmark. Loaded once for the batch.
  // Skip 'og-image' logos — those are site screenshots/banners, not the brand mark.
  const logoUrl = (Array.isArray(profile?.logos) ? profile.logos : [])
    .find((l: AnyRec) => l?.url && l?.type !== 'og-image')?.url as string | undefined;
  const logoPart = logoUrl ? await fetchLogoPart(logoUrl) : null;

  // The brand's own reference shots (Studio → Knowledge → Images), attached to every render as
  // pure STYLE/MOOD anchors so generated photos share the brand's aesthetic. Loaded once per batch.
  const moodImages = await loadMoodRefs(profile?.moodImages as string[] | undefined);

  // Generate every image in parallel; emit each post the moment it's ready.
  // Text-only posts (X/Threads) skip image generation entirely — no render, no cost.
  // Platforms that require a visual are force-flipped to image even if the planner marked them text.
  await Promise.all(
    posts.map(async (post) => {
      // Already rendered (e.g. produce-agent review loop) — emit as-is, skip Nano Banana.
      if (post.imageUrl || (post.imageUrls && post.imageUrls.length > 0)) {
        opts.onPost(post);
        return;
      }
      const plat = String(post.platform ?? '').toLowerCase();
      if (VISUAL_REQUIRED.has(plat) && post.media !== 'image' && post.media !== 'video') {
        post.media = 'image';
        if (post.format === 'text_post' || post.format === 'link_post') post.format = 'single_image';
      }
      // Safety net: an image post without a prompt still needs a scene to render.
      if (post.media !== 'text' && post.media !== 'link' && !String(post.image_prompt ?? '').trim()) {
        const productBit = post.product ? `featuring ${post.product}` : 'on-brand';
        post.image_prompt = `Photorealistic, scroll-stopping social photo ${productBit} for ${profile?.name || 'the brand'}. ${post.caption ? `Mood matching: ${String(post.caption).slice(0, 120)}` : ''}`.trim();
      }
      if (post.media !== 'text' && post.media !== 'link' && post.image_prompt) {
        try {
          // Pixel-perfect reuse of a Media library asset — skip Nano Banana entirely.
          if (post.mediaId && post.mediaMode !== 'composite' && opts.brandId) {
            const { publishLibraryImageAsPostMedia } = await import('$lib/server/brand-media');
            const published = await publishLibraryImageAsPostMedia(opts.supabase, {
              brandId: opts.brandId,
              userId: opts.userId,
              mediaId: post.mediaId,
              platform: post.platform
            });
            if ('publicUrl' in published) {
              post.imageUrl = published.publicUrl;
              (post as AnyRec).__fromLibrary = post.mediaId;
              opts.onPost(post);
              return;
            }
            // Fall through to generation if publish failed.
            console.warn('[renderPreviewImages] library publish failed:', 'error' in published ? published.error : '');
          }

          const featured = resolveOffering(post.product, offeringList);
          const [productRefs, personRefs, libraryRefs] = await Promise.all([
            loadProductRefs(featured?.images),
            personReference(post, personImages),
            post.mediaId && post.mediaMode === 'composite' && opts.brandId
              ? (await import('$lib/server/brand-media')).loadLibraryMediaParts(opts.supabase, opts.brandId, [post.mediaId])
              : Promise.resolve([] as ImagePart[])
          ]);
          const referenceImages = [...(libraryRefs ?? []), ...(productRefs ?? [])].slice(0, PRODUCT_REF_IMAGES);
          const kind = featured?.kind ?? '';
          const referenceMode = libraryRefs?.length ? 'product' as const : referenceModeFor(kind, siteType);
          // Onboarding / first-week preview: never leave a visual-required platform imageless just
          // because the product catalog photo is missing — drop the product anchor and render a
          // branded scene instead. A blank card is worse than a generated lifestyle shot.
          if (post.product && referenceMode === 'product' && !referenceImages?.length) {
            if (VISUAL_REQUIRED.has(plat)) {
              post.product = '';
            } else {
              opts.onPost(post);
              return;
            }
          }
          // Feed the logo only on branded/graphic posts — those with no product or person photo,
          // exactly where the model would otherwise invent a wordmark. Keep it off product/person
          // shots so it isn't awkwardly slapped onto a candid photo.
          const logoImage = !referenceImages?.length && !personRefs?.length ? (logoPart ?? undefined) : undefined;
          // Video posts render their cover 9:16 — the clip inherits the cover's dimensions.
          const aspectRatio = aspectRatioFor(post.platform, post.format);
          // A UGC clip's cover is the OPPOSITE of the brand's premium look, so the style is
          // swapped, not blended — mixing them yields an advert pretending to be candid, which is
          // the main way AI social video reads as fake. Everything else on this path is unchanged:
          // person references, product references, the logo rule and the QC critic all still apply,
          // because WHO is on camera and WHICH product they hold must stay exactly as grounded.
          const isUgc = post.format === 'video' && post.ugc !== false;
          const { UGC_VISUAL_STYLE, UGC_COVER_MODEL } = await import('$lib/server/ugc');
          const effectiveStyle = isUgc ? UGC_VISUAL_STYLE : visualStyle;
          const renderOpts = {
            referenceImages,
            personImages: personRefs,
            // Nano Banana Pro — MASTER UGC look is enforced in the prompt, not by a cheaper model.
            ...(isUgc ? { model: UGC_COVER_MODEL } : {}),
            // A curated brand moodboard would drag a UGC frame back toward the polished look.
            moodImages: isUgc ? undefined : moodImages,
            visualStyle: effectiveStyle,
            visualPlaybook: isUgc ? undefined : visualPlaybook,
            referenceMode,
            brandLook: isUgc ? undefined : brandLook,
            // No logo on a candid selfie — it is the single clearest "this is an ad" signal.
            logoImage: isUgc ? undefined : logoImage,
            aspectRatio
          };

          // Carousel gate at RENDER time: needs the slide prompts AND a live carousel budget.
          // CAROUSEL_MAX_PER_BATCH=0 is the kill switch — even a pre-existing carousel draft
          // renders (and ships) as a plain single image.
          const isCarousel = post.format === 'carousel' && (post.image_prompts?.length ?? 0) >= 2 && carouselMaxPerBatch() > 0;
          if (post.format === 'carousel' && !isCarousel) {
            post.format = 'single_image';
            post.image_prompts = undefined;
          }

          // Render + QC gate. High stakes (a real person or a real product photo in frame) → two
          // candidates in parallel and the critic picks the better one; else single render. The best
          // image then gets cumulative-hint corrective retries if it still fails QC. For a carousel
          // this renders SLIDE 1 (the cover — image_prompt === image_prompts[0]) at full quality.
          const highStakes = !!personRefs?.length || !!referenceImages?.length;
          // For UGC the stored image_prompt describes a SCENE, but image-to-video fixes subject,
          // room and wardrobe from this frame — so it has to show a PERSON MID-SENTENCE or the
          // video model invents its own speaker and the brand's face is lost.
          const framePrompt = isUgc
            ? (await import('$lib/server/ugc')).buildUgcFramePrompt({
                person: post.person,
                product: post.product,
                setting: post.setting,
                hook: post.hook,
                hookVisual: post.hook_visual
              })
            : post.image_prompt;

          const { dataUrl, qc } = await renderWithQC(
            ai,
            framePrompt,
            renderOpts,
            {
              productName: post.product,
              productKind: featured?.kind,
              personName: post.person,
              personAttributes:
                post.person && !personRefs?.length
                  ? personAttrsMap.get(post.person.toLowerCase().trim())
                  : undefined,
              referenceImages,
              personImages: personRefs,
              visualStyle: effectiveStyle
            },
            highStakes
          );
          // Expose the verdict so callers can surface it (CLI --verbose).
          if (qc) (post as AnyRec).__qc = qc;

          if (dataUrl) {
            const cover = await uploadPostImage(opts.supabase, opts.userId, dataUrl, aspectRatio);
            post.imageUrl = cover;
            if (isCarousel && cover) {
              // Slides 2..N in parallel, each anchored to the QC'd slide 1 (attached as a style
              // reference) with light QC — see renderCarouselSlide. Failed slides are dropped; a
              // series that ends up with < 2 slides ships as a plain single image.
              const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
              const anchor: ImagePart | undefined = m ? { inlineData: { mimeType: m[1], data: m[2] } } : undefined;
              const total = post.image_prompts!.length;
              const rest = await Promise.all(
                post.image_prompts!.slice(1).map((slidePrompt, idx) =>
                  renderCarouselSlide(ai, opts.supabase, opts.userId, slidePrompt, idx + 1, total, renderOpts, anchor, {
                    productName: post.product,
                    productKind: featured?.kind,
                    referenceImages,
                    visualStyle
                  })
                )
              );
              const urls = [cover, ...rest.filter((u): u is string => !!u)];
              if (urls.length > 1) {
                post.imageUrls = urls;
              } else {
                post.format = 'single_image';
                post.image_prompts = undefined;
              }
            }
          }
        } catch (e) {
          // leave imageless — the caption still previews
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[renderPreviewImages] render failed for "${post.product}": ${msg}`);
          (post as AnyRec).__renderError = msg;
        }
      }
      opts.onPost(post);
      doneCount++;
      opts.onProgress?.(
        'generating',
        `Image ${Math.min(doneCount, posts.length)} of ${posts.length} ready…`
      );
    })
  );
}

// Plan + render in one call — the original end-to-end behaviour, unchanged for callers that run the
// whole pipeline in a single request (the recurring scheduler and the manual content trigger).
// Onboarding deliberately calls planPreviewPosts and renderPreviewImages as two separate requests
// instead, so neither one alone can hit the serverless timeout.
export async function generatePreview(
  profile: BrandProfile,
  opts: PlanPreviewOpts & RenderPreviewOpts,
  count = 3
): Promise<void> {
  const posts = await planPreviewPosts(profile, opts, count);
  await renderPreviewImages(profile, posts, opts);
}

// ── Single-content creation (user-briefed) ───────────────────────────────────
// One post from ONE user brief — the "Crea contenuto" button on the Content page. Unlike the
// batch pipeline there is no strategy pass: the user's brief IS the angle. Writes the caption +
// image_prompt with the same brand voice/platform rules as the batch, then renders through the
// same render+QC loop, with the user's UPLOADED reference photos as subject anchors (same
// contract as product refs: the reference is reproduced faithfully, only the scene is styled).
