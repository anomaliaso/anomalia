/**
 * Generare verso la LIBRERIA del brand, non verso un post.
 *
 *   genera → l'asset entra in brand_media → create_post lo attacca con media_ids
 *
 * L'ultimo passo esisteva già; mancava il primo, e senza di lui un agente esterno doveva creare
 * un post finto in calendario per ottenere un'immagine — poi cancellarlo. Tre direzioni visive
 * erano tre post da buttare, e l'asset nasceva attaccato a un post invece che riutilizzabile.
 *
 * Il vincolo del post era cablaggio, non un vincolo vero: `renderPostImage` prende una stringa, e
 * la coda `video_renders` accetta `post_id` nullo da sempre. Qui si usa quello che c'era.
 *
 * Immagine e video hanno due tempi diversi e quindi due forme diverse:
 *
 *   immagine  →  sincrona, ~10s   →  { status: 'ready',     media: [...] }
 *   video     →  minuti           →  { status: 'rendering', jobId }  → check_media_job
 *
 * Aspettare un video non è un'opzione: il poll di kie arriva a 600s contro un muro di funzione a
 * 300s, quindi chi aspetta muore sempre a metà. È il reconciler del cron a finirlo.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertBrandMedia, storeBrandMediaBytes, probeImageDimensions } from '$lib/server/brand-media';
import { mediaUrl } from '$lib/media-url';
import { markImage, DIGITAL_SOURCE_TYPE } from '$lib/server/content-credentials';
import type { AspectRatio } from '$lib/server/content-preview';

export type GeneratedMedia = {
  id: string;
  kind: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  url: string | null;
};

export type GenerateMediaOpts = {
  brandId: string;
  userId: string;
  prompt: string;
  kind?: 'image' | 'video';
  count?: number;
  aspectRatio?: AspectRatio;
  title?: string;
  /** Vale per QUESTA chiamata soltanto: nessuna preferenza del brand viene toccata. */
  model?: string;
  /** Un'IMMAGINE della libreria da animare. Presente → image-to-video, ed e' «anima questa foto». */
  baseMediaId?: string;
  /** Secondi. Assente → la preferenza del brand. */
  durationSeconds?: number;
};

export type GenerateMediaResult =
  | {
      ok: true;
      status: 'ready';
      media: GeneratedMedia[];
      jobId: null;
      model: string | null;
      renders: number;
    }
  | { ok: true; status: 'rendering'; media: []; jobId: string; model: string | null; renders: 0 }
  | {
      ok: false;
      error:
        | 'render_failed'
        | 'store_failed'
        | 'video_budget_exhausted'
        | 'source_not_found'
        | 'source_not_an_image';
    }
  | { ok: false; error: 'model_not_for_slot'; allowed: string[] };

const IMAGE_MIME = 'image/png';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quanti asset si guardano per sciogliere un prefisso: gli id soltanto, quindi una lettura corta. */
const PREFIX_SCAN = 500;

/**
 * Un prefisso corto come lo accettano gli id dei post, ma risolto QUI e non nel livello MCP: li'
 * varrebbe solo per chi passa da MCP, e la CLI o una chiamata HTTP diretta resterebbero senza.
 *
 * Ambiguo e inesistente collassano nello stesso rifiuto di proposito: in entrambi i casi non
 * abbiamo UN asset, e ricadere sulla generazione — disegnare da zero credendo di modificare — e'
 * il difetto che questo percorso esiste per togliere.
 */
async function resolveLibraryId(
  supabase: SupabaseClient,
  brandId: string,
  idOrPrefix: string
): Promise<{ id: string; kind: string } | null> {
  const want = idOrPrefix.trim().toLowerCase();
  if (!want) return null;

  // Si interroga SEMPRE, anche per un id completo. Prima l'id intero saltava la lettura e passava
  // dritto: l'appartenenza la scopriva solo il passo dopo, che sa dire «non e' un'immagine» ma non
  // «non e' tua» — e un id di un altro inquilino tornava con l'errore sbagliato.
  const { data } = await supabase
    .from('brand_media')
    .select('id, kind')
    .eq('brand_id', brandId)
    .limit(PREFIX_SCAN);
  const rows = (data ?? []) as Array<{ id: string; kind: string }>;
  const hits = rows.filter((r) => String(r.id).toLowerCase().startsWith(want));

  return hits.length === 1 ? { id: String(hits[0].id), kind: String(hits[0].kind) } : null;
}

