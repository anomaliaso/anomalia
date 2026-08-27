import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { createSingleContent, attachBrandMoodImages, isCarouselPlatform, type ContentPrefs } from '$lib/server/content-preview';
import { renderVideo } from '$lib/server/video';
import { remaining, addUsage, monthKey } from '$lib/server/usage';
import { loadActivePlan, currentWeekIndex } from '$lib/server/editorial-plan';
import { env } from '$env/dynamic/private';
import { fileToInlineImagePart } from '$lib/server/raster-image';

// "Crea contenuto": un post su brief dell'utente, generato a richiesta. Le immagini di
// riferimento caricate ancorano il SOGGETTO del render, stesso contratto delle foto prodotto nella
// pipeline a lotti. Il risultato è un post pending_user, agganciato alla settimana del piano
// editoriale attiva e addebitato alla quota mensile.

// Render della copertina + retry del QC + (per il video) il poll Seedance: serve spazio.
export const config = { maxDuration: 300 };

const MAX_REFS = 3;
const MAX_REF_BYTES = 6_000_000;

export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession }, platform: vercelPlatform }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, target_platforms, content_prefs, plan, timezone')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

  const budget = await remaining(supabase, brand.id, brand.plan, brand.timezone);
  if (budget.posts <= 0) return json({ error: 'quota' }, { status: 400 });
  if (budget.credits.remaining <= 0) return json({ error: 'credits_exhausted', resetDate: budget.credits.periodEnd.toISOString(), quota: budget.credits.quota, used: budget.credits.used }, { status: 402 });

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'bad_request' }, { status: 400 });
  const rawKind = String(form.get('kind') ?? 'image');
  const kind: 'image' | 'video' | 'carousel' = rawKind === 'video' ? 'video' : rawKind === 'carousel' ? 'carousel' : 'image';
  const platform = String(form.get('platform') ?? '').toLowerCase().trim() || 'instagram';
  const brief = String(form.get('brief') ?? '').trim();
  if (!brief) return json({ error: 'missing_brief' }, { status: 400 });
  // Il carosello funziona solo dove l'API di pubblicazione accetta più immagini.
  if (kind === 'carousel' && !isCarouselPlatform(platform)) return json({ error: 'carousel_platform' }, { status: 400 });
  const slideCount = kind === 'carousel' ? (Number(form.get('slides')) || undefined) : undefined;

  const referenceImages: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const entry of form.getAll('refs').slice(0, MAX_REFS)) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const part = await fileToInlineImagePart(entry, MAX_REF_BYTES);
    if (part) referenceImages.push(part);
  }

  // Profilo dall'archivio, come nell'endpoint a lotti: nessuna rifetch del sito.
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('category, about, target_audience, brand_colors, fonts, ai_character, ai_context, visual_style, site_type')
    .eq('brand_id', brand.id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profile: any = {
    name: brand.name,
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
  await attachBrandMoodImages(profile, supabase, brand.id);
  const prefs: ContentPrefs = (brand.content_prefs as ContentPrefs) ?? {};

  try {
    const result = await createSingleContent({
      supabase,
      userId: user.id,
      profile,
      platform,
      format: kind === 'video' ? 'reel' : kind === 'carousel' ? 'carousel' : 'post',
      slideCount,
      brief,
      referenceImages: referenceImages.length ? referenceImages : undefined,
      prefs
    });
    // Qui il contenuto È il visual: senza render non c'è niente da mettere nel feed.
    if (!result.imageUrl) return json({ error: 'render_failed' }, { status: 502 });
    // Un carosello con una slide sola è un'immagine singola: media_urls solo da 2 slide in su.
    const carouselUrls = kind === 'carousel' && result.imageUrls && result.imageUrls.length > 1 ? result.imageUrls : null;

    // Si anima la copertina già passata dal QC. Al primo intoppo il post esce come foto, con
    // videoFallback segnalato alla UI.
    let contentType = 'generated_image';
    let mediaUrl: string = result.imageUrl;
    let videoDurationSeconds: number | null = null;
    let videoResolution: string | null = null;
    let videoFallback = false;
    /** Valorizzato quando un clip è stato consegnato a kie e lo attaccherà il reconciler. */
    let submittedRender: import('$lib/server/video').SubmittedVideoRender | null = null;
    if (kind === 'video') {
      // Anche i render in sospeso contano sull'allowance: il numero mensile si addebita quando il
      // clip atterra, e il solo `usage` lascerebbe spendere lo stesso budget più volte.
      const { countOutstandingVideoRenders, submitAndTrackVideoRender } = await import(
        '$lib/server/video-render-queue'
      );
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      const admin = createAdminClient();
      const inFlight = await countOutstandingVideoRenders(admin, brand.id);
      if (env.KIE_API_KEY && budget.videos - inFlight > 0) {
        // Inviato, non atteso: il muro qui è 300s e un poll kie arriva a 600s, quindi aspettarlo
        // significherebbe morire sempre a metà. È il reconciler a rendere possibile il video qui.
        submittedRender = await submitAndTrackVideoRender({
          admin,
          brandId: brand.id,
          userId: user.id,
          postId: null,
          threadId: null,
          imagePrompt: result.imagePrompt,
          render: {
            duration: prefs.videoDuration,
            imageUrl: result.imageUrl,
            visualStyle: profile.visual_style || undefined,
            instructions: prefs.videoInstructions,
            resolution: prefs.videoResolution,
            model: prefs.videoModel
          }
        });
        if (submittedRender) {
          // Il post esce con la copertina; il reconciler ci scambia il clip. video_render_status
          // impedisce ad approve e publish di spedire la copertina al posto del video.
          videoDurationSeconds = submittedRender.durationSeconds;
          videoResolution = submittedRender.resolution;
        } else videoFallback = true;
      } else videoFallback = true;
    }

    // Il legame con la settimana vive su content_plans: i post portano solo plan_id, quindi si
    // riusa il contenitore della settimana (o se ne crea uno).
    let planId: string | null = null;
    const plan = await loadActivePlan(supabase, brand.id);
    const weekIdx = plan ? currentWeekIndex(plan, brand.timezone) : null;
    if (plan?.id && weekIdx != null) {
      const { data: cps } = await supabase
        .from('content_plans')
        .select('id')
        .eq('brand_id', brand.id)
        .eq('editorial_plan_id', plan.id)
        .eq('editorial_week', weekIdx)
        .limit(1);
      planId = (cps?.[0]?.id as string | undefined) ?? null;
      if (!planId) {
        const { data: cp } = await supabase
          .from('content_plans')
          .insert({
            brand_id: brand.id,
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

    const { data: row, error: insErr } = await supabase
      .from('posts')
      .insert({
        brand_id: brand.id,
        plan_id: planId,
        platform,
        content_type: contentType,
        source: 'manual',
        caption: result.caption || null,
        image_prompt: result.imagePrompt || null,
        media_url: mediaUrl,
        media_urls: carouselUrls,
        image_prompts: carouselUrls ? (result.imagePrompts ?? null) : null,
        // L'argomento 'reel' passato sopra è l'interruttore interno di createSingleContent per il
        // fotogramma di copertina, non il formato persistito. `format` diventa 'video' solo quando
        // il clip esiste (lo scrive il reconciler), o un render fallito lascerebbe un reel fermo.
        format: carouselUrls ? 'carousel' : 'single_image',
        video_duration_seconds: videoDurationSeconds,
        // Solo con un handle kie vero: senza la 0127 applicata, PostgREST rifiuterebbe la colonna
        // su ogni insert non-video.
        ...(submittedRender
          ? { video_render_status: 'rendering', video_resolution: videoResolution }
          : {}),
        status: 'pending_user'
      })
      .select('id')
      .single();
    if (insErr || !row) return json({ error: insErr?.message ?? 'insert_failed' }, { status: 500 });

    // Il render è registrato PRIMA dell'insert di proposito: un insert fallito non deve far
    // perdere un task che kie sta già renderizzando e fatturerà.
    if (submittedRender) {
      const { createAdminClient } = await import('$lib/server/supabase-admin');
      await createAdminClient()
        .from('video_renders')
        .update({ post_id: row.id as string })
        .eq('task_id', submittedRender.taskId)
        .then(undefined, () => {});
    }

    // Non mentre un clip è in arrivo: qui mediaUrl è ancora la copertina, e valutarla vorrebbe
    // dire archiviare la recensione di un fermo immagine come quella del video.
    if (mediaUrl && !submittedRender) {
      const { queueVideoReview, kickVideoReviewWork } = await import('$lib/server/video-review-store');
      await queueVideoReview(supabase, {
        brandId: brand.id,
        url: mediaUrl,
        postId: row.id as string,
        durationSeconds: videoDurationSeconds
      });
      const origin = new URL(request.url).origin;
      const p = vercelPlatform as { context?: { waitUntil?: (pr: Promise<unknown>) => void } } | undefined;
      const kick = kickVideoReviewWork(origin, brand.id);
      if (p?.context?.waitUntil) p.context.waitUntil(kick);
      else void kick.catch(swallow('p.context.waitUntil failed'));
    }

    if (result.knowledgeChunkIds?.length) {
      try {
        const { recordChunkUsedByPost } = await import('$lib/server/knowledge');
        await recordChunkUsedByPost(supabase, brand.id, row.id as string, result.knowledgeChunkIds);
      } catch (e) {
        console.warn('[create-single] recordChunkUsedByPost', e instanceof Error ? e.message : e);
      }
    }

    // Il budget video lo addebita il RECONCILER quando un clip atterra: col render differito qui
    // non c'è mai un clip, nemmeno sul percorso felice. Non riportarlo indietro.
    await addUsage(supabase, brand.id, monthKey(brand.timezone), {
      posts: 1,
      videos: contentType === 'generated_video' ? 1 : 0
    });

    return json({
      ok: true,
      id: row.id,
      contentType,
      mediaUrl,
      videoFallback,
      // Senza questo la UI legge la copertina come il post finito e nessuno dice che sta
      // arrivando un clip.
      ...(submittedRender ? { videoRenderStatus: 'rendering' as const } : {})
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'create_failed' }, { status: 500 });
  }
};
