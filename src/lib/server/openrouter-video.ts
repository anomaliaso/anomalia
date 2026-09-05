/**
 * Il video su OpenRouter, che è una superficie SUA — `/videos`, non `/chat/completions`. Cercare i
 * 28 modelli video in `GET /models` dà zero risultati e fa concludere che non esistano.
 *
 * A differenza delle immagini qui NON c'è il regalo del sincrono: si invia, si riceve un `jobId`, e
 * si interroga finché non finisce. Cioè lo stesso rischio che su kie è costato clip pagate due
 * volte, e quindi la stessa forma della soluzione già in produzione (#325):
 *
 *   · l'esito è esplicito — `done` / `failed` / `timeout`, mai un `undefined` che li confonde;
 *   · una SCADENZA porta con sé il `jobId`, perché il lavoro è ancora del fornitore e lo fattura
 *     lui: il tentativo dopo riprende quello, e ritentare da capo resta legittimo solo sui rifiuti;
 *   · una scadenza lascia una riga in `ai_calls` con l'id e SENZA costo inventato — ignoto non è
 *     zero, e non è nemmeno `null` per distrazione: `ok = false` dice che non l'abbiamo pagata noi.
 *
 * PREZZO: da `usage.cost`, la fattura di OpenRouter per QUESTO job. Mai da un listino a mano — la
 * stima a priori sta in `pricing_skus` sul catalogo, e il conto vero lo dice chi lo manda.
 */
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';
import { clampVideoPrompt, videoModelSpec } from '$lib/video-models';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

export type OpenrouterVideoOutcome =
  | { status: 'done'; url: string; jobId: string; costUsd?: number }
  | { status: 'failed'; jobId?: string; error: string }
  | { status: 'timeout'; jobId: string };

export type OpenrouterVideoRender = {
  model: string;
  prompt: string;
  durationSeconds: number;
  resolution: string;
  aspectRatio: string;
  imageUrl?: string;
  lastFrameUrl?: string;
};

function apiKey(): string | undefined {
  return env.OPENROUTER_API_KEY?.trim() || env.LLM_API_KEY?.trim() || undefined;
}

function baseUrl(): string {
  return (env.LLM_VIDEO_BASE_URL?.trim() || OPENROUTER_BASE_URL).replace(/\/$/, '');
}

/** Gli header valgono anche per SCARICARE la clip: `unsigned_urls` senza chiave torna 401. */
export function openrouterVideoHeaders(): Record<string, string> {
  return { authorization: `Bearer ${apiKey() ?? ''}` };
}

/** Undefined quando il catalogo video di OpenRouter non ha quel modello: non è servibile di qui. */
export function openrouterVideoModel(model: string): string | undefined {
  return videoModelSpec(model)?.openrouterId;
}

const JOB_TAG = 'openrouter:';

/**
 * L'id che finisce su `video_renders.task_id` porta scritto CHI lo può interrogare.
 *
 * Una riga in coda sopravvive al deploy che cambia `AI_ROUTE_VIDEO`: senza il marchio, il
 * riconciliatore chiederebbe a kie un job di OpenRouter, non lo troverebbe mai, e la clip pagata
 * resterebbe lì. Il trasporto si legge dalla RIGA, mai dalla variabile d'ambiente di adesso.
 */
export function tagOpenrouterJob(jobId: string): string {
  return `${JOB_TAG}${jobId}`;
}

export function untagOpenrouterJob(taskId: string): string | undefined {
  return taskId.startsWith(JOB_TAG) ? taskId.slice(JOB_TAG.length) : undefined;
}

type Frame = { type: 'image_url'; image_url: { url: string }; frame_type: 'first_frame' | 'last_frame' };

export function buildOpenrouterVideoInput(
  model: string,
  render: OpenrouterVideoRender
): Record<string, unknown> {
  const frames: Frame[] = [];
  if (render.imageUrl) {
    frames.push({ type: 'image_url', image_url: { url: render.imageUrl }, frame_type: 'first_frame' });
  }
  if (render.imageUrl && render.lastFrameUrl) {
    frames.push({ type: 'image_url', image_url: { url: render.lastFrameUrl }, frame_type: 'last_frame' });
  }
  return {
    model,
    prompt: clampVideoPrompt(render.prompt, render.model),
    duration: render.durationSeconds,
    resolution: render.resolution,
    ...(frames.length ? { frame_images: frames } : { aspect_ratio: render.aspectRatio })
  };
}

/**
 * Consegna il lavoro e si ferma. Il percorso asincrono si ferma QUI: l'attesa non compra niente, e
 * il `jobId` e' un appiglio durevole che qualunque processo puo' riprendere.
 *
 * Non scrive nessuna riga in `ai_calls`: il costo lo dira' il job finito, e un invio che non
 * diventa mai una clip non si fattura — lo stesso contratto del percorso kie.
 */
