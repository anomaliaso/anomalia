/**
 * Un render a partire dalla stessa richiesta che il codice costruisce GIÀ per Gemini, come fa
 * `generateImageOnKie`: si traduce il trasporto, non il contenuto. Il prompt che `buildImageRequest`
 * assembla è il risultato di molta messa a punto, e una seconda funzione che lo ricostruisse
 * divergerebbe al primo ritocco.
 *
 * La differenza che conta rispetto a kie: qui è UNA richiesta sincrona. Niente createTask, niente
 * polling, quindi niente task che scade mentre il provider continua a lavorare e a fatturare — il
 * difetto che su kie è costato render pagati due volte. Misurato: 3,0-4,2s contro 16-42s.
 *
 * I riferimenti restano inline come data URL: kie pretende un upload per ciascuno (un giro di rete
 * per riferimento), qui viaggiano nel corpo.
 *
 * PREZZO: da `usage.cost`, che è la fattura di OpenRouter per QUESTA chiamata. Non da un listino
 * scritto a mano — verificato che coincide alla sesta cifra con la tariffa dell'endpoint a monte.
 */
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';
import type { GeminiImageRequest } from '$lib/server/kie-jobs';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const IMAGE_MODALITIES = ['image', 'text'];
const GOOGLE_VENDOR = 'google/';

type OpenrouterImageResponse = {
  choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
  usage?: { cost?: number };
  error?: { message?: string };
};

function apiKey(): string | undefined {
  return env.OPENROUTER_API_KEY?.trim() || env.LLM_API_KEY?.trim() || undefined;
}

function baseUrl(): string {
  return (env.LLM_BASE_URL?.trim() || OPENROUTER_BASE_URL).replace(/\/$/, '');
}

/**
 * OpenRouter chiama i modelli col fornitore davanti. Gli id che il prodotto usa sono già quelli
 * Google (`googleImageModel` li ha riportati lì), quindi manca solo il prefisso.
 */
export function openrouterImageModel(model: string): string {
  return model.includes('/') ? model : `${GOOGLE_VENDOR}${model}`;
}

/** Undefined quando la risposta non porta nessuna parte immagine: non è un successo. */
export function imageFromOpenrouterResponse(body: OpenrouterImageResponse): string | undefined {
  for (const image of body.choices?.[0]?.message?.images ?? []) {
    if (image?.image_url?.url) return image.image_url.url;
  }
  return undefined;
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

function messageContent(parts: GeminiImageRequest['contents'][number]['parts']): ContentPart[] {
  return parts.flatMap((part): ContentPart[] => {
    if (part.text) return [{ type: 'text', text: part.text }];
    if (!part.inlineData) return [];
    const { mimeType, data } = part.inlineData;
    return [{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${data}` } }];
  });
}

export async function generateImageOnOpenrouter(
  req: GeminiImageRequest,
  opts: { label?: string; context?: string; signal?: AbortSignal } = {}
): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error('OPENROUTER_API_KEY assente: questo render non ha un trasporto');

  const label = opts.label ?? 'renderPostImage';
  const model = openrouterImageModel(req.model);
  const aspectRatio = req.config?.imageConfig?.aspectRatio;
  const t0 = Date.now();

  // `image_config.aspect_ratio` è il campo che OpenRouter inoltra davvero: senza, lo stesso prompt
  // torna 1408x768 invece di 4:5, cioè ogni post Instagram del brand inquadrato in panoramica.
  // `extra_body` NON funziona — misurato, entrambi.
  const body = {
    model,
    messages: [{ role: 'user', content: messageContent(req.contents?.[0]?.parts ?? []) }],
    modalities: IMAGE_MODALITIES,
    ...(aspectRatio ? { image_config: { aspect_ratio: aspectRatio } } : {}),
    usage: { include: true }
  };

  const fail = (error: string): never => {
    logAiCall({ label, provider: 'openrouter', model, ms: Date.now() - t0, ok: false, error, context: opts.context });
    throw new Error(`OpenRouter (${model}): ${error}`);
  };

  let payload: OpenrouterImageResponse;
  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal
    });
    payload = (await res.json()) as OpenrouterImageResponse;
    if (!res.ok || payload.error) fail(payload.error?.message ?? `HTTP ${res.status}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('OpenRouter (')) throw e;
    return fail(e instanceof Error ? e.message : 'richiesta fallita');
  }

  const dataUrl = imageFromOpenrouterResponse(payload);
  if (!dataUrl) fail('nessuna immagine nella risposta');

  logAiCall({
    label,
    provider: 'openrouter',
    model,
    ms: Date.now() - t0,
    ok: true,
    flatCostUsd: payload.usage?.cost,
    context: opts.context
  });
  return dataUrl as string;
}
