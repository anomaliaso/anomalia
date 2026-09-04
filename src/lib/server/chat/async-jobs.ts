/**
 * Shared executors for long-running chat tools.
 * Tool wrappers await these inline (runLongTool → executeChatToolJob).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureShortNetworkCuts } from '$lib/platform-limits';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/**
 * The produce path's profile. Was a second `plannerProfile` reading its own thirteen kit fields
 * while `planner-inputs.ts` exported one reading seven — same name, two answers, and whichever you
 * got depended on which file you happened to import from. There is one now; this wraps it only to
 * look the brand's name up by id and to skip the site-pages query, which captions never use.
 */
export async function plannerProfile(supabase: SupabaseClient, brandId: string) {
  const { plannerProfile: loadProfile } = await import('$lib/server/planner-inputs');
  const { data: brand } = await supabase.from('brands').select('name').eq('id', brandId).maybeSingle();
  return loadProfile(supabase, { id: brandId, name: brand?.name ?? '' }, { pages: false });
}

/** Enrich planner profile with products / people / mood refs / media library for caption + image production. */
async function enrichProduceProfile(supabase: SupabaseClient, brandId: string, profile: AnyRec) {
  const { selectFeaturableProducts } = await import('$lib/server/editorial-plan');
  const { attachBrandMoodImages } = await import('$lib/server/content-preview');
  const { attachBrandPeople } = await import('$lib/server/people');
  const { listReadyLibraryImages, attachBrandLibraryMedia } = await import('$lib/server/brand-media');

  const { data: rawProducts } = await supabase
    .from('products')
    .select('title, description, kind, pricing, images')
    .eq('brand_id', brandId);
  const products = selectFeaturableProducts(rawProducts ?? [], 40);
  profile.products = (products ?? []).map((p: AnyRec) => ({
    name: p.title,
    description: p.description,
    kind: p.kind,
    pricing: p.pricing,
    images: p.images
  }));

  await attachBrandMoodImages(profile, supabase, brandId);
  await attachBrandPeople(profile, supabase, brandId).catch(() => {});
  await attachBrandLibraryMedia(profile, supabase, brandId);
}

export async function planEvidence(supabase: SupabaseClient, brandId: string) {
  const { strategyBriefFromReport } = await import('$lib/server/research');
  type StrategyReport = import('$lib/server/research').StrategyReport;
  type Benchmark = import('$lib/server/research').Benchmark;
  const { rankRecentWinners } = await import('$lib/server/scheduler');
  const [{ data: strategy }, { data: history }] = await Promise.all([
    supabase.from('brand_strategy').select('report, benchmark').eq('brand_id', brandId).maybeSingle(),
    supabase
      .from('social_post_history')
      // `media_type` is the FORMAT axis of the hook coverage map — free on a query we already make.
      .select('content, platform, metrics, published_at, media_type')
      .eq('brand_id', brandId)
      .limit(200)
  ]);
  const report = (strategy?.report as StrategyReport | null) ?? null;
  const { analyzePostHistory } = await import('$lib/server/post-history-insights');
  const insights = analyzePostHistory(
    (history ?? []).map((h) => ({
      content: h.content,
      mediaType: (h as { media_type?: string | null }).media_type,
      publishedAt: h.published_at,
      metrics: h.metrics as { likes?: number | null; comments?: number | null; engagementRate?: number | null } | null
    }))
  );
  return {
    strategyBrief: report ? strategyBriefFromReport(report) : '',
    benchmark: (strategy?.benchmark as Benchmark | null) ?? null,
    topPosts: rankRecentWinners(history ?? []),
    historyCount: history?.length ?? 0,
    hooks: insights.hooks,
    // Which angles have earned real production spend — decides WHICH clips survive the video cap.
    ladder: {
      proven: insights.hooks.proven,
      tried: insights.hooks.used,
      coldStart: insights.hooks.used.length === 0
    }
  };
}

