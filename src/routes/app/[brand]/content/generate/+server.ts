import { swallow } from '$lib/server/swallow';
import type { RequestHandler } from './$types';

// Dichiarato esplicitamente: col default Vercel di 300s un render di clip qui non finiva mai.
export const config = { maxDuration: 800 };
import { canEnter } from '$lib/server/access';
import {
  generatePreview,
  executeWeekStrategy,
  renderPreviewImages,
  normalizeWeeklyStrategy,
  attachBrandMoodImages,
  carouselMaxPerBatch,
  postQcPayload,
  type ContentPrefs,
  type PreviewPost,
  type PastWinner,
  type WeeklyStrategy
} from '$lib/server/content-preview';
import { normalizeContentFormat } from '$lib/content-formats';
import { attachBrandPeople } from '$lib/server/people';
import { attachBrandPages } from '$lib/server/content-library';
import { remaining, addUsage, monthKey } from '$lib/server/usage';
import { renderVideo } from '$lib/server/video';
import { ugcSpokenLine } from '$lib/server/ugc';
import { countForFrequency } from '$lib/server/plans';
import { loadActivePlan, currentWeekIndex, weekStrategyBrief, postsForWeek, setWeekStatus } from '$lib/server/editorial-plan';
import { activeGtmBrief } from '$lib/server/gtm';
import { loadApprovedRubrics } from '$lib/server/rubrics';
import { env } from '$env/dynamic/private';
import { loadGrowthReadiness, growthReadinessMessage } from '$lib/server/growth-readiness';
import { CreditsExhaustedError } from '$lib/server/credits';

// Autopilot manuale: ricostruisce una settimana dal profilo GIÀ SALVATO (nessuna rianalisi del
// sito). Stesso planner dell'onboarding, ma qui il risultato si persiste.
//
// Streaming NDJSON, perché la UI mostri ogni post appena la sua immagine atterra:
//   { type:'progress', step, message } … { type:'post', data } … { type:'done', planId } | { type:'error' }

