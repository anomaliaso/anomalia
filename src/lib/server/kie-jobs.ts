/**
 * Immagini e voce su kie.ai — la API a JOB, non `generateContent`.
 *
 * Perché esiste: le immagini sono ~46% della spesa AI e su kie costano meno per la stessa famiglia
 * di modelli (Nano Banana Pro/2 è lo stesso modello di Google, rivenduto). Misurato su chiamate
 * vere, non da listino:
 *
 *   nano-banana-pro   18 crediti = $0.09   (Google: $0.1344 — −33%)
 *   nano-banana-2      8 crediti = $0.04   a 1K, 12 = $0.06 a 2K   (Google: $0.067 — −40% a 1K)
 *   nano-banana-2-lite ? crediti — il costo vero arriva comunque da creditsConsumed sul poll.
 *
 * Il default di render del prodotto è nano-banana-2-lite: il mapping lo aggiunge senza un elenco.
 *
 * La voce si sposta ANCHE SE COSTA DI PIÙ: 0.62 crediti = $0.0031 per una battuta di 4.4s, contro
 * ~$0.0011 su Google. Circa 3× tanto. Non è un risparmio ed è stato accettato come tale: lo scopo
 * è togliere una dipendenza dalla API ufficiale di Google, non abbassare quella riga. Chi legge
 * dopo darà per scontato che ogni spostamento su kie fosse un risparmio: qui non lo è.
 *
 * ## La forma della API
 *
 * `POST /jobs/createTask` → `taskId`, poi `GET /jobs/recordInfo?taskId=` finché lo stato è
 * `success`. È ESATTAMENTE la stessa API che `video.ts` guida già: il polling, la lettura
 * dell'errore e l'estrazione dei crediti stanno qui una volta sola e `video.ts` li importa, invece
 * di avere due dialetti che si correggono a metà.
 *
 * ## Le tre cose che si scoprono solo provando
 *
 * 1. **Le immagini di riferimento sono URL, mai base64.** Un `data:image/png;base64,…` dentro
 *    `image_input` torna `500 File type not supported`. Il ponte è
 *    `POST https://kieai.redpandaai.co/api/file-base64-upload` → `{downloadUrl}`, un giro di rete
 *    per immagine (~1–2s misurati per 350 KB). Fino a 8 riferimenti.
 * 2. **`resolution` è `1K|2K|4K` e distingue le maiuscole**: `"2k"` torna 500.
 * 3. **I crediti arrivano SOLO sul poll**, come `data.creditsConsumed` (camelCase). La risposta
 *    della submit non ne porta traccia.
 *
 * ## Gli URL dei risultati vivono 24 ore
 *
 * Nessuna funzione qui restituisce un URL di kie. L'immagine torna come data URL (scaricata subito,
 * nella stessa chiamata) e l'audio come Buffer: quello che il chiamante persiste è sempre una copia
 * nostra. Un URL di kie in una riga che dura più di un giorno è un'immagine che sparisce da sola.
 */
import { env } from '$env/dynamic/private';
import { NANO_BANANA_2_MODEL, imageModelSpec, kieAspectRatio } from '$lib/image-models';
import { logAiCall } from '$lib/server/ai-log';
import { KIE_CREDIT_USD } from '$lib/server/kie';

export const KIE_JOBS_BASE = 'https://api.kie.ai/api/v1';

/** Il ponte base64→URL. Host diverso dalla API dei job: non è un errore di battitura. */
const KIE_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-base64-upload';