/** Propose a new GTM strategy (onboarding or regen). Always inserts as `proposed`. */
export async function runGenerateStrategy(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  params: { objective?: string; locale?: string; tz?: string; onboarding?: boolean }
): Promise<AnyRec> {
  const { getOnboardingState, canGenerate, saveOnboardingState, approveStudioIfNeeded } = await import('$lib/server/onboarding');
  const { data: brandRow } = await supabase
    .from('brands')
    .select('target_platforms, plan, onboarding_state, timezone')
    .eq('id', brandId)
    .maybeSingle();
  let state = getOnboardingState(brandRow?.onboarding_state);
  const onboarding = params.onboarding !== false && state.status !== 'completed' && state.phase !== 'free_mode';

  // Studio is auto-approved when strategy generation starts — no separate permission step.
  if (onboarding && state.sections.studio !== 'approved') {
    const studio = await approveStudioIfNeeded(supabase, brandId);
    state = studio.state;
  }

  if (onboarding && !canGenerate(state, 'strategy')) {
    return { error: 'The Studio must be approved before generating the Strategy.' };
  }

  const { genaiClient } = await import('$lib/server/research');
  const { proposeGtmDual } = await import('$lib/server/gtm');
  const { localeLanguageName } = await import('$lib/i18n/locale');
  const platforms = Array.isArray(brandRow?.target_platforms) ? (brandRow!.target_platforms as string[]) : [];
  const [profile, evidence] = await Promise.all([plannerProfile(supabase, brandId), planEvidence(supabase, brandId)]);
  const plan = await proposeGtmDual(genaiClient(), profile, {
    objective: params.objective ?? '',
    platforms,
    outputLanguage: localeLanguageName(params.locale ?? 'en'),
    benchmark: evidence.benchmark,
    topPosts: evidence.topPosts,
    zeroToOne: evidence.historyCount < 10,
    supabase,
    brandId,
    userId,
    timezone: params.tz ?? brandRow?.timezone ?? undefined
  });

  await supabase.from('gtm_plans').update({ status: 'rejected' }).eq('brand_id', brandId).eq('status', 'proposed');
  const dualPhases = { horizon_90d: plan.phases_90d ?? [], horizon_6m: plan.phases_6m ?? plan.phases };
  const { data: inserted, error } = await supabase
    .from('gtm_plans')
    .insert({
      brand_id: brandId,
      status: 'proposed',
      horizon: '6m',
      objective: plan.objective || null,
      phases: dualPhases,
      funnel: plan.funnel ?? null,
      source: 'manual'
    })
    .select('id')
    .single();
  if (error || !inserted) return { error: error?.message ?? 'gtm_insert_failed' };

  // Chat path auto-activates — the agent owns the setup loop and should not stall waiting for a
  // separate "approve" click (same contract as the setup wizard).
  const { activateGtm } = await import('$lib/server/gtm');
  const tz = params.tz ?? brandRow?.timezone ?? 'Europe/Rome';
  await activateGtm(supabase, brandId, inserted.id as string, tz);

  if (onboarding) {
    const { SECTION_APPROVED_NEXT_PHASE } = await import('$lib/server/onboarding');
    await saveOnboardingState(supabase, brandId, {
      sections: { strategy: 'approved' },
      phase: SECTION_APPROVED_NEXT_PHASE.strategy
    });
  }

  const phases6m = (plan.phases_6m ?? plan.phases ?? []) as AnyRec[];
  return {
    success: true,
    activated: true,
    objective: plan.objective,
    phases: phases6m.map((p) => ({ name: p.name, objective: p.objective })),
    onboarding
  };
}

