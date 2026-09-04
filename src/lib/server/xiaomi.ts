import { XIAOMI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import type { GoogleGenAI } from '@google/genai';
import { structuredKie, textKie } from '$lib/server/kie';
import { logAiCall, extractXiaomiUsage, requireBrandContext } from '$lib/server/ai-log';
import { type GeminiThinkingLevel } from '$lib/server/gemini';
import { env } from '$env/dynamic/private';
import { route } from '$lib/server/model-routing';
import { llmBaseUrl, llmConfigured, llmImagesFromInline, llmModels, llmStructured, llmText } from '$lib/server/llm';

// ── Xiaomi MiMo structured output via tool calling ──────────────────────────
// Shared module used by GTM engine, strategy report, editorial plan, etc.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const XIAOMI_BASE_URL = 'https://api.xiaomimimo.com/v1';
// Which MiMo tier to use — flip via env without a code change. 'mimo-v2.5-pro' is ~3x cheaper
// than ultraspeed and is the only tier that supports the web_search tool; ultraspeed is faster.
export const XIAOMI_MODEL = env.XIAOMI_MODEL || 'mimo-v2.5-pro';
// Vision tier: mimo-v2.5-pro rejects image input ("No endpoints found that support image input",
// verified live 2026-07); base mimo-v2.5 accepts it — calls with images route here.
export const XIAOMI_VISION_MODEL = env.XIAOMI_VISION_MODEL || 'mimo-v2.5';
// Faster (pricier) text tier — used for conversion-critical onboarding stages (strategy + PE).
export const XIAOMI_ULTRASPEED_MODEL = 'mimo-v2.5-pro-ultraspeed';

// Gemini-style inline image part — the format every call site in the app already builds.
// Converted to OpenAI image_url data URIs for the Xiaomi path.
export type ImagePart = { inlineData: { mimeType: string; data: string } };

function toXiaomiContent(prompt: string, images?: ImagePart[]) {
  if (!images?.length) return prompt;
  return [
    { type: 'text', text: prompt },
    ...images.map((p) => ({ type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }))
  ];
}

// Provider: "gemini" (default), "xiaomi", or "kie".
//
// Non legge più `GTM_PROVIDER` da sé: la variabile è una delle cinque che il registro ha assorbito
// (`model-routing.ts`), e continua a funzionare da lì. Qui si traduce la rotta nel vocabolario che
// questo file usa da sempre, e la traduzione passa dal PROVIDER e non dalla famiglia apposta: una
// rotta il cui endpoint è ripiegato su Google perché manca la chiave deve valere "gemini", non
// "xiaomi che sta per prendere una sfilza di 401".
const TEXT_ROUTE = route('text');
export const AI_PROVIDER =
  TEXT_ROUTE.provider === 'xiaomi'
    ? 'xiaomi'
    : TEXT_ROUTE.provider === 'kie' && TEXT_ROUTE.family !== 'gemini'
      ? 'kie'
      : 'gemini';
/**
 * Chi serve il testo DAVVERO, per la riga di boot. Non è la famiglia richiesta: da quando ogni
 * testo passa dal centralino, `AI_PROVIDER === 'gemini'` vuol dire "gateway", e la riga di prima
 * annunciava `gemini (gemini-3.7-flash)` — un modello che quel percorso non chiama — mandando la
 * diagnosi dalla parte sbagliata prima ancora di cominciare.
 */
export function textRouteLabel(): string {
  if (AI_PROVIDER === 'xiaomi') return `xiaomi (${XIAOMI_MODEL})`;
  if (AI_PROVIDER === 'kie') return `kie (${env.KIE_MODEL || 'grok-4-5'})`;
  if (!llmConfigured()) return 'not configured (LLM_API_KEY missing)';
  const host = llmBaseUrl().replace(/^https?:\/\//, '').split('/')[0];
  return `${host} (${llmModels().join(', ') || 'no model declared'})`;
}

// Tutta la generazione di testo — strategia GTM, piano editoriale, articoli del blog — resta su
// Gemini Flash: mai MiMo, mai Kie, qualunque cosa dica GTM_PROVIDER.
//
// Si chiamava `DEEPSEEK_FIRST`, da quando questo pin serviva solo a dire dove cadeva una risposta
// DeepSeek non conforme. Tolto DeepSeek dal router, il nome prometteva l'esatto contrario di quello
// che fa, in otto call site: chi lo leggeva credeva di stare scegliendo DeepSeek. Un nome che mente
// costa più di un percorso morto, perché il prossimo lo usa come documentazione.
// Spread into the aiStructured opts at those call sites.
export const PIN_GEMINI = { provider: 'gemini' as const };

// Extra fields threaded into logAiCall so per-site labels/attribution survive both providers.
export type AiLogExtras = { brandId?: string; userId?: string; threadId?: string; context?: string };

/**
 * DeepSeek runs in `json_object` mode with the schema in the prompt — valid JSON is guaranteed,
 * conformance is NOT. So check what the caller actually depends on (top-level `required` keys, and
 * that arrays came back as arrays) and fall through to the previous provider when it doesn't hold.
 * Without this, a partially-filled object would be indistinguishable from a good one downstream.
 */
export function satisfiesSchema(value: unknown, schema: AnyRec): boolean {
  if (value == null) return false;
  if (schema?.type === 'array') return Array.isArray(value);
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as AnyRec;
  if (!Object.keys(obj).length) return false;
  const required: string[] = Array.isArray(schema?.required) ? schema.required : [];
  for (const key of required) {
    if (obj[key] === undefined || obj[key] === null) return false;
    const expected = schema?.properties?.[key]?.type;
    if (expected === 'array' && !Array.isArray(obj[key])) return false;
    if (expected === 'object' && (typeof obj[key] !== 'object' || Array.isArray(obj[key]))) return false;
  }
  return true;
}

/**
 * UN 401 RIPETUTO DEVE FARE RUMORE, E POI SMETTERE DI COSTARE.
 *
 * Misurato in produzione: 166 chiamate `critiqueImage` su `mimo-v2.5` (la tier vision) respinte
 * con HTTP 401 in due settimane, il 4,9% del totale. Nessuna immagine è rimasta senza critica —
 * il ripiego su Gemini le ha prese TUTTE, giorno per giorno, 1:1 — ed è proprio per questo che il
 * guasto è rimasto invisibile per due settimane: in superficie non si rompeva niente. Quello che
 * costava era il tentativo condannato prima di ogni ripiego: mediana 2,2s, con addosso il base64
 * di ogni immagine da giudicare.
 *
 * È lo stesso schema già descritto per DeepSeek più su, e la stessa medicina che `deepseek.ts`
 * usa da allora: al primo 401/402 il MODELLO esce di scena per il resto del processo, con un
 * errore in chiaro nei log. Per modello e non per provider, perché il guasto è selettivo — la
 * tier `mimo-v2.5-pro` risponde regolarmente mentre la vision rifiuta.
 *
 * ponytail: nessun TTL, nessuna ri-prova programmata — su Vercel il riciclo del processo è già il
 * timer, quindi una chiave rimessa a posto torna viva al prossimo cold start da sola.
 */
const deadXiaomiModels = new Set<string>();

export const xiaomiModelAlive = (model: string): boolean => !deadXiaomiModels.has(model);

export function noteXiaomiAuthFailure(model: string, status: number): void {
  if (status !== 401 && status !== 402) return;
  if (deadXiaomiModels.has(model)) return;
  deadXiaomiModels.add(model);
  console.error(
    `[AI:Xiaomi] HTTP ${status} su ${model}: credenziale rifiutata o credito esaurito. ` +
      `${model} è escluso per il resto del processo — ogni chiamata successiva va diritta al ripiego ` +
      'invece di pagare un tentativo condannato. Se si ripete a ogni deploy, è la chiave, non un caso.'
  );
}

// Single structured call to Xiaomi via tool calling with tool_choice=required.
export async function structuredXiaomi<T>(
  prompt: string,
  schema: AnyRec,
  systemInstruction?: string,
  toolName = 'return_result',
  logExtras?: AiLogExtras,
  images?: ImagePart[],
  temperature?: number,
  modelOverride?: string
): Promise<T> {
  const brandId = requireBrandContext(logExtras);
  const model = images?.length ? XIAOMI_VISION_MODEL : (modelOverride || XIAOMI_MODEL);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: Array<{ role: string; content: any }> = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: toXiaomiContent(prompt, images) });

  // OpenAI tool parameters must be an OBJECT schema. Gemini responseSchemas are sometimes
  // top-level ARRAYS (personas, memory extraction) — wrap them in {items} and unwrap after.
  const isArraySchema = schema.type === 'array';
  const objectSchema = isArraySchema
    ? { type: 'object', properties: { items: schema }, required: ['items'] }
    : schema;
  const strictSchema = {
    ...objectSchema,
    additionalProperties: false,
    required: objectSchema.required ?? Object.keys(objectSchema.properties ?? {})
  };

  if (!xiaomiModelAlive(model)) {
    throw new Error(`Xiaomi ${model} is disabled for this process after an auth failure`);
  }

  console.log(`[AI:Xiaomi] requesting ${model} via tool_call…`);
  const t0 = Date.now();
  const res = await fetch(`${XIAOMI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.XIAOMI_MIMO_API_KEY ?? ''
    },
    body: JSON.stringify({
      model,
      messages,
      tools: [{
        type: 'function',
        function: {
          name: toolName,
          description: 'Return the structured result as JSON.',
          parameters: strictSchema,
          strict: true
        }
      }],
      tool_choice: { type: 'function', function: { name: toolName } },
      temperature: temperature ?? 0.7,
      max_completion_tokens: XIAOMI_MAX_OUTPUT_TOKENS
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[AI:Xiaomi] HTTP ${res.status}: ${errBody.slice(0, 500)}`);
    logAiCall({ label: toolName, provider: 'xiaomi', model, prompt, ms: Date.now() - t0, ok: false, error: `HTTP ${res.status}`, ...logExtras, brandId: logExtras?.brandId ?? brandId ?? undefined });
    noteXiaomiAuthFailure(model, res.status);
    throw new Error(`Xiaomi API error: ${res.status}`);
  }

  const data = await res.json();
  const usage = extractXiaomiUsage(data);
  logAiCall({ label: toolName, provider: 'xiaomi', model, prompt, ms: Date.now() - t0, ok: true, ...usage, ...logExtras, brandId: logExtras?.brandId ?? brandId ?? undefined });

  const msg = data.choices?.[0]?.message;
  const toolArgs = msg?.tool_calls?.[0]?.function?.arguments;
  const content = toolArgs ?? msg?.content ?? '';
  console.log(`[AI:Xiaomi] raw response (${content.length} chars): ${content.slice(0, 300)}`);

  const unwrap = (v: unknown): T => (isArraySchema ? ((v as AnyRec)?.items ?? []) as T : v as T);
  try {
    return unwrap(JSON.parse(content));
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try { return unwrap(JSON.parse(match[1].trim())); } catch { /* fall through */ }
    }
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return unwrap(JSON.parse(braceMatch[0])); } catch { /* fall through */ }
    }
    console.warn('[AI:Xiaomi] failed to parse response as JSON');
    return {} as T;
  }
}

