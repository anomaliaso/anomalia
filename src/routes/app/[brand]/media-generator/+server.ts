import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { streamMediaGenerator, type MediaKindPreference } from '$lib/server/media-generator/agent';
import { insertMediaGeneratorPrompt } from '$lib/server/media-generator/persist';
import type { AspectRatio } from '$lib/server/content-preview';
import { CHAT_USER_ERROR } from '$lib/server/chat/report-error';
import { isKnownVideoModelId, isSeedanceFamily, SEEDANCE_25_MODEL } from '$lib/video-models';
import {
  closeSurfaceTurn,
  collectSurfaceReply,
  openSurfaceTurn
} from '$lib/server/chat/surface-turn';
import {
  attachDesignerStreamMirror,
  DESIGNER_TOOL_UGC,
  designerTurnNeedsContinuation,
  enqueueDesignerContinuation,
  finishDesignerJob,
  insertDesignerJob,
  scheduleDesignerKick
} from '$lib/server/designer-jobs';
import { CHAT_TURN_ABORT_MS, chatTurnDeadline } from '$lib/server/chat/turn-limits';
import { isUgcFormatId, isUgcPlatformId } from '$lib/ugc-formats';
import type { UgcClipPlan } from '$lib/server/media-generator/ugc-batch';

// Must match CHAT_MAX_DURATION_MS — this route uses chatTurnDeadline() and CHAT_TURN_ABORT_MS,
// which are carved out of that wall. See the note on the motion-video route.
export const config = { maxDuration: 1800 };

const ASPECTS = new Set(['1:1', '4:5', '9:16', '16:9']);
const KINDS = new Set(['auto', 'image', 'video']);

function cleanUrlList(raw: unknown, max: number, allowDataImage = false): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.startsWith('http') ||
        (allowDataImage && s.startsWith('data:image/'))
    )
    .slice(0, max);
}