function dataUrlBytes(dataUrl: string): { bytes: Buffer; mime: string } | null {
  const [head, base64] = dataUrl.split(',');
  if (!base64) return null;

  return { bytes: Buffer.from(base64, 'base64'), mime: head?.match(/data:([^;]+)/)?.[1] ?? IMAGE_MIME };
}

/**
 * Un'immagine generata finisce nel bucket privato della libreria, non fra i media pubblici dei
 * post: è materiale del brand, riutilizzabile, e nessuno deve poterla leggere senza una firma.
 */
async function depositImage(
  supabase: SupabaseClient,
  opts: Pick<GenerateMediaOpts, 'brandId' | 'userId' | 'prompt' | 'title'>,
  dataUrl: string
): Promise<GeneratedMedia | null> {
  const decoded = dataUrlBytes(dataUrl);
  if (!decoded) return null;

  // Marcata sintetica prima di toccare lo storage: un'immagine di modello che gira senza la sua
  // provenienza è un problema che non si ripara a valle.
  const bytes = await markImage(decoded.bytes, decoded.mime, DIGITAL_SOURCE_TYPE.synthetic);
  const ext = decoded.mime.includes('jpeg') ? 'jpg' : decoded.mime.includes('webp') ? 'webp' : 'png';
  const fileName = `generated-${crypto.randomUUID()}.${ext}`;
  const storagePath = `${opts.userId}/${opts.brandId}/media/${fileName}`;

  const stored = await storeBrandMediaBytes(supabase, storagePath, bytes, decoded.mime);
  if (stored.error) return null;

  const { width, height } = await probeImageDimensions(bytes);
  const { row } = await insertBrandMedia(supabase, {
    brandId: opts.brandId,
    userId: opts.userId,
    storagePath,
    fileName,
    mime: decoded.mime,
    bytes: bytes.length,
    width,
    height,
    source: 'generate',
    title: opts.title?.trim() || opts.prompt.slice(0, 80)
  });
  if (!row) return null;

  return {
    id: row.id,
    kind: row.kind,
    mime: decoded.mime,
    width,
    height,
    url: mediaUrl(row.short_code)
  };
}

/**
 * UNA SOLA funzione per disegnare e per modificare, perché il motore è lo stesso: `baseImage` è
 * l'unico segnale che `buildImageRequest` guarda per distinguere una modifica da un disegno nuovo.
 * I tool esposti restano due — generare e rifinire sono due operazioni diverse per chi chiama, e
 * vogliono argomenti diversi — ma qui sotto sarebbero due copie della stessa cosa.
 */
export type ImageJob = {
  brandId: string;
  userId: string;
  /** Cosa mostrare, oppure — con `baseMediaId` — cosa cambiare. */
  prompt: string;
  count?: number;
  aspectRatio?: AspectRatio;
  title?: string;
  /** Vale per QUESTA chiamata: non tocca `content_prefs`, che è il mestiere di set_media_model. */
  model?: string;
  /** L'immagine della libreria da cui partire. Presente → è una modifica. */
  baseMediaId?: string;
};

export type ImageJobResult =
  | { ok: true; media: GeneratedMedia[]; model: string | null; renders: number }
  | { ok: false; error: 'render_failed' | 'store_failed' | 'source_not_found' }
  | { ok: false; error: 'model_not_for_slot'; allowed: string[] };

