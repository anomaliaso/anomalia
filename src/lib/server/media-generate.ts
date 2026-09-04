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
import { signKnowledgePaths } from '$lib/server/media-archive';
import { markImage, DIGITAL_SOURCE_TYPE } from '$lib/server/content-credentials';
import type { AspectRatio } from '$lib/server/content-preview';

export type GeneratedMedia = {
  id: string;
  kind: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  signed_url: string | null;
};

export type GenerateMediaOpts = {
  brandId: string;
  userId: string;
  prompt: string;
  kind?: 'image' | 'video';
  count?: number;
  aspectRatio?: AspectRatio;
  title?: string;
};

export type GenerateMediaResult =
  | { ok: true; status: 'ready'; media: GeneratedMedia[]; jobId: null }
  | { ok: true; status: 'rendering'; media: []; jobId: string }
  | { ok: false; error: 'render_failed' | 'store_failed' | 'video_budget_exhausted' };

const IMAGE_MIME = 'image/png';

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
  opts: GenerateMediaOpts,
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

  const signed = await signKnowledgePaths(supabase, [storagePath]).catch(() => new Map<string, string>());

  return {
    id: row.id,
    kind: row.kind,
    mime: decoded.mime,
    width,
    height,
    signed_url: signed.get(storagePath) ?? null
  };
}

async function generateImages(
  supabase: SupabaseClient,
  opts: GenerateMediaOpts
): Promise<GenerateMediaResult> {
  const [{ renderPostImage }, { imageModelFor, imageRefineModelFor }] = await Promise.all([
    import('$lib/server/content-preview'),
    import('$lib/image-models')
  ]);

  const { data: brand } = await supabase
    .from('brands')
    .select('content_prefs')
    .eq('id', opts.brandId)
    .maybeSingle();
  const prefs = (brand?.content_prefs ?? {}) as Record<string, unknown>;

  const media: GeneratedMedia[] = [];
  for (let i = 0; i < (opts.count ?? 1); i++) {
    // Il primo argomento è morto da quando renderPostImage costruisce il proprio client: lo
    // dichiara `void ai` e ogni altro chiamante gli passa null allo stesso modo.
    const dataUrl = await renderPostImage(null as never, opts.prompt, {
      model: imageModelFor(prefs),
      refineModel: imageRefineModelFor(prefs),
      aspectRatio: opts.aspectRatio
    }).catch(() => undefined);
    if (!dataUrl) break;

    const deposited = await depositImage(supabase, opts, dataUrl);
    if (!deposited) return { ok: false, error: 'store_failed' };

    media.push(deposited);
  }

  // Nessuna alternativa prodotta è un fallimento, non un successo vuoto: chi legge `ok` deve poter
  // credere che qualcosa esista.
  if (!media.length) return { ok: false, error: 'render_failed' };

  return { ok: true, status: 'ready', media, jobId: null };
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
      duration: prefs.videoDuration as number | undefined,
      instructions: prefs.videoInstructions as string | null | undefined,
      resolution: prefs.videoResolution as string | null | undefined,
      model: prefs.videoModel as string | null | undefined
    }
  });
  if (!submitted) return { ok: false, error: 'render_failed' };

  const { data: job } = await admin
    .from('video_renders')
    .select('id')
    .eq('task_id', submitted.taskId)
    .maybeSingle();
  if (!job) return { ok: false, error: 'store_failed' };

  return { ok: true, status: 'rendering', media: [], jobId: job.id as string };
}

export async function generateBrandMedia(
  supabase: SupabaseClient,
  opts: GenerateMediaOpts
): Promise<GenerateMediaResult> {
  const { withBrandContext } = await import('$lib/server/ai-log');

  return withBrandContext(opts.brandId, () =>
    opts.kind === 'video' ? startVideo(opts) : generateImages(supabase, opts)
  );
}

export type MediaJob = {
  id: string;
  status: string;
  media_id: string | null;
  error: string | null;
  submitted_at: string | null;
};

const JOBS_PAGE = 20;

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