export function kieJobHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.KIE_API_KEY}`,
    'Content-Type': 'application/json'
  };
}

// Interrompibile: un intervallo di poll è tempo morto, e aspettarlo dopo un annullamento brucia
// secondi che il chiamante non ha più. Si risveglia sull'abort — il ciclo ricontrolla il segnale,
// quindi un risveglio anticipato non diventa mai una richiesta in più.
export const kieSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

export type KieJobResult = { url: string; taskId: string; credits?: number };

/**
 * Manda un job, torna l'id del task. L'id vale la pena persisterlo: gli endpoint di upscale/extend
 * di kie accettano SOLO un task id, mai un URL.
 */
export async function createKieTask(
  model: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
  label = 'kie'
): Promise<string | undefined> {
  const createRes = await fetch(`${KIE_JOBS_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: kieJobHeaders(),
    body: JSON.stringify({ model, input }),
    signal
  });
  if (!createRes.ok) {
    // Il motivo del rifiuto sta nel corpo: da fuori resterebbe solo "non ha restituito niente",
    // indistinguibile fra chiave scaduta, payload non valido e modello in manutenzione.
    const body = await createRes.text().catch(() => '');
    console.error(
      `[${label}] kie createTask ${createRes.status} for ${model}: ${body.slice(0, 400) || '(corpo vuoto)'}`
    );
    return undefined;
  }
  const created = await createRes.json();
  // Un HTTP 200 con `code: 500` nel corpo è la forma con cui kie rifiuta un enum sbagliato
  // (`resolution: "2k"`, un aspect_ratio fuori elenco): senza questo ramo il taskId è undefined e
  // il motivo — che è scritto lì — finisce nel cestino.
  const taskId = created?.data?.taskId ?? created?.data?.task_id ?? created?.taskId;
  if (!taskId) {
    console.error(
      `[${label}] kie createTask rifiutata per ${model}: ${String(created?.msg ?? JSON.stringify(created)).slice(0, 400)}`
    );
    return undefined;
  }
  return taskId;
}

/**
 * L'esito di un poll. SCADUTO e FALLITO sono due cose diverse e qui non collassano piu' in un
 * `undefined`: kie che RIFIUTA un lavoro non ci costa niente e si puo' ritentare, kie che sta
 * ANCORA lavorando mentre noi smettiamo di guardare ci costa comunque — e ritentare li' apre un
 * secondo task che kie fattura di nuovo, per lo stesso lavoro. Il `taskId` viaggia con la scadenza
 * apposta: e' cio' che serve per riprendere quello invece di aprirne un altro.
 */
export type KiePollOutcome =
  | { status: 'done'; url: string; taskId: string; credits?: number }
  | { status: 'failed'; taskId: string; error: string }
  | { status: 'timeout'; taskId: string };

/**
 * Poll fino alla fine. L'URL finale sta in `data.resultJson` (una *stringa* JSON) a `resultUrls[0]`;
 * `creditsConsumed` sullo stesso payload è l'addebito ESATTO di kie — si fattura quello, mai una stima.
 *
 * `timeoutMs` è quanto può metterci il MODELLO; `signal` è quanto il CHIAMANTE è ancora interessato.
 * Sono indipendenti e vince il più corto.
 */
