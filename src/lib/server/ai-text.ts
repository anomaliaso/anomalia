import { structuredKie, textKie } from '$lib/server/kie';
import { requireBrandContext } from '$lib/server/ai-log';
import { env } from '$env/dynamic/private';
import { route } from '$lib/server/model-routing';
import {
  llmBaseUrl,
  llmConfigured,
  llmImagesFromInline,
  llmModels,
  llmStructured,
  llmText,
  reasoningEffort,
  type ReasoningEffort
} from '$lib/server/llm';

// ── Il centralino del testo ─────────────────────────────────────────────────
// Ogni chiamata di testo e di JSON del prodotto passa da qui e finisce su UNO dei due endpoint vivi:
// il gateway (OpenRouter) o kie. Il file si chiamava `xiaomi.ts` e non parla con Xiaomi da mesi.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// Parte immagine in linea, nel formato che ogni call site dell'app già costruisce.
export type ImagePart = { inlineData: { mimeType: string; data: string } };

/**
 * Kie serve il testo solo quando la rotta gli chiede una famiglia SUA. `gemini@kie` no: lì kie è un
 * passthrough, e il gateway lo fa meglio.
 *
 * Si legge A OGNI CHIAMATA, non una volta al caricamento del modulo. Prima era la costante
 * `AI_PROVIDER`, e faceva due danni in una riga: ricollassava i due assi del registro — famiglia e
 * endpoint — in un valore solo, e quel valore diceva `'gemini'` per intendere "il gateway", quindi
 * ogni confronto scritto contro di lei si leggeva al contrario di quello che faceva.
 */
function textGoesToKie(): boolean {
  const chosen = route('text');
  return chosen.endpoint === 'kie' && chosen.family !== 'gemini';
}

/** Chi serve il testo DAVVERO, per la riga di avvio: la rotta di adesso, non una foto di prima. */
export function textRouteLabel(): string {
  if (textGoesToKie()) return `kie (${env.KIE_MODEL || 'grok-4-5'})`;
  if (!llmConfigured()) return 'not configured (LLM_API_KEY missing)';
  const host = llmBaseUrl().replace(/^https?:\/\//, '').split('/')[0];
  return `${host} (${llmModels().join(', ') || 'no model declared'})`;
}

// Questa chiamata resta sul GATEWAY qualunque cosa dica la rotta: strategia GTM, piano editoriale,
// articoli del blog. Da spargere negli opts di `aiStructured` nei call site che lo vogliono.
//
// Terzo nome in tre giri, e ogni volta per lo stesso motivo. `DEEPSEEK_FIRST` prometteva DeepSeek
// dopo che DeepSeek era uscito dal router; `PIN_GEMINI` prometteva Gemini quando ormai voleva dire
// "il gateway", che serve il modello scelto dal catalogo. Il nome di adesso dice l'ENDPOINT, che è
// la cosa che questo pin decide davvero.
export const PIN_GATEWAY = { provider: 'gateway' as const };

// Extra fields threaded into logAiCall so per-site labels/attribution survive both providers.
export type AiLogExtras = { brandId?: string; userId?: string; threadId?: string; context?: string };

let warnedStaleBudget = false;

/**
 * Quanto ragiona ogni chiamata di giudizio / revisione / QC. Letta a ogni chiamata, così una
 * regressione si disinnesca cambiando la variabile invece che con un deploy.
 *
 * Stava in `gemini.ts` e si chiamava `judgeThinkingLevel`, nel vocabolario di Google — ma il valore
 * viaggia su `reasoning.effort` di OpenRouter, e da lì passa. Il nome vecchio prometteva
 * `thinkingLevel`, un campo che nessuna chiamata di questo prodotto manda più.
 *
 * Le vecchie *_THINKING_BUDGET numeriche sono morte: si avvisa una volta invece di lasciarle
 * sembrare vive nella configurazione.
 */
export function judgeReasoningEffort(rawOverride?: string | null): ReasoningEffort {
  if (!warnedStaleBudget && (env.GEMINI_JUDGE_THINKING_BUDGET || env.PREPUBLISH_THINKING_BUDGET)) {
    warnedStaleBudget = true;
    console.warn(
      '[AI] GEMINI_JUDGE_THINKING_BUDGET / PREPUBLISH_THINKING_BUDGET are ignored: the gateway takes ' +
        'reasoning.effort, not a token budget. Use GEMINI_JUDGE_THINKING_LEVEL=low|medium|high.'
    );
  }
  return reasoningEffort(rawOverride ?? env.GEMINI_JUDGE_THINKING_LEVEL);
}

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

// Provider-aware structured call with automatic Gemini fallback. Supports image inputs on BOTH
// paths (Xiaomi routes them to the vision tier; Gemini attaches them as inline parts).
// `opts.provider` forces a specific provider for this call (e.g. blog writing → xiaomi + cheap pro).
// `opts.noFallback` skips the Gemini safety net when set.
export async function aiStructured<T>(
  prompt: string,
  schema: AnyRec,
  systemInstruction?: string,
  toolName = 'return_result',
  opts?: {
    images?: ImagePart[];
    temperature?: number;
    model?: string;
    provider?: 'gateway' | 'kie';
    noFallback?: boolean;
    /** Lo sforzo di ragionamento per QUESTA chiamata. Assente = il default del gateway. */
    reasoningEffort?: ReasoningEffort;
  } & AiLogExtras
): Promise<T> {
  const brandId = requireBrandContext(opts);
  const provider =
    opts?.provider === 'gateway' || opts?.provider === 'kie'
      ? opts.provider
      : textGoesToKie()
        ? 'kie'
        : 'gateway';
  const t0 = Date.now();
  const { images, temperature, model, provider: _forced, noFallback, reasoningEffort: effort, ...logExtras } = opts ?? {};

  // Un percorso che fallisce sempre e viene sempre salvato da un altro non è un risparmio: è
  // latenza e rumore nei log che nasconde i guasti veri. È il motivo per cui prima DeepSeek e poi
  // MiMo sono usciti da qui: entrambi tenuti in piedi da un ripiego che funzionava troppo bene per
  // far notare che il primo tentativo era condannato.
  console.log(`[AI] structured call → ${provider}${opts?.model ? ` (${opts.model})` : ''}`);
  const viaLlm = () =>
    llmStructured<T>({
      prompt,
      schema,
      system: systemInstruction,
      images: llmImagesFromInline(images),
      temperature,
      model,
      reasoningEffort: effort,
      label: toolName
    });
  try {
    if (provider === 'kie') {
      const result = await structuredKie<T>(prompt, schema, systemInstruction, toolName, logExtras, images, temperature, model);
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
    if (provider === 'kie') {
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

// Testo libero: kie quando la rotta lo chiede, il gateway altrimenti, con ripiego sul gateway.
export async function aiText(
  prompt: string,
  systemInstruction?: string,
  opts?: { label?: string; images?: ImagePart[] } & AiLogExtras
): Promise<string> {
  const brandId = requireBrandContext(opts);
  const provider = textGoesToKie() ? 'kie' : 'gateway';
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
    if (provider === 'kie') {
      const result = await textKie(prompt, systemInstruction, { label, images, ...logExtras });
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
    if (provider === 'kie') {
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