export async function submitOpenrouterVideo(
  render: OpenrouterVideoRender,
  signal?: AbortSignal
): Promise<{ jobId?: string; error?: string }> {
  if (!apiKey()) return { error: 'OPENROUTER_API_KEY assente: questo render non ha un trasporto' };
  const model = openrouterVideoModel(render.model);
  if (!model) return { error: `${render.model} non è nel catalogo video di OpenRouter` };
  return submit(model, render, signal);
}

async function submit(
  model: string,
  render: OpenrouterVideoRender,
  signal?: AbortSignal
): Promise<{ jobId?: string; error?: string }> {
  const res = await fetch(`${baseUrl()}/videos`, {
    method: 'POST',
    headers: { ...openrouterVideoHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify(buildOpenrouterVideoInput(model, render)),
    signal
  });
  const body = await res.json().catch(() => ({}));
  const jobId = body?.id;
  if (!res.ok || !jobId) {
    return { error: String(body?.error?.message ?? body?.error ?? `HTTP ${res.status}`).slice(0, 400) };
  }
  return { jobId: String(jobId) };
}

const TERMINAL_FAILURES = ['failed', 'cancelled', 'canceled', 'expired'];

/**
 * Una interrogazione sola, senza attese: è ciò che serve al riconciliatore, che è un tick di cron e
 * non un processo seduto su un timer. `pending` non è un esito, è "richiedi più tardi".
 */
export async function checkOpenrouterVideo(
  jobId: string,
  signal?: AbortSignal
): Promise<OpenrouterVideoOutcome | { status: 'pending' }> {
  const res = await fetch(`${baseUrl()}/videos/${encodeURIComponent(jobId)}`, {
    headers: openrouterVideoHeaders(),
    signal
  });
  // Un 5xx non è un render fallito: il job resta del fornitore, si richiede al giro dopo.
  if (!res.ok) return { status: 'pending' };

  const body = await res.json().catch(() => null);
  const state = String(body?.status ?? '');
  if (TERMINAL_FAILURES.includes(state)) {
    const why = body?.error?.message ?? body?.error ?? state;
    return { status: 'failed', jobId, error: String(why).slice(0, 400) };
  }
  if (state !== 'completed') return { status: 'pending' };

  const url = body?.unsigned_urls?.[0];
  if (!url) return { status: 'failed', jobId, error: 'completato senza nessuna clip' };
  const cost = Number(body?.usage?.cost);
  return { status: 'done', url: String(url), jobId, costUsd: Number.isFinite(cost) ? cost : undefined };
}

/**
 * Invia (o RIPRENDE) e attende. `resumeJobId` è l'intera ragione per cui questa funzione non
 * assomiglia a un ciclo qualunque: senza, un secondo tentativo dopo una scadenza aprirebbe un
 * secondo job mentre il primo continua a renderizzare, e li paghiamo entrambi.
 */
export async function renderOpenrouterVideo(
  render: OpenrouterVideoRender,
  opts: {
    resumeJobId?: string;
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
    label?: string;
    context?: string;
  } = {}
): Promise<OpenrouterVideoOutcome> {
  const label = opts.label ?? 'video.render';
  const t0 = Date.now();

  const model = openrouterVideoModel(render.model);
  const done = (outcome: OpenrouterVideoOutcome): OpenrouterVideoOutcome => {
    logAiCall({
      label,
      provider: 'openrouter',
      model: model ?? render.model,
      prompt: render.prompt,
      ms: Date.now() - t0,
      ok: outcome.status === 'done',
      error: outcome.status === 'done' ? undefined : outcome.status === 'failed' ? outcome.error : 'timeout',
      ...(outcome.status === 'done' && outcome.costUsd != null ? { flatCostUsd: outcome.costUsd } : {}),
      context: [opts.context, `${render.durationSeconds}s ${render.resolution}`, outcome.jobId && `job ${outcome.jobId}`]
        .filter(Boolean)
        .join(' · ')
    });
    return outcome;
  };

  if (!apiKey()) return done({ status: 'failed', error: 'OPENROUTER_API_KEY assente: questo render non ha un trasporto' });
  if (!model) return done({ status: 'failed', error: `${render.model} non è nel catalogo video di OpenRouter` });

  let jobId = opts.resumeJobId;
  if (!jobId) {
    const created = await submit(model, render, opts.signal);
    if (!created.jobId) return done({ status: 'failed', error: created.error ?? 'invio rifiutato' });
    jobId = created.jobId;
  }

  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + (opts.timeoutMs ?? POLL_TIMEOUT_MS);
  let first = true;
  while (!opts.signal?.aborted) {
    if (!first) {
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    first = false;
    const outcome = await checkOpenrouterVideo(jobId, opts.signal);
    if (outcome.status !== 'pending') return done(outcome);
    if (Date.now() >= deadline) break;
  }

  // ABBANDONATO, non annullato: OpenRouter non espone un annullamento sulla superficie video, e il
  // job resta suo. L'unica cosa onesta è riprendere questo id, mai aprirne un altro.
  console.error(`[${label}] job openrouter ${jobId} non finito dopo ${Math.round((opts.timeoutMs ?? POLL_TIMEOUT_MS) / 1000)}s`);
  return done({ status: 'timeout', jobId });
}