export const POST: RequestHandler = async ({
  request,
  params,
  locals: { supabase, safeGetSession },
  platform
}) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase
    .from('brands')
    .select('id, slug')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  let body: {
    prompt?: string;
    aspectRatio?: string;
    kind?: string;
    variants?: number;
    videoCount?: number;
    mediaIds?: string[];
    referenceUrls?: string[];
    products?: Array<{ id?: string; name?: string; urls?: string[] }>;
    models?: Array<{ id?: string; name?: string; urls?: string[] }>;
    useBrandStyle?: boolean;
    forceUgc?: boolean;
    videoModel?: string;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    referenceVideoUrls?: string[];
    referenceAudioUrls?: string[];
    /** UGC toolbar: ad format (unset = rotate across the batch) and destination platform. */
    ugcFormat?: string;
    ugcPlatform?: string;
  };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON');
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw error(400, 'Prompt required');

  const forceUgc = body.forceUgc === true;
  const aspectRatio = ASPECTS.has(body.aspectRatio ?? '')
    ? (body.aspectRatio as AspectRatio)
    : undefined;
  const kind = forceUgc
    ? 'video'
    : KINDS.has(body.kind ?? '')
      ? (body.kind as MediaKindPreference)
      : 'auto';
  const variantsRaw = typeof body.variants === 'number' ? body.variants : Number(body.variants);
  const variants = Number.isFinite(variantsRaw)
    ? Math.min(4, Math.max(1, Math.round(variantsRaw)))
    : 1;
  const useBrandStyle = body.useBrandStyle !== false;

  const mediaIds = Array.isArray(body.mediaIds)
    ? body.mediaIds.filter((s): s is string => typeof s === 'string' && !!s).slice(0, 6)
    : [];

  const referenceUrls = Array.isArray(body.referenceUrls)
    ? body.referenceUrls
        .filter(
          (s): s is string =>
            typeof s === 'string' &&
            (s.startsWith('http') || s.startsWith('data:image/'))
        )
        .slice(0, 6)
    : [];

  const products = Array.isArray(body.products)
    ? body.products
        .filter(
          (p): p is { id: string; name?: string; urls: string[] } =>
            !!p &&
            typeof p.id === 'string' &&
            Array.isArray(p.urls) &&
            p.urls.some(
              (u) => typeof u === 'string' && (u.startsWith('http') || u.startsWith('data:image/'))
            )
        )
        .map((p) => ({
          id: p.id,
          name: typeof p.name === 'string' ? p.name : 'product',
          urls: p.urls.filter(
            (u): u is string =>
              typeof u === 'string' && (u.startsWith('http') || u.startsWith('data:image/'))
          )
        }))
        .slice(0, 20)
    : [];

  const models = Array.isArray(body.models)
    ? body.models
        .filter(
          (p): p is { id: string; name?: string; urls: string[] } =>
            !!p &&
            typeof p.id === 'string' &&
            Array.isArray(p.urls) &&
            p.urls.some(
              (u) => typeof u === 'string' && (u.startsWith('http') || u.startsWith('data:image/'))
            )
        )
        .map((p) => ({
          id: p.id,
          name: typeof p.name === 'string' ? p.name : 'model',
          urls: p.urls.filter(
            (u): u is string =>
              typeof u === 'string' && (u.startsWith('http') || u.startsWith('data:image/'))
          )
        }))
        .slice(0, 20)
    : [];

  const videoModelRaw =
    (forceUgc || kind === 'video') && isKnownVideoModelId(body.videoModel)
      ? String(body.videoModel)
      : forceUgc
        ? SEEDANCE_25_MODEL
        : null;

  // Selected grid videos (or pasted URLs) for remake / motion transfer.
  // Seedance family accepts reference_video_urls on Kie; Grok Imagine does not.
  const requestedRefVideos = cleanUrlList(body.referenceVideoUrls, 10);
  const requestedRefAudios = cleanUrlList(body.referenceAudioUrls, 10);
  const hasSeedanceMaterials =
    requestedRefVideos.length > 0 ||
    requestedRefAudios.length > 0 ||
    (typeof body.firstFrameUrl === 'string' && !!body.firstFrameUrl.trim()) ||
    (typeof body.lastFrameUrl === 'string' && !!body.lastFrameUrl.trim());
  const videoModel =
    hasSeedanceMaterials && (!videoModelRaw || !isSeedanceFamily(videoModelRaw))
      ? SEEDANCE_25_MODEL
      : videoModelRaw;

  const seedanceMultimodal = isSeedanceFamily(videoModel);

  async function materializeFrameUrl(raw: unknown): Promise<string | null> {
    if (!seedanceMultimodal || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (!trimmed.startsWith('data:image/')) return null;
    const { uploadPostImage } = await import('$lib/server/content-preview');
    return (await uploadPostImage(supabase, user.id, trimmed)) ?? null;
  }

  const [firstFrameUrl, lastFrameUrl] = await Promise.all([
    materializeFrameUrl(body.firstFrameUrl),
    materializeFrameUrl(body.lastFrameUrl)
  ]);
  const referenceVideoUrls = seedanceMultimodal ? requestedRefVideos : [];
  const referenceAudioUrls = seedanceMultimodal ? requestedRefAudios : [];

	const abortController = new AbortController();

  return withBrandContext(brand.id, async () => {
    const promptRow = await insertMediaGeneratorPrompt(supabase, {
      brandId: brand.id,
      userId: user.id,
      prompt,
      kind,
      aspect: aspectRatio ?? null,
      useBrandStyle,
      ugc: forceUgc
    });
    const promptId = 'id' in promptRow ? promptRow.id : null;
    if (!promptId) {
      console.error('[media-generator] prompt insert failed', 'error' in promptRow ? promptRow.error : '');
    }

    if (forceUgc) {
      const { streamUgcBatchResponse, clampUgcVideoCount } = await import(
        '$lib/server/media-generator/ugc-batch'
      );
      const videoCount = clampUgcVideoCount(
        body.videoCount ?? body.variants ?? 1
      );
      // Toolbar picks. Unset format is not a missing value: it means "rotate the formats across the
      // batch", which is what a ten-pack needs to come back as ten different videos.
      const ugcFormat = isUgcFormatId(body.ugcFormat) ? body.ugcFormat : null;
      const ugcPlatform = isUgcPlatformId(body.ugcPlatform) ? body.ugcPlatform : null;
      const origin = new URL(request.url).origin;
      const locale = (request.headers.get('accept-language') || '').toLowerCase().startsWith('en')
        ? 'en'
        : 'it';
      const deadline = chatTurnDeadline(Date.now());
      const hardStop = setTimeout(() => abortController.abort(), CHAT_TURN_ABORT_MS);
      const jobId = await insertDesignerJob(supabase, {
        brandId: brand.id,
        userId: user.id,
        toolName: DESIGNER_TOOL_UGC,
        inputParams: {
          prompt,
          videoCount,
          products,
          models,
          referenceUrls,
          referenceVideoUrls,
          firstFrameUrl,
          lastFrameUrl,
          referenceAudioUrls,
          aspectRatio: aspectRatio ?? '9:16',
          format: ugcFormat,
          platform: ugcPlatform,
          useBrandStyle,
          videoModel,
          promptId,
          origin,
          locale,
          continuation_depth: 0
        }
      });
      const mirror = jobId ? attachDesignerStreamMirror(supabase, jobId) : null;
      // Recorded as an ordinary thread: sidebar row, reopenable, and continuing it hands the
      // conversation to the `ugc` specialist instead of the generalist.
      const thread = await openSurfaceTurn(supabase, {
        brandId: brand.id,
        userId: user.id,
        surface: 'ugc',
        agent: 'ugc',
        prompt,
        fallbackTitle: 'UGC'
      });
      const ugcParams = {
        prompt,
        videoCount,
        products,
        models,
        referenceUrls,
        referenceVideoUrls,
        firstFrameUrl,
        lastFrameUrl,
        referenceAudioUrls,
        aspectRatio: aspectRatio ?? '9:16',
        format: ugcFormat,
        platform: ugcPlatform,
        useBrandStyle,
        videoModel,
        promptId
      };
      let continued = false;

      try {
        const response = streamUgcBatchResponse({
          supabase,
          userId: user.id,
          brandId: brand.id,
          ...ugcParams,
          // Lo stesso thread in cui la risposta viene scritta: è quello a cui appartengono
          // l'obiettivo del produttore e un eventuale artefatto.
          threadId: thread?.id ?? null,
          abortSignal: abortController.signal,
          deadline,
          locale,
          onTruncated: async (remaining: UgcClipPlan[]) => {
            if (!jobId) return;
            const child = await enqueueDesignerContinuation(supabase, {
              brandId: brand.id,
              userId: user.id,
              toolName: DESIGNER_TOOL_UGC,
              parentJobId: jobId,
              // threadId: la slice di continuazione gira in un'altra invocazione e senza questo
              // non saprebbe in quale thread scrivere la propria parte della risposta.
              inputParams: { ...ugcParams, threadId: thread?.id ?? null, resumePlans: remaining, origin, locale },
              origin,
              locale,
              depth: 0
            });
            if (child) {
              continued = true;
              scheduleDesignerKick(
                platform as { context?: { waitUntil?: (p: Promise<unknown>) => void } },
                origin
              );
            }
          },
          consumeSseStream: mirror
            ? async ({ stream }) => {
                await mirror.consumeSseStream({ stream });
                await closeSurfaceTurn(supabase, thread, {
                  brandId: brand.id,
                  userId: user.id,
                  state: mirror.state()
                });
                if (!jobId) return;
                if (continued) return;
                if (designerTurnNeedsContinuation(deadline)) {
                  const child = await enqueueDesignerContinuation(supabase, {
                    brandId: brand.id,
                    userId: user.id,
                    toolName: DESIGNER_TOOL_UGC,
                    parentJobId: jobId,
                    inputParams: { ...ugcParams, threadId: thread?.id ?? null, origin, locale },
                    origin,
                    locale,
                    depth: 0
                  });
                  if (child) {
                    scheduleDesignerKick(
                      platform as { context?: { waitUntil?: (p: Promise<unknown>) => void } },
                      origin
                    );
                  }
                } else {
                  await finishDesignerJob(supabase, jobId, {
                    status: 'done',
                    partial: mirror.snapshot()
                  });
                }
              }
            : undefined
        });
        if (jobId) response.headers.set('X-Designer-Job-Id', jobId);
        return response;
      } finally {
        clearTimeout(hardStop);
      }
    }

    const mediaThread = await openSurfaceTurn(supabase, {
      brandId: brand.id,
      userId: user.id,
      surface: 'media',
      agent: 'media',
      prompt,
      fallbackTitle: 'Media',
      attachments: referenceUrls.filter((u) => u.startsWith('data:image/'))
    });
    const collected = collectSurfaceReply();

    const result = await streamMediaGenerator({
      supabase,
      userId: user.id,
      brandId: brand.id,
      prompt,
      aspectRatio,
      kind,
      variants,
      mediaIds,
      referenceUrls,
      useBrandStyle,
      forceUgc,
      promptId,
      abortSignal: abortController.signal,
      videoModel,
      firstFrameUrl,
      lastFrameUrl,
      referenceVideoUrls,
      referenceAudioUrls
    });

    const response = result.toUIMessageStreamResponse({
      sendReasoning: true,
      onError: () => CHAT_USER_ERROR,
      consumeSseStream: async ({ stream }) => {
        await collected.consumeSseStream({ stream });
        await closeSurfaceTurn(supabase, mediaThread, {
          brandId: brand.id,
          userId: user.id,
          state: collected.state()
        });
      }
    });

    // Surface the prompt history id so the client can reconcile cronologia without a reload.
    if (promptId) response.headers.set('X-Media-Generator-Prompt-Id', promptId);
    return response;
  });
};