async function runImageJob(
  supabase: SupabaseClient,
  job: ImageJob
): Promise<ImageJobResult> {
  const [
    { renderPostImage, buildImageRequest },
    { imageModelFor, imageRefineModelFor },
    { mediaModelSlot, slotAccepts, slotChoices },
    { loadLibraryMediaParts }
  ] = await Promise.all([
    import('$lib/server/content-preview'),
    import('$lib/image-models'),
    import('$lib/media-model-slots'),
    import('$lib/server/brand-media')
  ]);

  // Il catalogo è quello vero, lo stesso che governa set_media_model: un secondo elenco
  // divergerebbe dal primo al prossimo modello aggiunto, e la metà vecchia rifiuterebbe in
  // silenzio un modello valido.
  const refining = !!job.baseMediaId;
  const slot = mediaModelSlot(refining ? 'imageRefineModel' : 'imageModel');
  if (job.model && slot && !slotAccepts(slot, job.model)) {
    return { ok: false, error: 'model_not_for_slot', allowed: slotChoices(slot).map((c) => c.id) };
  }

  const { data: brand } = await supabase
    .from('brands')
    .select('content_prefs')
    .eq('id', job.brandId)
    .maybeSingle();
  const prefs = (brand?.content_prefs ?? {}) as Record<string, unknown>;

  // `loadLibraryMediaParts` filtra per brand_id: l'id di un altro inquilino non risolve nulla, e
  // il confine resta nella query invece che in un controllo che qualcuno dimenticherà.
  let baseImage: { inlineData: { mimeType: string; data: string } } | undefined;
  if (job.baseMediaId) {
    const source = await resolveLibraryId(supabase, job.brandId, job.baseMediaId);
    if (!source) return { ok: false, error: 'source_not_found' };

    const parts = await loadLibraryMediaParts(supabase, job.brandId, [source.id], 1);
    if (!parts.length) return { ok: false, error: 'source_not_found' };
    baseImage = parts[0];
  }

  const opts = {
    model: refining ? imageModelFor(prefs) : (job.model ?? imageModelFor(prefs)),
    refineModel: refining ? (job.model ?? imageRefineModelFor(prefs)) : imageRefineModelFor(prefs),
    baseImage,
    aspectRatio: job.aspectRatio
  };

  // Il modello riportato viene dalla STESSA funzione che costruisce la richiesta, non da una copia
  // della sua tabella: chiedere due volte la stessa cosa è gratis, tenerne due versioni no.
  const chosen = buildImageRequest(job.prompt, opts).model ?? null;

  const media: GeneratedMedia[] = [];
  // Quanti render sono stati PAGATI, non quanti ne sono stati chiesti. Un render riuscito che
  // qualcosa a valle scarta si paga lo stesso, e finche' il conto dichiarato racconta le immagini
  // invece dei render, mente — in silenzio, perche' `ai_calls` si riempie di `ok: true`.
  let renders = 0;
  for (let i = 0; i < (job.count ?? 1); i++) {
    renders += 1;
    const dataUrl = await renderPostImage(null as never, job.prompt, opts).catch(() => undefined);
    if (!dataUrl) break;

    const deposited = await depositImage(supabase, job, dataUrl);
    if (!deposited) return { ok: false, error: 'store_failed' };

    media.push(deposited);
  }

  // Nessuna alternativa prodotta è un fallimento, non un successo vuoto: chi legge `ok` deve poter
  // credere che qualcosa esista.
  if (!media.length) return { ok: false, error: 'render_failed' };

  return { ok: true, media, model: chosen, renders };
}

export async function generateBrandImages(
  supabase: SupabaseClient,
  job: Omit<ImageJob, 'baseMediaId'>
): Promise<ImageJobResult> {
  const { withBrandContext } = await import('$lib/server/ai-log');

  return withBrandContext(job.brandId, () => runImageJob(supabase, job));
}

export async function refineBrandImage(
  supabase: SupabaseClient,
  job: ImageJob & { baseMediaId: string }
): Promise<ImageJobResult> {
  const { withBrandContext } = await import('$lib/server/ai-log');

  return withBrandContext(job.brandId, () => runImageJob(supabase, job));
}