/** Propose a new 4-week editorial plan (onboarding or regen). */
export async function runGenerateEditorialPlan(
  supabase: SupabaseClient,
  brandId: string,
  params: { locale?: string; tz?: string; onboarding?: boolean }
): Promise<AnyRec> {
  const { getOnboardingState, canGenerate, saveOnboardingState } = await import('$lib/server/onboarding');
  const { data: brandRow } = await supabase
    .from('brands')
    .select('target_platforms, plan, onboarding_state')
    .eq('id', brandId)
    .maybeSingle();
  const state = getOnboardingState(brandRow?.onboarding_state);
  const onboarding = params.onboarding !== false && state.status !== 'completed' && state.phase !== 'free_mode';

  if (onboarding && !canGenerate(state, 'editorial_plan')) {
    return { error: 'The Strategy must be approved before generating the Editorial plan.' };
  }

  const { genaiClient } = await import('$lib/server/research');
  const { proposePlan, cadenceAllowed } = await import('$lib/server/editorial-plan');
  const { activeGtmBrief } = await import('$lib/server/gtm');
  const { localeLanguageName } = await import('$lib/i18n/locale');
  const platforms = Array.isArray(brandRow?.target_platforms) ? (brandRow!.target_platforms as string[]) : [];
  const tz = params.tz ?? 'Europe/Rome';
  const [profile, evidence, gtmBrief] = await Promise.all([
    plannerProfile(supabase, brandId),
    planEvidence(supabase, brandId),
    activeGtmBrief(supabase, brandId, tz).catch(() => '')
  ]);
  const proposal = await proposePlan(genaiClient(), profile, {
    platforms,
    allowedCadences: cadenceAllowed(brandRow?.plan ?? null),
    outputLanguage: localeLanguageName(params.locale ?? 'en'),
    strategyBrief: [gtmBrief, evidence.strategyBrief].filter(Boolean).join('\n\n'),
    benchmark: evidence.benchmark,
    topPosts: evidence.topPosts,
    zeroToOne: evidence.historyCount < 10,
    supabase,
    brandId,
    planTier: brandRow?.plan ?? null
  });

  await supabase.from('editorial_plans').update({ status: 'rejected' }).eq('brand_id', brandId).eq('status', 'proposed');
  const { data: inserted, error } = await supabase
    .from('editorial_plans')
    .insert({
      brand_id: brandId,
      status: 'proposed',
      strategy: proposal.strategy || null,
      voice: proposal.voice,
      cadence: proposal.cadence,
      platform_mix: proposal.platform_mix,
      gtm: proposal.gtm,
      weeks: proposal.weeks,
      source: 'manual'
    })
    .select('id')
    .single();
  if (error || !inserted) return { error: error?.message ?? 'editorial_insert_failed' };

  const { activatePlan } = await import('$lib/server/editorial-plan');
  await activatePlan(supabase, brandId, inserted.id as string, tz);

  if (onboarding) {
    const { SECTION_APPROVED_NEXT_PHASE } = await import('$lib/server/onboarding');
    await saveOnboardingState(supabase, brandId, {
      sections: { editorial_plan: 'approved' },
      phase: SECTION_APPROVED_NEXT_PHASE.editorial_plan
    });
  }

  const weeks = (proposal.weeks ?? []) as AnyRec[];
  return {
    success: true,
    activated: true,
    cadence: proposal.cadence,
    voice: proposal.voice,
    weeks: weeks.map((w) => ({ theme: w.theme, focus: w.focus })),
    onboarding
  };
}