// Provider-aware structured call with automatic Gemini fallback. Supports image inputs on BOTH
// paths (Xiaomi routes them to the vision tier; Gemini attaches them as inline parts).
// `opts.provider` forces a specific provider for this call (e.g. blog writing → xiaomi + cheap pro).
// `opts.noFallback` skips the Gemini safety net when set.
export async function aiStructured<T>(
  _ai: GoogleGenAI,
  prompt: string,
  schema: AnyRec,
  systemInstruction?: string,
  toolName = 'return_result',
  opts?: {
    images?: ImagePart[];
    temperature?: number;
    model?: string;
    provider?: 'gemini' | 'xiaomi' | 'kie';
    noFallback?: boolean;
    /** How hard Gemini reasons (see structuredGemini). Ignored by the non-Gemini providers. */
    thinkingLevel?: GeminiThinkingLevel;
  } & AiLogExtras
): Promise<T> {
  const brandId = requireBrandContext(opts);
  const provider =
    opts?.provider === 'gemini' || opts?.provider === 'xiaomi' || opts?.provider === 'kie'
      ? opts.provider
      : AI_PROVIDER === 'kie'
        ? 'kie'
        : AI_PROVIDER === 'xiaomi'
          ? 'xiaomi'
          : 'gemini';
  const t0 = Date.now();
  const { images, temperature, model, provider: _forced, noFallback, thinkingLevel: _thinkingLevel, ...logExtras } = opts ?? {};

  // Il lavoro strutturato di sfondo va su Gemini Flash, e basta.
  //
  // Prima passava da DeepSeek V4 Flash, molto più economico a parità di lavoro, con ripiego su
  // Gemini quando falliva. Il ripiego funzionava — l'app non se n'è mai accorta — e proprio per
  // questo il guasto è rimasto invisibile: con la chiave a saldo zero ogni chiamata di sfondo
  // faceva un tentativo condannato, aspettava il 402, e poi rifaceva il lavoro su Gemini. Decine
  // di volte l'ora, per ore, senza che niente si rompesse in superficie.
  //
  // Un percorso che fallisce sempre e viene sempre salvato da un altro non è un risparmio: è
  // latenza e rumore nei log che nasconde i guasti veri. Se un giorno il risparmio torna a
  // contare, torna anche questo blocco — il controllo che serviva adesso esiste:
  // `deepseekAlive()` / `noteDeepseekFailure()` in deepseek.ts spengono il provider per il
  // processo al primo 401/402, invece di riprovare all'infinito.
  console.log(`[AI] structured call → ${provider}${opts?.model ? ` (${opts.model})` : ''}`);
  const viaLlm = () =>
    llmStructured<T>({
      prompt,
      schema,
      system: systemInstruction,
      images: llmImagesFromInline(images),
      temperature,
      model,
      label: toolName
    });
  const secondary = provider === 'kie'
    ? () => structuredKie<T>(prompt, schema, systemInstruction, toolName, logExtras, images, temperature, model)
    : () => structuredXiaomi<T>(prompt, schema, systemInstruction, toolName, logExtras, images, temperature, model);
  try {
    if (provider === 'xiaomi' || provider === 'kie') {
      const result = await secondary();
      if (!satisfiesSchema(result, schema)) {
        if (noFallback) {
          console.warn(`[AI] ${provider} returned an unusable result (no LLM fallback)`);
          return {} as T;
        }
        console.warn(`[AI] ${provider} did not satisfy the schema, falling back to the LLM gateway`);
        const fallback = await viaLlm();
        console.log(`[AI] llm fallback responded in ${Date.now() - t0}ms`);
        return fallback;
      }
      console.log(`[AI] ${provider} responded in ${Date.now() - t0}ms`);
      return result;
    }
    const result = await viaLlm();
    console.log(`[AI] llm responded in ${Date.now() - t0}ms`);
    return result;
  } catch (err) {
    if (provider === 'xiaomi' || provider === 'kie') {
      if (noFallback) {
        console.error(`[AI] ${provider} failed (no LLM fallback):`, err);
        throw err;
      }
      console.warn(`[AI] ${provider} failed, falling back to the LLM gateway:`, err);
      const fallback = await viaLlm();
      console.log(`[AI] llm fallback responded in ${Date.now() - t0}ms`);
      return fallback;
    }
    console.error(`[AI] llm failed after ${Date.now() - t0}ms:`, err);
    throw err;
  }
}