export async function pollKieTask(
  taskId: string,
  timeoutMs: number,
  signal?: AbortSignal,
  label = 'kie',
  intervalMs = 5000
): Promise<KiePollOutcome> {
  const deadline = Date.now() + timeoutMs;
  let first = true;
  while (Date.now() < deadline) {
    if (signal?.aborted) return { status: 'timeout', taskId };
    // Si CHIEDE prima e si aspetta dopo: un job già pronto (o già rifiutato) torna subito invece di
    // costare un intervallo intero di attesa a vuoto.
    if (!first) await kieSleep(intervalMs, signal);
    first = false;
    if (signal?.aborted) return { status: 'timeout', taskId };
    const infoRes = await fetch(`${KIE_JOBS_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: kieJobHeaders(),
      signal
    });
    if (!infoRes.ok) continue;
    const info = await infoRes.json();
    const state = info?.data?.state;
    if (state === 'fail' || state === 'failed' || state === 'error') {
      // L'altra metà di "non ha restituito niente": il task è stato ACCETTATO e poi è fallito.
      // Senza questa riga le due cause sono indistinguibili da fuori.
      const why =
        info?.data?.failMsg ?? info?.data?.failCode ?? info?.data?.errorMessage ?? '(nessun motivo)';
      console.error(`[${label}] kie task ${taskId} ${state}: ${String(why).slice(0, 400)}`);
      return { status: 'failed', taskId, error: String(why).slice(0, 400) };
    }
    if (state === 'success' || state === 'completed') {
      const raw = info?.data?.resultJson;
      let parsed: { resultUrls?: string[] } | undefined;
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return { status: 'failed', taskId, error: 'resultJson non leggibile' };
      }
      const url = parsed?.resultUrls?.[0];
      if (!url) return { status: 'failed', taskId, error: 'nessun resultUrl' };
      const rawCredits = info?.data?.creditsConsumed ?? info?.data?.credits_consumed;
      const credits = Number.isFinite(Number(rawCredits)) ? Number(rawCredits) : undefined;
      return { status: 'done', url, taskId, credits };
    }
    // qualsiasi altro stato (waiting/queuing/generating) → si continua a chiedere
  }
  // ABBANDONATO, non annullato: kie continua a renderizzare e a fatturare. L'API che usiamo
  // (`createTask` + `recordInfo`) non espone un annullamento, quindi l'unica cosa onesta e'
  // riprendere questo taskId invece di aprirne un altro.
  console.error(`[${label}] kie task ${taskId} non finito dopo ${Math.round(timeoutMs / 1000)}s`);
  return { status: 'timeout', taskId };
}

/**
 * Il costo da scrivere in `ai_calls`, dai crediti che kie ha DAVVERO addebitato.
 *
 * `undefined` quando il poll non ha riportato crediti: `logAiCall` lascia allora `cost_usd` a null.
 * Un buco visibile è meglio di un numero plausibile e sbagliato — fatturare a listino Google un
 * lavoro pagato a kie sbaglia di 16× e non fa rumore da nessuna parte.
 */
export function kieFlatCostUsd(credits?: number): number | undefined {
  return credits == null ? undefined : Math.round(credits * KIE_CREDIT_USD * 1e6) / 1e6;
}

// ── Immagini ────────────────────────────────────────────────────────────────────────────────

/** Gli unici rapporti d'aspetto che kie accetta. Fuori elenco è un 500 alla submit. */

/** `1K|2K|4K`, e le maiuscole contano: `"2k"` è un 500. */
export type KieResolution = '1K' | '2K' | '4K';

const POLL_INTERVAL_MS = 3000;
// Misurato: pro ~29–36s, nano-banana-2 fino a ~85s sotto carico. Cinque minuti è tre volte il
// peggiore visto, e comunque meno del muro di una invocazione serverless.
const IMAGE_TIMEOUT_MS = 300_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Quante immagini di riferimento kie inoltra al modello. QUESTO È IL TETTO VERO DEL PRODOTTO:
 * `image` è instradato su kie di default (`model-routing.ts` → `r('nano-banana', 'kie')`), quindi
 * ogni render passa di qui, e conta TUTTE le parti inline che `buildImageRequest` attacca — base da
 * modificare, logo del brand, volti, riferimenti prodotto, allegati dell'utente, mood. Non è il
 * budget dei soli riferimenti che uno strumento chiede all'AI: quelli automatici occupano posti
 * prima che il modello ne scelga uno.
 *
 * Nano Banana Pro servito da Google ne documenta 14 (con sotto-limiti: 6 oggetti ad alta fedeltà,
 * 5 volti, 3 di stile), ma quella strada si prende solo con `AI_ROUTE_IMAGE=nano-banana@google` o
 * senza chiave kie. Chi alza un tetto a monte deve guardare QUESTO numero, non quello di Google.
 */
export const KIE_IMAGE_INPUT_MAX = 8;

/**
 * Da id del catalogo (o da un vecchio id Gemini scritto in un call site) a id kie.
 *
 * `refCount` non è un dettaglio: metà delle famiglie su kie separa il modello testo-a-immagine da
 * quello che accetta riferimenti — `seedream/5-pro-text-to-image` rifiuta `image_urls`, e il suo
 * gemello li PRETENDE. Nano Banana usa lo stesso id in entrambi i casi, e per questo la differenza
 * non si vedeva finché c'era solo lui.
 */
export function kieImageModel(model: string | undefined, refCount = 0): string {
  const spec = imageModelSpec(model);
  if (spec) return refCount > 0 ? spec.kie.refs : spec.kie.text;
  // Un id che il catalogo non conosce è un id Gemini di prima del registro: la regola vale ancora.
  if (/pro/i.test(model ?? '')) return 'nano-banana-pro';
  if (/lite/i.test(model ?? '')) return 'nano-banana-2-lite';
  return 'nano-banana-2';
}

/**
 * L'input del job, dai pezzi che `buildImageRequest` produce già. Puro, quindi testabile.
 *
 * Ogni campo qui sotto viene dallo spec del modello e non da un `if`: i nomi cambiano davvero da
 * una famiglia all'altra (`image_input` / `image_urls` / `input_urls`, `aspect_ratio` /
 * `image_size`, `resolution` / `quality`), e un campo sbagliato non è un errore — è un render che
 * riesce ignorando i riferimenti del brand.
 *
 * Il rapporto d'aspetto lo validiamo NOI anche se kie lo rifiuta: il suo rifiuto arriva come un 500
 * generico dopo un giro di rete, e a quel punto il render è perso.
 */
export function buildKieImageInput(opts: {
  prompt: string;
  aspectRatio?: string;
  refUrls?: string[];
  resolution?: KieResolution;
  model?: string;
}): Record<string, unknown> {
  const spec = imageModelSpec(opts.model) ?? imageModelSpec(NANO_BANANA_2_MODEL)!;
  const aspect = kieAspectRatio(spec, opts.aspectRatio);
  if (opts.aspectRatio && aspect !== opts.aspectRatio) {
    console.warn(`[kie-image] ${spec.id} non serve aspect_ratio "${opts.aspectRatio}" — uso ${aspect}`);
  }

  const refUrls = opts.refUrls ?? [];
  if (refUrls.length > spec.maxRefs) {
    console.warn(
      `[kie-image] ${refUrls.length} riferimenti ma ${spec.id} ne inoltra ${spec.maxRefs}: ` +
        `${refUrls.length - spec.maxRefs} scartati. Il tetto va imposto A MONTE, dove si sa che cosa sono.`
    );
  }

  const asked =
    opts.resolution ?? (isKieResolution(env.KIE_IMAGE_RESOLUTION) ? env.KIE_IMAGE_RESOLUTION : '1K');
  // Il formato è una decisione di prodotto, la risoluzione una manopola: quando il modello serve
  // quel rapporto solo a 1K, si abbassa la manopola e si tiene l'inquadratura.
  const resolution = spec.ratios1KOnly?.includes(aspect) ? '1K' : asked;
  if (resolution !== asked) {
    console.warn(`[kie-image] ${spec.id} serve ${aspect} solo a 1K: ${asked} abbassato a 1K`);
  }

  return {
    prompt: opts.prompt.slice(0, 10_000),
    [spec.aspectField]: aspect,
    ...(spec.sizeField === 'resolution' ? { resolution } : {}),
    // Seedream non ha 4K: basic = 1K, high = tutto il resto di quello che il prodotto chiede.
    ...(spec.sizeField === 'quality' ? { quality: resolution === '1K' ? 'basic' : 'high' } : {}),
    ...(spec.outputFormat ? { output_format: spec.outputFormat } : {}),
    ...(refUrls.length ? { [spec.refField]: refUrls.slice(0, spec.maxRefs) } : {})
  };
}

function isKieResolution(v: string | undefined): v is KieResolution {
  return v === '1K' || v === '2K' || v === '4K';
}

/**
 * Il ponte: base64 → URL scaricabile. Un giro di rete per immagine.
 *
 * Il nome del file entra tale e quale nel percorso remoto (`kieai/<account>/<path>/<nome>`), quindi
 * un nome fisso sarebbe una collisione fra due render in parallelo che si sovrascrivono il
 * riferimento a vicenda. Un uuid costa niente ed è l'unica cosa che lo impedisce.
 */
export async function uploadKieRef(
  inlineData: { mimeType: string; data: string },
  signal?: AbortSignal
): Promise<string | undefined> {
  try {
    const ext = (inlineData.mimeType.split('/')[1] ?? 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const res = await fetch(KIE_UPLOAD_URL, {
      method: 'POST',
      headers: kieJobHeaders(),
      body: JSON.stringify({
        base64Data: `data:${inlineData.mimeType};base64,${inlineData.data}`,
        uploadPath: 'images/anomalia-refs',
        fileName: `${crypto.randomUUID()}.${ext}`
      }),
      signal
    });
    if (!res.ok) {
      console.error(`[kie-image] upload riferimento ${res.status}`);
      return undefined;
    }
    const j = await res.json();
    return j?.data?.downloadUrl ?? j?.downloadUrl ?? undefined;
  } catch (e) {
    console.error(`[kie-image] upload riferimento fallito: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/** Scarica il risultato e lo trasforma in data URL, prima che l'URL di kie scada (24h). */
async function fetchAsDataUrl(url: string, signal?: AbortSignal): Promise<string | undefined> {
  const res = await fetch(url, {
    signal: signal ?? AbortSignal.timeout(60_000)
  });
  if (!res.ok) {
    console.error(`[kie-image] download risultato ${res.status}`);
    return undefined;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.byteLength > MAX_IMAGE_BYTES) {
    console.error(`[kie-image] risultato di ${buf.byteLength} byte fuori limite`);
    return undefined;
  }
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim() || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** La forma che `buildImageRequest` restituisce, letta senza dipendere da content-preview.ts. */
export type GeminiImageRequest = {
  model: string;
  contents: Array<{
    parts: Array<{
      text?: string;
      inlineData?: { mimeType: string; data: string };
    }>;
  }>;
  config?: { imageConfig?: { aspectRatio?: string } };
};

/**
 * Un render su kie a partire dalla richiesta che il codice costruisce GIÀ per Gemini.
 *
 * Prendere in ingresso la richiesta Gemini invece di una firma nuova è deliberato: il prompt che
 * `buildImageRequest` assembla è il risultato di molta messa a punto (fedeltà del colore di un
 * prodotto, identità di una persona, mood separato dal contenuto), e una seconda funzione che lo
 * ricostruisse divergerebbe al primo ritocco. Qui si traduce il trasporto, non il contenuto.
 *
 * Costo: un giro di ponte per ogni riferimento inline. Un render sociale tipico ne ha 1–2 (logo +
 * prodotto o persona), quindi ~2–4s in più sui ~30s del render; il caso peggiore che
 * `buildImageRequest` può produrre è 6, cioè ~12s. Si caricano in parallelo apposta.
 */
export type KieImageOutcome = {
  dataUrl?: string;
  /** Presente = kie sta ANCORA lavorando su questo task. Si riprende, non se ne apre un altro. */
  timedOutTaskId?: string;
};

export async function generateImageOnKie(
  req: GeminiImageRequest,
  opts: {
    label?: string;
    context?: string;
    signal?: AbortSignal;
    /** Il task di un tentativo scaduto: si riprende quello, e non si carica niente due volte. */
    resumeTaskId?: string;
    timeoutMs?: number;
  } = {}
): Promise<KieImageOutcome> {
  const label = opts.label ?? 'renderPostImage';
  const parts = req.contents?.[0]?.parts ?? [];
  const prompt = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join('\n');
  const refs = parts.flatMap((p) => (p.inlineData ? [p.inlineData] : []));
  const model = kieImageModel(req.model, refs.length);
  const t0 = Date.now();

  const fail = (error: string) => {
    // Fallita = non addebitata: `logAiCall` scrive comunque la riga, con cost_usd null.
    logAiCall({
      label,
      provider: 'kie',
      model,
      ms: Date.now() - t0,
      ok: false,
      error,
      context: opts.context
    });
    return {};
  };

  /**
   * Un task scaduto e' l'unico esito che si paga senza sapere quanto: `creditsConsumed` arriva solo
   * dal ramo `success`, quindi senza questa riga l'addebito esiste su kie e da noi non esiste
   * affatto. Non si inventa un numero — si scrive l'esito e il taskId, e la differenza col
   * cruscotto di kie diventa leggibile invece che misteriosa.
   */
  const abandoned = (taskId: string): KieImageOutcome => {
    logAiCall({
      label,
      provider: 'kie',
      model,
      ms: Date.now() - t0,
      ok: false,
      error: `task ${taskId} scaduto: kie lo sta ancora renderizzando e lo fattura, costo ignoto`,
      context: opts.context
    });
    return { timedOutTaskId: taskId };
  };

  // Un tentativo che riprende un task gia' aperto non ricarica i riferimenti e non ne crea un
  // altro: il lavoro e' gia' in corso e pagato, qui si torna solo a guardarlo.
  if (opts.resumeTaskId) {
    return finishKieImage(opts.resumeTaskId, label, model, t0, opts, abandoned);
  }

  // I riferimenti in parallelo: sono giri di rete indipendenti, in serie sarebbero 6× la latenza.
  const refUrls = (await Promise.all(refs.map((r) => uploadKieRef(r, opts.signal)))).filter(
    (u): u is string => !!u
  );
  if (refUrls.length < refs.length) {
    // Un riferimento perso non è un dettaglio: è la foto del prodotto vero, ed è esattamente il
    // motivo per cui questo render usa il modello caro. Meglio fallire e far ritentare.
    return fail(`${refs.length - refUrls.length}/${refs.length} riferimenti non caricati su kie`);
  }

  const input = buildKieImageInput({
    model,
    prompt,
    aspectRatio: req.config?.imageConfig?.aspectRatio,
    refUrls
  });
  const taskId = await createKieTask(model, input, opts.signal, 'kie-image');
  if (!taskId) return fail('createTask rifiutata');

  return finishKieImage(taskId, label, model, t0, opts, abandoned);
}

/** Da qui in giu' il task esiste gia': si guarda come va e si paga cio' che kie ha addebitato. */
async function finishKieImage(
  taskId: string,
  label: string,
  model: string,
  t0: number,
  opts: { context?: string; signal?: AbortSignal; timeoutMs?: number },
  abandoned: (taskId: string) => KieImageOutcome
): Promise<KieImageOutcome> {
  const job = await pollKieTask(
    taskId,
    opts.timeoutMs ?? IMAGE_TIMEOUT_MS,
    opts.signal,
    'kie-image',
    POLL_INTERVAL_MS
  );

  if (job.status === 'timeout') return abandoned(taskId);

  if (job.status === 'failed') {
    // Rifiutato = non addebitato. Qui `cost_usd` a null e' la verita', non un buco.
    logAiCall({
      label,
      provider: 'kie',
      model,
      ms: Date.now() - t0,
      ok: false,
      error: job.error,
      context: opts.context
    });
    return {};
  }

  const dataUrl = await fetchAsDataUrl(job.url, opts.signal);
  logAiCall({
    label,
    provider: 'kie',
    model,
    ms: Date.now() - t0,
    ok: !!dataUrl,
    error: dataUrl ? undefined : 'risultato non scaricabile',
    providerCredits: job.credits,
    flatCostUsd: kieFlatCostUsd(job.credits),
    context: opts.context
  });
  return { dataUrl };
}

// ── Voce ────────────────────────────────────────────────────────────────────────────────────

/** Il TTS di Gemini rivenduto da kie. Sovrascrivibile senza deploy, come il suo gemello Google. */
export function kieTtsModel(): string {
  return env.KIE_TTS_MODEL?.trim() || 'google/gemini-3-1-flash-tts';
}

// Misurato: 6.8s per 4.4s di parlato. Due minuti coprono un copione lungo con margine.
const TTS_TIMEOUT_MS = 120_000;

/**
 * Una generazione sola, tutte le righe, come su Google.
 *
 * `dialogue_turns` prende una riga per battuta: misurato, fra un turno e l'altro il modello lascia
 * ~270ms di silenzio, che è sopra la soglia di default di 180ms di `findGaps` (minSilenceMs) — quindi il taglio per battuta
 * continua a funzionare esattamente come prima. L'istruzione di recitazione NON può stare nel testo
 * (lì verrebbe letta ad alta voce): va in `sample_context`, che è l'unico campo libero.
 *
 * `style` di kie NON è testo libero, è un enum di sei valori ("Vocal Smile", "Newscaster",
 * "Whisper", "Empathetic", "Promo/Hype", "Deadpan"): qualsiasi altra cosa torna 422. Lo stile che
 * ci arriva dall'agente è una frase, quindi resta dov'è sempre stato, nell'istruzione.
 *
 * Torna il WAV così com'è: 24 kHz mono 16-bit PCM, verificato byte per byte contro `TTS_PCM`.
 */
export async function generateSpeechOnKie(opts: {
  lines: string[];
  direction: string;
  voiceName: string;
  languageCode?: string | null;
  signal?: AbortSignal;
}): Promise<{ wav: Buffer; credits?: number; model: string } | undefined> {
  const model = kieTtsModel();
  // kie non ha un `languageCode`: la lingua la decide il testo, che è già nella lingua giusta.
  // Il suggerimento esplicito serve solo per i copioni corti, dove una frase può essere ambigua.
  const sampleContext = [opts.direction, opts.languageCode ? `Speak in ${opts.languageCode}.` : '']
    .filter(Boolean)
    .join(' ');

  const taskId = await createKieTask(
    model,
    {
      sample_context: sampleContext,
      speakers: [
        {
          speaker_id: 'Speaker 1',
          voice_name: opts.voiceName,
          accent: 'Neutral'
        }
      ],
      dialogue_turns: opts.lines.map((text) => ({
        speaker_id: 'Speaker 1',
        text
      }))
    },
    opts.signal,
    'kie-tts'
  );
  if (!taskId) return undefined;

  const job = await pollKieTask(taskId, TTS_TIMEOUT_MS, opts.signal, 'kie-tts', POLL_INTERVAL_MS);
  if (job.status !== 'done') return undefined;

  const res = await fetch(job.url, {
    signal: opts.signal ?? AbortSignal.timeout(60_000)
  });
  if (!res.ok) {
    console.error(`[kie-tts] download risultato ${res.status}`);
    return undefined;
  }
  return {
    wav: Buffer.from(await res.arrayBuffer()),
    credits: job.credits,
    model
  };
}