/**
 * 4:5 è un formato da fotografia e nessun modello video lo accetta: passarlo rimappato su un altro
 * sarebbe consegnare una clip con un taglio che nessuno ha chiesto. Qui cade, e vale il default.
 */
const VIDEO_ASPECTS = ['1:1', '9:16', '16:9'] as const;

function videoAspect(ratio?: AspectRatio) {
  return VIDEO_ASPECTS.find((a) => a === ratio);
}

async function startVideo(opts: GenerateMediaOpts): Promise<GenerateMediaResult> {
  const [{ createAdminClient }, { countOutstandingVideoRenders, submitAndTrackVideoRender }] =
    await Promise.all([
      import('$lib/server/supabase-admin'),
      import('$lib/server/video-render-queue')
    ]);
  const admin = createAdminClient();

  const { data: brand } = await admin
    .from('brands')
    .select('plan, timezone, content_prefs')
    .eq('id', opts.brandId)
    .maybeSingle();
  const prefs = (brand?.content_prefs ?? {}) as Record<string, string | number | null>;

  // Animare una foto e filmare da un prompt sono due MESTIERI, e il catalogo lo sa gia': lo slot
  // cambia, quindi cambia anche l'elenco dei modelli ammessi. Sceglierne uno solo accetterebbe un
  // modello che poi il renderer scarta.
  const { mediaModelSlot, slotAccepts, slotChoices } = await import('$lib/media-model-slots');
  const slot = mediaModelSlot(opts.baseMediaId ? 'videoImageModel' : 'videoModel');
  if (opts.model && slot && !slotAccepts(slot, opts.model)) {
    return { ok: false, error: 'model_not_for_slot', allowed: slotChoices(slot).map((c) => c.id) };
  }

  // La copertina e' l'immagine da animare, e vive nella libreria di QUESTO brand: la risoluzione
  // passa da resolveBrandImageIds, che filtra `brand_id` nella query e per un id di un altro
  // inquilino non restituisce niente. Non trovarla FERMA la richiesta: filmare da zero un prompt
  // quando qualcuno ha chiesto di animare la sua foto e' il difetto travestito da rimedio.
  let coverUrl: string | undefined;
  if (opts.baseMediaId) {
    const source = await resolveLibraryId(admin, opts.brandId, opts.baseMediaId);
    if (!source) return { ok: false, error: 'source_not_found' };
    if (source.kind !== 'image') return { ok: false, error: 'source_not_an_image' };

    const { resolveBrandImageIds } = await import('$lib/server/brand-media');
    const urls = await resolveBrandImageIds(admin, opts.brandId, [source.id]);
    // resolveBrandImageIds guarda solo `kind = 'image'`: un id che esiste ma e' un video non
    // risolve, e va detto con un errore suo invece che confuso con «non esiste».
    if (!urls.length) return { ok: false, error: 'source_not_an_image' };
    coverUrl = urls[0];
  }

  const { remaining } = await import('$lib/server/usage');
  const budget = await remaining(admin, opts.brandId, brand?.plan, brand?.timezone ?? 'Europe/Rome');

  // I render in volo contano sull'allowance: il numero mensile si addebita quando il clip atterra,
  // e guardare solo `usage` lascerebbe spendere lo stesso budget più volte di fila.
  const inFlight = await countOutstandingVideoRenders(admin, opts.brandId);
  if (budget.videos - inFlight <= 0) return { ok: false, error: 'video_budget_exhausted' };

  const submitted = await submitAndTrackVideoRender({
    admin,
    brandId: opts.brandId,
    userId: opts.userId,
    postId: null,
    threadId: null,
    // `imagePrompt` è la SCENA — cosa si vede. `render.prompt` sarebbe il brief di regia (camera,
    // movimento, energia) e resta vuoto apposta: ripeterci dentro la stessa stringa la
    // duplicherebbe nel prompt finale, dove scena e regia vengono concatenate.
    imagePrompt: opts.prompt,
    render: {
      aspectRatio: videoAspect(opts.aspectRatio),
      // Con una copertina il modello parte da quei pixel: soggetto, scena e stile sono gia' li',
      // e il prompt dirige il MOVIMENTO.
      imageUrl: coverUrl,
      duration: opts.durationSeconds ?? (prefs.videoDuration as number | undefined),
      instructions: prefs.videoInstructions as string | null | undefined,
      resolution: prefs.videoResolution as string | null | undefined,
      model:
        opts.model ??
        ((opts.baseMediaId ? prefs.videoImageModel : prefs.videoModel) as string | null | undefined)
    }
  });
  if (!submitted) return { ok: false, error: 'render_failed' };

  const { data: job } = await admin
    .from('video_renders')
    .select('id')
    .eq('task_id', submitted.taskId)
    .maybeSingle();
  if (!job) return { ok: false, error: 'store_failed' };

  return {
    ok: true,
    status: 'rendering',
    media: [],
    jobId: job.id as string,
    model: submitted.model ?? null,
    renders: 0
  };
}