/** Draft posts for an editorial-plan week — captions + images in one pass. */
export async function runProduceWeek(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  params: { week?: number; onboarding?: boolean; tz?: string }
): Promise<AnyRec> {
  const { getOnboardingState, canGenerate, saveOnboardingState } = await import('$lib/server/onboarding');
  const { data: brandRow } = await supabase
    .from('brands')
    .select('target_platforms, onboarding_state, name, timezone, plan, content_prefs')
    .eq('id', brandId)
    .maybeSingle();
  const state = getOnboardingState(brandRow?.onboarding_state);
  const onboarding = params.onboarding === true;

  if (onboarding && !canGenerate(state, 'content')) {
    return { error: 'The editorial plan must be approved before generating content.' };
  }

  const tz = params.tz ?? brandRow?.timezone ?? 'Europe/Rome';
  const { remaining } = await import('$lib/server/usage');
  const { gateToolCall } = await import('$lib/server/chat/tool-policy');
  const budget = await remaining(supabase, brandId, brandRow?.plan, tz);
  const gate = gateToolCall('produce_week', budget);
  if (gate) return gate;

  const {
    loadActivePlan,
    prefsFromPlan,
    postsForWeek,
    weekStrategyBrief,
    currentWeekIndex,
    setWeekStatus
  } = await import('$lib/server/editorial-plan');
  const { planPreviewPosts, renderPreviewImages, carouselMaxPerBatch } = await import('$lib/server/content-preview');
  const plan = await loadActivePlan(supabase, brandId);
  if (!plan) return { error: 'No active editorial plan found.' };

  const weekCount = plan.weeks?.length ?? 0;
  const currentIdx = currentWeekIndex(plan, tz) ?? 0;
  const weekIdx =
    Number.isInteger(params.week) && (params.week as number) >= 0 && (params.week as number) < weekCount
      ? (params.week as number)
      : onboarding
        ? 0
        : currentIdx;

  const platforms = Array.isArray(brandRow?.target_platforms) ? (brandRow!.target_platforms as string[]) : [];
  const profile = await plannerProfile(supabase, brandId);
  await enrichProduceProfile(supabase, brandId, profile);

  const prefs = prefsFromPlan(plan, (brandRow?.content_prefs as AnyRec) ?? {});
  const count = Math.min(5, budget.posts, postsForWeek(plan, weekIdx) || 3);
  if (count <= 0) {
    return {
      error: 'posts_quota_exhausted',
      message: 'Monthly post quota reached — explain, call offer_upgrade, do not retry.',
      action: 'offer_upgrade'
    };
  }

  const { loadApprovedRubrics } = await import('$lib/server/rubrics');
  const rubrics = await loadApprovedRubrics(supabase, brandId).catch(() => []);

  const posts = await planPreviewPosts(
    profile,
    {
      platforms,
      prefs,
      maxVideos: 1,
      maxCarousels: carouselMaxPerBatch(),
      topPosts: [],
      strategyBrief: weekStrategyBrief(plan, weekIdx, rubrics),
      rubrics,
      supabase,
      brandId,
      userId,
      weekIndex: weekIdx,
      timezone: tz,
      // With maxVideos: 1 the ladder decides WHICH clip gets made — the one whose angle has earned
      // it, not the one the planner happened to list first.
      ladder: (await planEvidence(supabase, brandId).catch(() => null))?.ladder
    },
    count
  );
  if (!posts.length) return { error: 'Week planning produced no posts — try again.' };

  // Render images in the same request (sets post.imageUrl / imageUrls). Required for IG/FB publish.
  await renderPreviewImages(profile, posts, {
    supabase,
    userId,
    brandId,
    onPost: () => {}
  });

  const needsMedia = (p: AnyRec) => p.media !== 'text' && p.media !== 'link';
  const ready = posts.filter((p: AnyRec) => !needsMedia(p) || !!p.imageUrl);
  const missingImages = posts.filter((p: AnyRec) => needsMedia(p) && !p.imageUrl).length;
  if (!ready.length) {
    return {
      error: 'Image generation failed for all posts — try again.',
      planned: posts.length,
      images_failed: missingImages
    };
  }

  const title = weekIdx === 0 ? 'First week' : `Week ${weekIdx + 1}`;
  const { data: cp } = await supabase
    .from('content_plans')
    .insert({
      brand_id: brandId,
      title,
      status: 'proposed',
      editorial_plan_id: plan.id,
      editorial_week: weekIdx
    })
    .select('id')
    .maybeSingle();

  const toInsert = ready.slice(0, 12);
  const { error: insertErr } = await supabase.from('posts').insert(
    toInsert.map((p: AnyRec) => {
      const hasImage = !!p.imageUrl;
      return {
        brand_id: brandId,
        plan_id: cp?.id ?? null,
        platform: String(p.platform ?? '').toLowerCase() || null,
        platforms: Array.isArray(p.platforms) && p.platforms.length > 1 ? p.platforms : null,
        format: p.format ?? null,
        content_type:
          p.media === 'text'
            ? 'text'
            : p.media === 'link'
              ? 'link'
              : !hasImage
                ? 'text'
                : // __fromLibrary = the asset was republished pixel-perfect. A mediaId alone only
                  // means the library image was a REFERENCE for a composite render — that output
                  // is AI-generated and must stay 'generated_image' (publish discloses on it).
                  p.__fromLibrary
                  ? 'uploaded_image'
                  : 'generated_image',
        source: 'plan',
        caption: p.caption ?? null,
        title: p.title?.trim() || null,
        link_url: p.link_url || null,
        subreddit: p.subreddit?.trim() || null,
        image_prompt: p.image_prompt ?? null,
        image_prompts: Array.isArray(p.image_prompts) && p.image_prompts.length ? p.image_prompts : null,
        media_url: p.imageUrl ?? null,
        media_urls: Array.isArray(p.imageUrls) && p.imageUrls.length > 1 ? p.imageUrls : null,
        product_name: p.product?.trim() || null,
        pillar: p.pillar?.trim() || null,
        slot: [p.day, p.time].filter(Boolean).join(' ') || null,
        status: 'pending_user',
        alt_captions: Array.isArray(p.alt_captions) && p.alt_captions.length ? p.alt_captions : null,
        platform_captions: ensureShortNetworkCuts(
          p.caption,
          Array.isArray(p.platforms) && p.platforms.length ? p.platforms : [p.platform],
          p.platform_captions && Object.keys(p.platform_captions).length ? p.platform_captions : null
        ),
        first_comment: p.first_comment?.trim() || null,
        hook_variants: Array.isArray(p.hook_variants) && p.hook_variants.length ? p.hook_variants : null
      };
    })
  );
  if (insertErr) return { error: insertErr.message || 'Failed to save draft posts' };

  const { addUsage, monthKey } = await import('$lib/server/usage');
  await addUsage(supabase, brandId, monthKey(tz), { posts: toInsert.length, videos: 0 });

  if (plan.id && toInsert.length) {
    await setWeekStatus(supabase, plan.id, weekIdx, 'planned').catch(() => {});
  }

  if (onboarding) {
    await saveOnboardingState(supabase, brandId, {
      sections: { content: 'waiting_review' },
      phase: 'content_generation_started'
    });
  }

  const imagesReady = toInsert.filter((p: AnyRec) => !!p.imageUrl).length;
  const summary = toInsert.map((p: AnyRec, i: number) => ({
    n: i + 1,
    pillar: p.pillar ?? null,
    format: p.format ?? p.media ?? null,
    platform: p.platform ?? null,
    has_image: !!p.imageUrl,
    idea: String(p.caption ?? '').replace(/\s+/g, ' ').slice(0, 140)
  }));

  return {
    success: true,
    week: weekIdx,
    count: toInsert.length,
    images: imagesReady,
    images_failed: missingImages,
    posts: summary,
    onboarding,
    note:
      missingImages > 0
        ? `${missingImages} post(s) skipped because image render failed — do not claim those images exist.`
        : 'All drafts include captions and images. Do not say images are generating in the background.'
  };
}