// ── Free-text generation (non-structured) ────────────────────────────────────

// Free-text call to Xiaomi (no tool calling, just plain chat).
export async function textXiaomi(
  prompt: string,
  systemInstruction?: string,
  opts?: { label?: string; images?: ImagePart[] } & AiLogExtras
): Promise<string> {
  const { label = 'text', images, ...logExtras } = opts ?? {};
  const brandId = requireBrandContext(opts);
  const model = images?.length ? XIAOMI_VISION_MODEL : XIAOMI_MODEL;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: Array<{ role: string; content: any }> = [];
  if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });
  messages.push({ role: 'user', content: toXiaomiContent(prompt, images) });

  console.log(`[AI:Xiaomi] text request to ${model}…`);
  const t0 = Date.now();
  const res = await fetch(`${XIAOMI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.XIAOMI_MIMO_API_KEY ?? ''
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_completion_tokens: XIAOMI_MAX_OUTPUT_TOKENS
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error(`[AI:Xiaomi] HTTP ${res.status}: ${errBody.slice(0, 500)}`);
    logAiCall({ label, provider: 'xiaomi', model, prompt, ms: Date.now() - t0, ok: false, error: `HTTP ${res.status}`, ...logExtras, brandId: logExtras.brandId ?? brandId ?? undefined });
    throw new Error(`Xiaomi API error: ${res.status}`);
  }

  const data = await res.json();
  const usage = extractXiaomiUsage(data);
  logAiCall({ label, provider: 'xiaomi', model, prompt, ms: Date.now() - t0, ok: true, ...usage, ...logExtras, brandId: logExtras.brandId ?? brandId ?? undefined });

  const content = data.choices?.[0]?.message?.content ?? '';
  console.log(`[AI:Xiaomi] text response (${content.length} chars)`);
  return content;
}

// Provider-aware free-text call with Gemini fallback. Supports image inputs on both paths.
export async function aiText(
  _ai: GoogleGenAI | undefined,
  prompt: string,
  systemInstruction?: string,
  opts?: { label?: string; images?: ImagePart[] } & AiLogExtras
): Promise<string> {
  const brandId = requireBrandContext(opts);
  const provider = AI_PROVIDER === 'kie' ? 'kie' : AI_PROVIDER === 'xiaomi' ? 'xiaomi' : 'gemini';
  const t0 = Date.now();
  const { label = 'text', images, ...logExtras } = opts ?? {};

  const viaLlm = async (): Promise<string> => {
    const r = await llmText({
      prompt,
      system: systemInstruction,
      images: llmImagesFromInline(images),
      label
    });
    return r.text.trim();
  };
  try {
    if (provider === 'xiaomi' || provider === 'kie') {
      const secondaryOpts = { label, images, ...logExtras };
      const result = provider === 'kie'
        ? await textKie(prompt, systemInstruction, secondaryOpts)
        : await textXiaomi(prompt, systemInstruction, secondaryOpts);
      if (!result.trim()) {
        console.warn(`[AI] ${provider} text returned empty, falling back to the LLM gateway`);
        return await viaLlm();
      }
      console.log(`[AI] ${provider} text responded in ${Date.now() - t0}ms`);
      return result;
    }
    const out = await viaLlm();
    console.log(`[AI] llm text responded in ${Date.now() - t0}ms`);
    return out;
  } catch (err) {
    if (provider === 'xiaomi' || provider === 'kie') {
      console.warn(`[AI] ${provider} text failed, falling back to the LLM gateway:`, err);
      return await viaLlm();
    }
    throw err;
  }
}

// ── Parallel variants ───────────────────────────────────────────────────────
// Generate N variants in parallel, then pick the best via LLM comparison.

const DEFAULT_VARIANTS = 3;

// Positioning lenses assigned one-per-variant by the multi-variant planners (GTM roadmap,
// editorial plan). Without them the N "variants" share prompt AND sampling and collapse onto the
// same positioning/imagery run after run — the judge then just picks between near-clones. Each
// lens biases the strategic BET only; the brand facts and data always win over the lens.
export const VARIANT_LENSES = [
  'Lean COMMUNITY-LED: conversations, niche communities, user-generated content and direct engagement carry the growth.',
  'Lean PRODUCT/EDUCATION-LED: concrete use-cases, demos, how-tos and proof of capability carry the growth.',
  'Lean FOUNDER/AUTHORITY-LED: a personal voice, sharp opinions, behind-the-scenes and thought leadership carry the growth.'
];

// Sampling temperature for CREATIVE generation calls (plan/GTM variant proposals). Selection and
// judge calls stay at each provider's default — judging needs consistency, not exploration.
export const CREATIVE_TEMPERATURE = 0.9;

export async function parallelVariants<T>(
  ai: GoogleGenAI,
  // Receives the 0-based variant index so callers can differentiate each variant (lens, seed…).
  generateFn: (variantIndex: number) => Promise<T>,
  selectFn: (variants: T[]) => Promise<T>,
  count = DEFAULT_VARIANTS,
  label = 'plan'
): Promise<T> {
  console.log(`[AI] generating ${count} ${label} variants in parallel…`);
  const t0 = Date.now();

  const results = await Promise.allSettled(
    Array.from({ length: count }, (_, i) => {
      console.log(`[AI]   ${label} variant ${i + 1}/${count} started`);
      return generateFn(i).then((v) => {
        console.log(`[AI]   ${label} variant ${i + 1}/${count} done`);
        return v;
      });
    })
  );

  const variants: T[] = results
    .filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === 'fulfilled')
    .map((r) => r.value as T);

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    console.warn(`[AI] ${failed.length}/${count} ${label} variants failed`);
  }

  if (variants.length === 0) {
    throw new Error(`All ${count} ${label} variants failed`);
  }

  console.log(`[AI] ${variants.length}/${count} ${label} variants done in ${Date.now() - t0}ms, selecting best…`);
  const best = await selectFn(variants);
  console.log(`[AI] best ${label} selected in ${Date.now() - t0}ms total`);
  return best;
}