/**
 * La porta d'ingresso storica, tenuta viva. Non fa piu' il lavoro: lo inoltra a generate_image e
 * generate_video, che sono i due tool che un agente dovrebbe chiamare. Cancellarla mentre stiamo
 * moltiplicando le capacita' toglierebbe una capacita' a chi la sta gia' usando.
 */
/**
 * Un clip verso la LIBRERIA, senza post. Con `baseMediaId` e' «anima questa foto»: la strada che
 * mancava, e per cui l'agente esterno rispondeva che serviva prima una bozza.
 */
export async function generateBrandVideo(opts: GenerateMediaOpts): Promise<GenerateMediaResult> {
  const { withBrandContext } = await import('$lib/server/ai-log');

  return withBrandContext(opts.brandId, () => startVideo(opts));
}

export async function generateBrandMedia(
  supabase: SupabaseClient,
  opts: GenerateMediaOpts
): Promise<GenerateMediaResult> {
  if (opts.kind === 'video') {
    const { withBrandContext } = await import('$lib/server/ai-log');
    return withBrandContext(opts.brandId, () => startVideo(opts));
  }

  const out = await generateBrandImages(supabase, opts);
  if (!out.ok) return out;

  return { ok: true, status: 'ready', media: out.media, jobId: null, model: out.model, renders: out.renders };
}

export type MediaJob = {
  id: string;
  status: string;
  media_id: string | null;
  error: string | null;
  submitted_at: string | null;
};

const JOBS_PAGE = 20;

export const CLIP_NOT_IN_LIBRARY = 'not_in_library';
const NOTHING_CLAIMED_IT =
  'the clip rendered and is stored, but it never reached the library, so there is no media_id to ' +
  'use — generating it again would pay for a second copy';

/**
 * I lavori di questo brand, e SOLO di questo brand: l'id arriva da `loadBrandForUser`, mai dal
 * chiamante, quindi un job_id indovinato di un altro brand non trova niente.
 */
export async function listMediaJobs(
  supabase: SupabaseClient,
  brandId: string,
  jobId?: string
): Promise<MediaJob[]> {
  let query = supabase
    .from('video_renders')
    .select('id, status, error, submitted_at')
    .eq('brand_id', brandId)
    .is('post_id', null)
    .order('submitted_at', { ascending: false })
    .limit(JOBS_PAGE);
  if (jobId) query = query.eq('id', jobId);

  const { data } = await query;
  const rows = (data ?? []) as Array<Omit<MediaJob, 'media_id'>>;
  if (!rows.length) return [];

  // L'asset depositato porta l'id del job in `source_ref`: è così che un lavoro finito diventa un
  // media_id che create_post accetta, senza una colonna in più su video_renders.
  const { data: assets } = await supabase
    .from('brand_media')
    .select('id, source_ref')
    .eq('brand_id', brandId)
    .in('source_ref', rows.map((r) => r.id));
  const byJob = new Map(
    ((assets ?? []) as Array<{ id: string; source_ref: string }>).map((a) => [a.source_ref, a.id])
  );

  return rows.map((r) => ({ ...r, media_id: byJob.get(r.id) ?? null }));
}
