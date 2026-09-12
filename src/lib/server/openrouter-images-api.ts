/**
 * Il render sull'API immagini di OpenRouter — `POST /api/v1/images`, che NON è `chat/completions`.
 *
 * Perché una seconda porta e non un parametro: i GPT Image 2.5 esistono SOLO lì. Chiamati su
 * `chat/completions` rispondono 404 dicendolo per esteso («is an image generation model and cannot
 * be used with the chat/completions endpoint»), e non compaiono in `/api/v1/models`, che elenca i
 * modelli di chat. Il loro catalogo è `/api/v1/images/models`, 52 voci con i parametri che ognuna
 * accetta. Cercarli nel posto sbagliato è il motivo per cui per due volte sono sembrati inesistenti.
 *
 * Come `generateImageOnOpenrouter` accanto, si traduce il TRASPORTO e non il contenuto: entra la
 * stessa `GeminiImageRequest` che `buildImageRequest` assembla per tutti, esce un data URL. Il
 * prompt messo a punto sul percorso Gemini è lo stesso, e una seconda funzione che lo ricostruisse
 * divergerebbe al primo ritocco.
 *
 * Le tre differenze che contano, tutte MISURATE contro l'endpoint vero il 2026-09-12:
 *
 *  1. I riferimenti hanno una forma sola: `input_references: [{type:'image_url', image_url:{url}}]`.
 *     `{url}`, `{image_url:{url}}`, `{b64_json}` e `{type:'input_image'}` tornano 400. `image:` —
 *     il nome che verrebbe da OpenAI — torna **200 e ignora l'immagine**: chiesto «rendi verde
 *     questo limone», è arrivata una limonata inventata da zero. Il costo lo conferma: $0,0060
 *     quando il riferimento cade, $0,017-0,025 quando viene letto davvero.
 *  2. `aspect_ratio` è un elenco chiuso e **4:5 non c'è**, cioè il formato di un post Instagram.
 *     Si chiede in pixel con `size`, che l'endpoint onora esattamente. Vedi `openrouterImagesSize`.
 *  3. La risposta è `data[0].b64_json` + `media_type`, non `choices[].message.images`.
 *
 * PREZZO: da `usage.cost`, la fattura di QUESTA chiamata. Misurato: $0,0053 per un'immagine
 * disegnata da zero e $0,017 per una modificata, contro i $0,0748 medi del Gemini su OpenRouter.
 */
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';
import {
  imageModelSpec,
  openrouterImagesAspectRatio,
  openrouterImagesSize
} from '$lib/image-models';
import type { GeminiImageRequest } from '$lib/server/kie-jobs';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

type ImagesResponse = {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  usage?: { cost?: number };
  error?: { message?: string };
};

type Reference = { type: 'image_url'; image_url: { url: string } };

function apiKey(): string | undefined {
  return env.OPENROUTER_API_KEY?.trim() || env.LLM_API_KEY?.trim() || undefined;
}

function baseUrl(): string {
  return (env.LLM_BASE_URL?.trim() || OPENROUTER_BASE_URL).replace(/\/$/, '');
}

/** Il testo di tutte le parti, nell'ordine in cui il prompt è stato costruito. */
function promptOf(parts: GeminiImageRequest['contents'][number]['parts']): string {
  return parts
    .map((p) => p.text)
    .filter((t): t is string => !!t)
    .join('\n\n');
}

function referencesOf(
  parts: GeminiImageRequest['contents'][number]['parts'],
  max: number
): Reference[] {
  const refs = parts
    .filter((p) => p.inlineData)
    .map((p): Reference => {
      const { mimeType, data } = p.inlineData!;
      return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } };
    });
  if (refs.length > max) {
    console.warn(
      `[or-images] ${refs.length} riferimenti ma il modello ne inoltra ${max}: ` +
        `${refs.length - max} scartati. Il tetto va imposto A MONTE, dove si sa che cosa sono.`
    );
  }
  return refs.slice(0, max);
}

export async function generateImageOnOpenrouterImages(
  req: GeminiImageRequest,
  opts: { label?: string; context?: string; signal?: AbortSignal } = {}
): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error('OPENROUTER_API_KEY assente: questo render non ha un trasporto');

  const spec = imageModelSpec(req.model);
  const model = spec?.openrouterImages;
  if (!model) {
    throw new Error(
      `${req.model} non è servito dall'API immagini di OpenRouter: questa rotta non lo sa disegnare`
    );
  }

  const label = opts.label ?? 'renderPostImage';
  const parts = req.contents?.[0]?.parts ?? [];
  const aspectRatio = req.config?.imageConfig?.aspectRatio;
  const references = referencesOf(parts, spec.maxRefs);
  const t0 = Date.now();

  // Il rapporto per NOME quando quel nome esiste, in pixel quando no: sono le due strade e non c'è
  // una terza, perché mandare un rapporto fuori elenco è un 400 e non mandarne nessuno è un post
  // verticale inquadrato quadrato.
  const byName = openrouterImagesAspectRatio(aspectRatio);
  const bySize = byName ? undefined : openrouterImagesSize(aspectRatio);

  const body = {
    model,
    prompt: promptOf(parts).slice(0, 10_000),
    ...(byName ? { aspect_ratio: byName } : {}),
    ...(bySize ? { size: bySize } : {}),
    ...(references.length ? { input_references: references } : {})
  };

  const fail = (error: string): never => {
    logAiCall({ label, provider: 'openrouter', model, ms: Date.now() - t0, ok: false, error, context: opts.context });
    throw new Error(`OpenRouter images (${model}): ${error}`);
  };

  let payload: ImagesResponse;
  try {
    const res = await fetch(`${baseUrl()}/images`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal
    });
    payload = (await res.json()) as ImagesResponse;
    if (!res.ok || payload.error) fail(payload.error?.message ?? `HTTP ${res.status}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('OpenRouter images (')) throw e;
    return fail(e instanceof Error ? e.message : 'richiesta fallita');
  }

  const first = payload.data?.[0];
  if (!first?.b64_json) fail('nessuna immagine nella risposta');

  logAiCall({
    label,
    provider: 'openrouter',
    model,
    ms: Date.now() - t0,
    ok: true,
    flatCostUsd: payload.usage?.cost,
    context: opts.context
  });
  return `data:${first!.media_type ?? 'image/png'};base64,${first!.b64_json}`;
}