/**
 * Paginated gallery for infinite scroll.
 * `?items=1&before=&limit=` returns `{ ok, items, hasMore }` (newest-first pages).
 * Without pagination params, keeps the lightweight health check for CLI.
 */
export const GET: RequestHandler = async ({ url, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const wantsPage =
    url.searchParams.has('before') ||
    url.searchParams.has('limit') ||
    url.searchParams.get('items') === '1';

  if (!wantsPage) {
    return json({ ok: true, brand: params.brand, feature: 'media-generator' });
  }

  const { data: brand } = await supabase
    .from('brands')
    .select('id, slug')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  const {
    listMediaGeneratorItems,
    MEDIA_GENERATOR_PAGE_SIZE
  } = await import('$lib/server/media-generator/persist');

  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) ? limitRaw : MEDIA_GENERATOR_PAGE_SIZE;
  const beforeRaw = (url.searchParams.get('before') ?? '').trim();
  const before = beforeRaw || undefined;
  const ugcOnly = url.searchParams.get('ugc') === '1';

  const page = await listMediaGeneratorItems(supabase, brand.id, { limit, before, ugcOnly });
  return json({
    ok: true,
    brand: params.brand,
    items: page.items,
    hasMore: page.hasMore,
    before: before ?? null,
    limit: Math.min(Math.max(limit, 1), 60),
    ugcOnly
  });
};

/** Remove a broken / empty grid item (e.g. media URL failed to load). */
export const DELETE: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  let itemId = '';
  try {
    const body = await request.json();
    itemId = typeof body?.id === 'string' ? body.id.trim() : '';
  } catch {
    /* ignore */
  }
  if (!itemId) {
    const url = new URL(request.url);
    itemId = (url.searchParams.get('id') ?? '').trim();
  }
  if (!itemId) throw error(400, 'id required');

  const { deleteMediaGeneratorItem } = await import('$lib/server/media-generator/persist');
  const ok = await deleteMediaGeneratorItem(supabase, brand.id, itemId);
  if (!ok) throw error(404, 'Not found');
  return json({ ok: true, id: itemId });
};
