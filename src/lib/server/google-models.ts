/**
 * Gli id dei modelli Google, nelle forme in cui ce li fatturano — e nient'altro.
 *
 * Qui c'erano i due client Gemini — `makeGenaiClient` (kie o Google) e `googleGenaiClient` (Google
 * sempre) — piu` il trasporto che sceglieva fra i due. Sono spariti con l'ultimo chiamante: ogni
 * pixel passa dallo slot immagini, ogni testo dal centralino, e i due endpoint vivi sono kie e
 * OpenRouter. Restano gli ID e le tariffe, che servono al registro di cassa: un modello Gemini si
 * paga anche quando a servirlo e` qualcun altro.
 *
 * Si chiamava `gemini.ts`, e prometteva una linea verso Gemini che non c'e` piu`: la stessa bugia
 * di `xiaomi.ts`, diventato `ai-text.ts`. Il nome di adesso dice di CHI sono i modelli, non con chi
 * parliamo — perche' con Google non parla piu` nessuno.
 */
import { env } from '$env/dynamic/private';
import { GEMINI_NANO_BANANA_2_LITE, GEMINI_NANO_BANANA_PRO } from '$lib/image-models';

/** Default Gemini Flash text/vision model when `GEMINI_FLASH` is unset. */
export const GEMINI_FLASH = 'gemini-3.7-flash';

const FLASH_ID = /^gemini-\d+(\.\d+)?-flash$/;

/**
 * Flash model for this call. Read per request (not module-init) so the Vercel env var takes
 * effect without a rebuild; an id that isn't a Flash id falls back to `GEMINI_FLASH`.
 */
export function geminiFlash(): string {
  const raw = env.GEMINI_FLASH?.trim();
  if (raw && FLASH_ID.test(raw)) return raw;
  return GEMINI_FLASH;
}

export function isGeminiFlashId(model: string | undefined): boolean {
  return !!model && FLASH_ID.test(model);
}

/** Nano Banana Pro — reachable only via an explicit model at a call site. */
export const NANO_BANANA_PRO = GEMINI_NANO_BANANA_PRO;

export function isNanoBananaProId(model: string | undefined): boolean {
  return model === NANO_BANANA_PRO;
}

/** Nano Banana 2 Lite — the default render model everywhere (Gemini 3.1 Flash-Lite Image). */
export const NANO_BANANA_2_LITE = GEMINI_NANO_BANANA_2_LITE;

/**
 * Share of *list* written to `ai_calls.cost_usd` for Gemini Flash / Nano Banana Pro: always 1,
 * on every plan — full price IS the rule, `plan` is ignored and kept only for the call sites.
 * The single seam a discount would go back through.
 */
export function geminiVisualCreditShare(plan?: string | null): number {
  return 1;
}

/** `gemini-3.7-flash` → `gemini-3-7-flash`, la forma che accetta il passthrough di kie. */
export function kieFlashId(modelId: string): string {
  return modelId.replace(/\./g, '-');
}

const KIE_FLASH_ID = /^gemini-\d+-\d+-flash$/;

/**
 * Id Flash nella forma kie (trattini). `computeCostUsd` la usa per non far cadere una riga kie
 * sulle tariffe Google: sono 16 volte tanto e non darebbero nessun errore.
 */
export function isKieFlashId(model: string | undefined): boolean {
  return !!model && KIE_FLASH_ID.test(model);
}