export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession }, platform }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  // Body opzionale: `draftPlanId` produce una bozza già approvata invece di ripianificare;
  // con `rowIndex` produce UNA sola riga di quella bozza, le altre restano in revisione.
  const body = await request.json().catch(() => ({}));
  const draftPlanId = typeof body?.draftPlanId === 'string' ? body.draftPlanId : '';
  const rowIndex = Number.isInteger(body?.rowIndex) && body.rowIndex >= 0 ? (body.rowIndex as number) : null;

  // RLS restringe ogni lettura qui sotto ai brand del chiamante: questa lookup è il cancello.
  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, target_platforms, content_prefs, plan, timezone')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return new Response('Brand not found', { status: 404 });

  // Con Studio vuoto non si produce carta da parati: si dice esattamente cosa manca.
  const growth = await loadGrowthReadiness(supabase, brand.id);
  if (!growth.ready) {
    return new Response(
      JSON.stringify({
        type: 'error',
        code: 'growth_data_incomplete',
        message: growthReadinessMessage(growth),
        checks: growth.checks,
        ready: false
      }) + '\n',
      { status: 200, headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' } }
    );
  }

  // I seed SONO il piano: la prima passata è già avvenuta e l'utente ha approvato quelle righe.
  // La produzione le segue, non ripianifica.
  let draftStrategy: WeeklyStrategy | null = null;
  let draftRow: { id: string } | null = null;
  if (draftPlanId) {
    const { data: draft } = await supabase
      .from('content_plans')
      .select('id, status, seeds')
      .eq('id', draftPlanId)
      .eq('brand_id', brand.id)
      .maybeSingle();
    if (!draft || draft.status !== 'draft' || !draft.seeds) {
      return new Response(
        JSON.stringify({ type: 'error', message: 'Draft plan not found.' }) + '\n',
        { status: 200, headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' } }
      );
    }
    draftStrategy = normalizeWeeklyStrategy(draft.seeds);
    draftRow = { id: draft.id as string };
  }

  // Riga singola: il set completo si tiene per riscrivere nella bozza le righe rimaste.
  const fullDraftStrategy = draftStrategy;
  if (draftStrategy && rowIndex != null) {
    const seed = draftStrategy.seeds[rowIndex];
    if (!seed) {
      return new Response(
        JSON.stringify({ type: 'error', message: 'Row not found.' }) + '\n',
        { status: 200, headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' } }
      );
    }
    draftStrategy = { ...draftStrategy, seeds: [seed] };
  }

  // Questo è il trigger a pagamento (non l'anteprima gratuita dell'onboarding): conta sempre.
  const budget = await remaining(supabase, brand.id, brand.plan, brand.timezone);

  // Il profilo si assembla da quello che è già in archivio: nessuna fetch del sito.
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style')
    .eq('brand_id', brand.id)
    .maybeSingle();

  const { data: products } = await supabase
    .from('products')
    .select('title, description, pricing, images')
    .eq('brand_id', brand.id)
    .order('created_at', { ascending: true })
    .limit(12);

  const profile = {
    name: brand.name,
    category: kit?.category ?? '',
    about: kit?.about ?? '',
    target_audience: kit?.target_audience ?? '',
    brand_colors: kit?.brand_colors ?? [],
    ai_character: kit?.ai_character ?? {},
    ai_context: kit?.ai_context ?? '',
    visual_style: kit?.visual_style ?? '',
    // planPosts legge `.name`: title → name.
    products: (products ?? []).map((p) => ({
      name: p.title,
      description: p.description,
      pricing: p.pricing,
      images: p.images
    }))
  };

  await attachBrandPeople(profile, supabase, brand.id);
  await attachBrandPages(profile, supabase, brand.id).catch(swallow('attach brand pages'));

  // Immagini di riferimento del brand: ancorano il render all'estetica vera, non al solo brief.
  await attachBrandMoodImages(profile, supabase, brand.id);
  const { attachBrandLibraryMedia } = await import('$lib/server/brand-media');
  await attachBrandLibraryMedia(profile, supabase, brand.id);

  // I post passati che hanno funzionato davvero, per non fondare la settimana sul solo brief.
  const { data: history } = await supabase
    .from('social_post_history')
    .select('content, platform, metrics')
    .eq('brand_id', brand.id)
    .limit(200);
  const topPosts: PastWinner[] = [...(history ?? [])]
    .sort((a, b) => ((b.metrics as PastWinner['metrics'])?.engagementRate ?? 0) - ((a.metrics as PastWinner['metrics'])?.engagementRate ?? 0))
    .slice(0, 8);

  const prefs: ContentPrefs = (brand.content_prefs as ContentPrefs) ?? {};
  const platforms: string[] = Array.isArray(brand.target_platforms) ? brand.target_platforms : [];

  // Un batch manuale esegue la settimana CORRENTE del piano approvato, come l'autopilot.
  const editorialPlan = await loadActivePlan(supabase, brand.id);
  const weekIdx = editorialPlan ? currentWeekIndex(editorialPlan, brand.timezone) : null;
  const gtmBrief = await activeGtmBrief(supabase, brand.id, brand.timezone).catch((error) => { swallow('load gtm brief', error); return ''; });
  // Rubriche approvate ([] = comportamento pre-rubriche).
  const rubrics = await loadApprovedRubrics(supabase, brand.id).catch((error) => { swallow('load approved rubrics', error); return []; });
  const strategyBrief = [gtmBrief, editorialPlan && weekIdx != null ? weekStrategyBrief(editorialPlan, weekIdx, rubrics) : '']
    .filter(Boolean)
    .join('\n\n');

  const { loadPlannerMarketSignals } = await import('$lib/server/content-preview');
  const { marketBrief, competitorThumbUrls } = await loadPlannerMarketSignals(supabase, brand.id);

  // Con una bozza: esattamente le righe approvate. Altrimenti il conto della settimana, o la
  // cadenza. Sempre limato alla quota che resta.
  const desired = draftStrategy
    ? draftStrategy.seeds.length
    : editorialPlan && weekIdx != null
      ? postsForWeek(editorialPlan, weekIdx)
      : countForFrequency(prefs.frequency);
  const count = Math.min(desired, budget.posts);

  // Guardrail video interno, invisibile all'utente: mai più dei post che stiamo generando.
  const maxVideos = Math.min(budget.videos, count);

  // Rifiuto PRIMA di aprire lo stream, ma in NDJSON su una riga: il parser del client lo tratta
  // esattamente come un errore a metà stream.
  if (budget.posts <= 0) {
    return new Response(
      JSON.stringify({ type: 'error', code: 'posts_quota', message: 'Monthly quota reached — upgrade your plan for more posts.' }) + '\n',
      { status: 200, headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' } }
    );
  }

  if (budget.credits.remaining <= 0) {
    return new Response(
      JSON.stringify({ type: 'error', code: 'credits_exhausted', message: 'Credits exhausted.', resetDate: budget.credits.periodEnd.toISOString(), quota: budget.credits.quota, used: budget.credits.used }) + '\n',
      { status: 200, headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' } }
    );
  }

  // Gli insert partono da `onPost`, che è sincrona: qui si tengono per aspettarli tutti prima
  // di chiudere lo stream.
  const pending = new Set<Promise<void>>();
  // Si conta quello che si persiste davvero, non quello che si è chiesto: un insert fallito non
  // deve mangiare quota.
  let createdPosts = 0;
  // Solo clip VERI: un post ricaduto sulla copertina non è un video e non consuma budget video.
  let renderedVideos = 0;
  // Stessa fonte di verità che usa content-preview per limare (anche 'reel'/'short' legacy).
  // Questo predicato è il cancello del render Seedance, che si paga.
  const isVideoFormat = (format: string | null | undefined) => normalizeContentFormat(format) === 'video';

  // Senza KIE_API_KEY renderVideo non viene mai chiamato e tutto ricade sulla copertina.
  const videoEnabled = Boolean(env.KIE_API_KEY);

  // I render video si serializzano su questa catena: persist() gira in concorrenza, e lanciare
  // più job pesanti insieme rischia il rate limit di kie.ai e corre contro il contatore
  // maxVideos. I post di sole immagini non toccano la catena e restano paralleli.
  let videoChain: Promise<void> = Promise.resolve();

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      try {
        // Il contenitore del batch: la bozza approvata stessa, o una riga nuova. Titolo con data
        // ISO stabile, così due clic ravvicinati restano due righe distinte.
        let planId: string;
        if (draftRow) {
          planId = draftRow.id;
        } else {
          const title = `Week of ${new Date().toISOString().slice(0, 10)}`;
          const { data: plan, error: planErr } = await supabase
            .from('content_plans')
            .insert({
              brand_id: brand.id,
              title,
              source: 'manual_trigger',
              status: 'proposed',
              editorial_plan_id: editorialPlan && weekIdx != null ? (editorialPlan.id ?? null) : null,
              editorial_week: editorialPlan && weekIdx != null ? weekIdx : null
            })
            .select('id')
            .single();
          if (planErr || !plan) throw new Error(planErr?.message ?? 'Could not start a plan');
          planId = plan.id as string;
        }

        // Si persiste post per post: un guasto a metà stream lascia comunque quello prodotto.
        const persist = async (post: PreviewPost) => {
          // Quando onPost scatta la copertina è già renderizzata in post.imageUrl: si parte da
          // lì e si sale a clip vero solo più sotto, se il render riesce dentro il cap.
          let contentType = post.media === 'text' ? 'text' : post.media === 'link' ? 'link' : 'generated_image';
          let mediaUrl = post.imageUrl ?? null;
          // I clip Seedance Lite sono a secondi interi; null per i post immagine/testo.
          let videoDurationSeconds: number | null = null;
          let videoTaskId: string | null = null;
          let videoResolution: string | null = null;
          /** Task kie di un clip renderizzato fuori banda: il reconciler ci attacca il risultato. */
          let videoRenderTaskId: string | null = null;
          // La copertina da cui il clip è stato animato: media_url viene sovrascritto dall'mp4, e
          // senza questa colonna quel fotogramma è perso.
          let videoThumbnailUrl: string | null = null;

          // Serializzato su videoChain: un render alla volta, o renderedVideos supera il cap
          // sotto persist() concorrenti.
          if (videoEnabled && isVideoFormat(post.format) && post.image_prompt) {
            await (videoChain = videoChain.then(async () => {
              if (renderedVideos >= maxVideos) return; // out of guardrail headroom → keep cover
              // La copertina (già ancorata al brand e passata dal QC) guida un IMAGE-TO-VIDEO:
              // il clip anima il visual approvato invece di reinventare la scena dal testo.
              send({ type: 'progress', step: 'video', message: 'Rendering a short video…' });
              // Un errore qui NON deve abortire il post e nemmeno avvelenare videoChain: una
              // catena rifiutata farebbe fallire il video di ogni post SUCCESSIVO, non solo di
              // questo. Si ricade sulla copertina.
              const isUgc = post.ugc !== false;
              const isUgcAd = isUgc && post.ugc_ad === true;
              const { resolveVideoDuration, UGC_AD_DURATION } = await import('$lib/server/video');
              const { SEEDANCE_25_MODEL } = await import('$lib/video-models');
              const { buildUgcShotBrief, formatUgcShotBrief } = await import('$lib/server/ugc');
              const videoModel = isUgcAd ? SEEDANCE_25_MODEL : prefs.videoModel;
              const seconds = resolveVideoDuration(
                isUgcAd ? UGC_AD_DURATION : prefs.videoDuration,
                undefined,
                videoModel,
                { ugc: isUgc, ugcAd: isUgcAd }
              );
              const spoken = ugcSpokenLine(
                {
                  hook: post.hook ?? '',
                  body: post.body ?? '',
                  cta: post.cta ?? ''
                },
                seconds
              );
              const shotBrief = isUgc
                ? formatUgcShotBrief(
                    buildUgcShotBrief({
                      person: post.person,
                      product: post.product,
                      setting: post.setting,
                      hook: post.hook,
                      script: spoken,
                      seconds
                    }),
                    { script: spoken, product: post.product ?? undefined }
                  )
                : undefined;
              // Inviato, non atteso: un poll kie arriva a 600s e niente qui sotto dipende dal
              // clip — i post atterrano comunque in pending_user.
              const { submitAndTrackVideoRender, countOutstandingVideoRenders } = await import(
                '$lib/server/video-render-queue'
              );
              const { createAdminClient } = await import('$lib/server/supabase-admin');
              const admin = createAdminClient();
              // Anche i render in volo contano sul mese: il numero si addebita quando il clip
              // atterra, e il solo `usage` lascerebbe spendere la stessa allowance più volte.
              if ((await countOutstandingVideoRenders(admin, brand.id)) >= maxVideos) return;
              const clip = await submitAndTrackVideoRender({
                admin,
                brandId: brand.id,
                userId: user.id,
                // Attaccato dopo l'insert qui sotto.
                postId: null,
                threadId: null,
                imagePrompt: post.image_prompt,
                render: {
                duration: seconds,
                imageUrl: mediaUrl ?? undefined,
                visualStyle: profile.visual_style || undefined,
                instructions: prefs.videoInstructions,
                resolution: prefs.videoResolution,
                model: videoModel,
                // UGC è il default per i seed video: solo un false esplicito ne esce.
                ugc: isUgc,
                ugcAd: isUgcAd,
                // Senza lo script parlato il clip è b-roll muto e tutta la struttura
                // hook/body/cta scritta dal planner viene buttata.
                script: spoken,
                shotBrief
                }
              }).catch((error) => { swallow('render video clip', error); return null; });
              if (clip) {
                // media_url e content_type restano sulla copertina finché il reconciler non li
                // scambia: quella copertina è anche il poster e l'ancora di stile di un edit.
                videoThumbnailUrl = mediaUrl ?? null;
                videoDurationSeconds = clip.durationSeconds;
                videoResolution = clip.resolution;
                videoRenderTaskId = clip.taskId;
                renderedVideos += 1;
              }
            }));
          }

          const { data: row } = await supabase
            .from('posts')
            .insert({
              brand_id: brand.id,
              plan_id: planId,
              // Il piano resta la fonte di verità: il post ne è una proiezione che CONSERVA il
              // link alla riga sorgente.
              plan_row_id: post.planRowId ?? null,
              platform: String(post.platform ?? '').toLowerCase() || null,
              // Set di destinazioni: la pubblicazione si dirama su ogni account attivo qui dentro.
              platforms: post.platforms && post.platforms.length > 1 ? post.platforms : null,
              content_type: contentType,
              source: 'plan',
              caption: post.caption ?? null,
              title: post.title?.trim() || null,
              link_url: post.link_url || null,
              subreddit: post.subreddit?.trim() || null,
              image_prompt: post.image_prompt ?? null,
              // Un post promosso a clip vero non è mai un carosello: i formati sono disgiunti.
              image_prompts: post.image_prompts?.length ? post.image_prompts : null,
              media_url: mediaUrl,
              media_urls: post.imageUrls && post.imageUrls.length > 1 ? post.imageUrls : null,
              product_name: post.product?.trim() || null,
              pillar: post.pillar?.trim() || null,
              rubric_id: post.rubricId ?? null,
              angle: post.angle?.trim() || null,
              qc: postQcPayload(post),
              format: post.format || null,
              video_duration_seconds: videoDurationSeconds,
              // Scritto solo con un handle kie vero: senza la 0127 applicata, PostgREST
              // rifiuterebbe la colonna su OGNI insert non-video.
              ...(videoTaskId
                ? { video_task_id: videoTaskId, video_resolution: videoResolution }
                : {}),
              // Marca la copertina come provvisoria: approve e publish la rifiutano finché il clip non atterra.
              ...(videoRenderTaskId
                ? { video_render_status: 'rendering', video_resolution: videoResolution }
                : {}),
              // Stessa guardia di sopra, per la colonna della 0130.
              ...(videoThumbnailUrl ? { video_thumbnail_url: videoThumbnailUrl } : {}),
              slot: [post.day, post.time].filter(Boolean).join(' ') || null,
              status: 'pending_user'
            })
            .select('id')
            .single();
          // Conta solo un insert riuscito. Il video si contabilizza a parte da renderedVideos,
          // o si addebiterebbe due volte.
          if (row?.id) createdPosts += 1;
          // Il render è registrato PRIMA dell'insert di proposito: un insert fallito non deve far
          // perdere un task che kie sta già renderizzando e fatturerà.
          if (row?.id && videoRenderTaskId) {
            const { createAdminClient } = await import('$lib/server/supabase-admin');
            await createAdminClient()
              .from('video_renders')
              .update({ post_id: row.id as string })
              .eq('task_id', videoRenderTaskId)
              .then(undefined, () => {});
          }
          if (row?.id && mediaUrl) {
            const { queueVideoReview } = await import('$lib/server/video-review-store');
            await queueVideoReview(supabase, {
              brandId: brand.id,
              url: mediaUrl,
              postId: row.id as string,
              ugcAd: post.ugc_ad === true,
              durationSeconds: videoDurationSeconds
            });
          }
          // Solo i chunk davvero iniettati nel prompt della caption.
          if (row?.id && post.knowledgeChunkIds?.length) {
            try {
              const { recordChunkUsedByPost } = await import('$lib/server/knowledge');
              await recordChunkUsedByPost(supabase, brand.id, row.id as string, post.knowledgeChunkIds);
            } catch (e) {
              console.warn('[generate] recordChunkUsedByPost', e instanceof Error ? e.message : e);
            }
          }
          send({ type: 'post', data: { ...post, id: row?.id, media_url: mediaUrl, content_type: contentType } });
        };

        if (draftStrategy) {
          // L'utente ha già approvato queste righe: si scrive e si renderizza, mai ripianificare.
          send({ type: 'progress', step: 'writing', message: 'Writing the approved rows…' });
          const posts = await executeWeekStrategy(
            profile,
            { ...draftStrategy, seeds: draftStrategy.seeds.slice(0, count) },
            prefs,
            maxVideos,
            carouselMaxPerBatch(),
            {
              supabase,
              brandId: brand.id,
              userId: user.id,
              strategyBrief,
              topPosts,
              onProgress: (step, message) => send({ type: 'progress', step, message })
            }
          );
          await renderPreviewImages(profile, posts, {
            supabase,
            userId: user.id,
            brandId: brand.id,
            onProgress: (step, message) => send({ type: 'progress', step, message }),
            onPost: (post) => {
              pending.add(persist(post));
            }
          });
        } else {
          await generatePreview(
            profile,
            {
              supabase,
              userId: user.id,
              brandId: brand.id,
              timezone: brand.timezone,
              platforms,
              prefs,
              maxVideos,
              // env CAROUSEL_MAX_PER_BATCH, default 1; 0 = interruttore di spegnimento.
              maxCarousels: carouselMaxPerBatch(),
              rubrics,
              topPosts,
              strategyBrief,
              marketBrief,
              competitorThumbUrls,
              onProgress: (step, message) => send({ type: 'progress', step, message }),
              onPost: (post) => {
                // onPost è sincrona: l'insert parte qui e si aspetta prima di chiudere lo stream.
                pending.add(persist(post));
              }
            },
            count
          );
        }

        // Si aspetta ogni insert prima di dire 'done', o il reload del client vede un piano monco.
        await Promise.all([...pending]);

        if (renderedVideos > 0) {
          const { kickVideoReviewWork } = await import('$lib/server/video-review-store');
          const origin = new URL(request.url).origin;
          const p = platform as { context?: { waitUntil?: (pr: Promise<unknown>) => void } } | undefined;
          const kick = kickVideoReviewWork(origin, brand.id);
          if (p?.context?.waitUntil) p.context.waitUntil(kick);
          else await kick.catch(swallow('p.context.waitUntil failed'));
        }

        // Riga singola: si toglie solo il seed prodotto, e la bozza resta in revisione finché ne
        // restano; passa a 'proposed' quando è vuota.
        if (draftRow && createdPosts > 0) {
          if (rowIndex != null && fullDraftStrategy) {
            const remainingSeeds = fullDraftStrategy.seeds.filter((_, i) => i !== rowIndex);
            if (remainingSeeds.length) {
              await supabase
                .from('content_plans')
                .update({ seeds: { ...fullDraftStrategy, seeds: remainingSeeds } })
                .eq('id', draftRow.id);
            } else {
              await supabase.from('content_plans').update({ status: 'proposed' }).eq('id', draftRow.id);
            }
          } else {
            await supabase.from('content_plans').update({ status: 'proposed' }).eq('id', draftRow.id);
          }
        }

        if (editorialPlan?.id && weekIdx != null && createdPosts > 0) {
          await setWeekStatus(supabase, editorialPlan.id, weekIdx, 'planned').catch(swallow('set week status'));
        }

        // Si addebita solo quello che si è persistito davvero. monthKey usa il fuso del brand.
        await addUsage(supabase, brand.id, monthKey(brand.timezone), {
          posts: createdPosts,
          videos: renderedVideos
        });

        const { getCreditsUsage, maybeSendCreditWarning } = await import('$lib/server/credits');
        const creditUsage = await getCreditsUsage(supabase, brand);
        await maybeSendCreditWarning(supabase, brand, creditUsage);

        send({ type: 'done', planId });
      } catch (e) {
        // I crediti possono finire A METÀ stream, non solo al gate iniziale: si manda `code`,
        // non il messaggio grezzo, o la pagina non sa scegliere la chiave i18n né l'upgrade.
        const code = e instanceof CreditsExhaustedError ? 'credits_exhausted' : undefined;
        send({ type: 'error', code, message: e instanceof Error ? e.message : 'Generation failed' });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' }
  });
};