/** Create a 5-step event campaign (images + captions). */
export async function runCreateCampaign(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
  params: {
    name: string;
    event_date: string;
    brief: string;
    platform?: string;
    tz?: string;
  }
): Promise<AnyRec> {
  const name = (params.name ?? '').trim();
  const eventDate = (params.event_date ?? '').trim();
  const brief = (params.brief ?? '').trim();
  if (!name || !eventDate || !brief) {
    return { error: 'name, event_date and brief are required' };
  }

  const { data: brandRow } = await supabase
    .from('brands')
    .select('name, plan, timezone, content_prefs, target_platforms')
    .eq('id', brandId)
    .maybeSingle();
  if (!brandRow) return { error: 'Brand not found' };

  const tz = params.tz ?? brandRow.timezone ?? 'Europe/Rome';
  const { remaining, addUsage, monthKey } = await import('$lib/server/usage');
  const { gateToolCall } = await import('$lib/server/chat/tool-policy');
  const budget = await remaining(supabase, brandId, brandRow.plan, tz);
  const gate = gateToolCall('create_campaign', budget);
  if (gate) return gate;

  const platforms = Array.isArray(brandRow.target_platforms) ? (brandRow.target_platforms as string[]) : [];
  const platform = (params.platform ?? platforms[0] ?? 'instagram').toLowerCase();

  const { createSingleContent, attachBrandMoodImages } = await import('$lib/server/content-preview');
  type ContentPrefs = import('$lib/server/content-preview').ContentPrefs;
  const { wallClockToUtc } = await import('$lib/server/schedule');
  const {
    attachBrandLibraryMedia,
    pickLibraryAssetForBrief,
    defaultLibraryMediaMode
  } = await import('$lib/server/brand-media');
  type BrandMediaRow = import('$lib/server/brand-media').BrandMediaRow;

  const profile = await plannerProfile(supabase, brandId);
  await attachBrandMoodImages(profile, supabase, brandId);
  await attachBrandLibraryMedia(profile, supabase, brandId);
  const library = (Array.isArray(profile.libraryMedia) ? profile.libraryMedia : []) as BrandMediaRow[];
  const usedLibraryIds = new Set<string>();

  const ARC_STEPS: { key: string; dayOffset: number; brief: (n: string, b: string) => string }[] = [
    {
      key: 'announcement',
      dayOffset: -7,
      brief: (n, b) =>
        `Announce the upcoming event "${n}". ${b} This is the reveal post — introduce the event and build excitement that it's coming.`
    },
    {
      key: 'countdown',
      dayOffset: -3,
      brief: (n, b) =>
        `Countdown post for the event "${n}" — only a few days left. ${b} Build anticipation, mention the days-to-go feeling.`
    },
    {
      key: 'spotlight',
      dayOffset: -2,
      brief: (n, b) =>
        `Spotlight post for the event "${n}". ${b} Highlight one specific offering, menu item, or moment tied to the event.`
    },
    {
      key: 'day_of',
      dayOffset: 0,
      brief: (n, b) =>
        `It's today! Final reminder post for the event "${n}", happening today. ${b} Urgent, don't-miss-it energy.`
    },
    {
      key: 'recap',
      dayOffset: 1,
      brief: (n, b) =>
        `Thank-you and recap post the day after the event "${n}". ${b} Thank everyone who joined, recap the highlights.`
    }
  ];

  function addDays(dateStr: string, delta: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  const prefs = (brandRow.content_prefs as ContentPrefs) ?? {};
  const maxPosts = Math.min(ARC_STEPS.length, budget.posts);
  const steps = ARC_STEPS.slice(0, maxPosts);
  const campaignId = crypto.randomUUID();
  let created = 0;

  for (const step of steps) {
    const scheduledFor = wallClockToUtc(addDays(eventDate, step.dayOffset), '10:00', tz);
    const stepBrief = step.brief(name, brief);
    try {
      // MEDIA FIRST: reuse a distinct library asset per campaign step when available.
      const picked = pickLibraryAssetForBrief(library, stepBrief, usedLibraryIds);
      const mediaIds = picked ? [picked.id] : undefined;
      const mediaMode = picked ? defaultLibraryMediaMode(picked) : undefined;
      if (picked) usedLibraryIds.add(picked.id);

      const result = await createSingleContent({
        supabase,
        userId,
        brandId,
        profile,
        platform,
        format: 'post',
        brief: stepBrief,
        prefs,
        mediaIds,
        mediaMode: mediaMode ?? 'auto'
      });
      if (!result.imageUrl) continue;

      const { error: insErr } = await supabase.from('posts').insert({
        brand_id: brandId,
        platform,
        content_type: result.contentType ?? (result.fromLibrary ? 'uploaded_image' : 'generated_image'),
        format: 'single_image',
        source: 'manual',
        caption: result.caption || null,
        image_prompt: result.imagePrompt || null,
        media_url: result.imageUrl,
        status: 'pending_user',
        scheduled_for: scheduledFor,
        campaign_id: campaignId,
        campaign_name: name,
        campaign_step: step.key
      });
      if (!insErr) {
        created += 1;
        await addUsage(supabase, brandId, monthKey(tz), { posts: 1, videos: 0 });
      }
    } catch {
      /* continue arc */
    }
  }

  if (!created) return { error: 'Campaign generation produced no posts — try again.' };

  return {
    success: true,
    campaign_id: campaignId,
    campaign_name: name,
    count: created,
    requested: maxPosts,
    platform
  };
}
