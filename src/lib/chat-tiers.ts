/**
 * User-selectable chat model.
 *
 * I preset Auto/Fast/Pro NON esistono piu`. Non erano modelli: erano alias per due variabili
 * d'ambiente — Auto e Fast risolvevano lo stesso `LLM_DEFAULT_MODEL`, Pro il *secondo* elemento
 * di `LLM_MODELS`, scelto per posizione in una lista separata da virgole. Tre nomi nel menu per
 * due valori, e nessuno dei due toccabile senza un deploy.
 *
 * Adesso una scelta e` un id del gateway e basta. Chi non sceglie prende il default globale
 * (`chat_model_catalog.is_default`), che il brand puo` sovrascrivere nei Settings e la singola
 * chat dal picker del prompt. Custom models are named explicitly — DeepSeek V4 Pro, GPT 5.6
 * Terra, GPT 5.6 Sol.
 *
 * Billing is NEVER multiplied here. Credits = Σ ai_calls.cost_usd × 100, and cost_usd comes
 * from real token usage × RATES in ai-log.ts (or flatCostUsd when the provider bills that way).
 * Every model is billed at 100% of list, on every plan — including Gemini Flash and Nano Banana
 * Pro, which carried a per-plan discount until 2026-08.
 */
import type { ModelFamilyId } from '@anomalia/agent-contracts/contracts';

const CHAT_CUSTOM_MODEL_IDS = ['deepseek-pro', 'gpt-terra', 'gpt-sol'] as const satisfies readonly ModelFamilyId[];
export type ChatCustomModel = (typeof CHAT_CUSTOM_MODEL_IDS)[number];
/**
 * Un id del gateway (`anthropic/claude-opus-5`) è una scelta valida quanto un preset: il picker
 * offre il catalogo, non tre nomi scritti a mano. Qui se ne riconosce solo la FORMA — se quel
 * modello esista davvero lo sa il server, che ha il listino, e un id sconosciuto ricade sul
 * default invece di rompere il turno.
 */
export type ChatGatewayModelTier = string;
export type ChatTier = ChatCustomModel | ChatGatewayModelTier;

const GATEWAY_MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function isGatewayModelTier(v: unknown): boolean {
  return typeof v === 'string' && GATEWAY_MODEL_ID.test(v.trim());
}

export const CHAT_CUSTOM_MODELS: ChatCustomModel[] = [...CHAT_CUSTOM_MODEL_IDS];
export const CHAT_TIERS: ChatTier[] = [...CHAT_CUSTOM_MODELS];

/*
 * Il moltiplicatore "≈N× crediti" nel picker è stato ELIMINATO, non ricalcolato.
 *
 * Diceva 6× per Pro e 3× per DeepSeek Pro. Erano numeri di un mondo che non esiste più: il 3×
 * era calcolato contro DeepSeek V4 *Flash* ($0.14/$0.28), che non è il modello Fast da un pezzo.
 * Oggi Fast è GPT 5.6 Luna a $0.056/$0.336 per 1M token (misurato sui crediti kie, non dedotto),
 * mentre Grok 4.6 ("Pro") sta a $0.80/$2.40 e DeepSeek V4 Pro a $0.435/$0.87 (RATES in
 * server/ai-log.ts). Ora il rapporto è ribaltato di nuovo: i modelli "cari" costano davvero di
 * più del default, ma di 7×–25× a seconda del mix, non del 6× fisso che diceva l'etichetta.
 * Un numero che cambia ogni volta che cambia un modello non è un'etichetta, è una promessa.
 *
 * Non l'ho ricalcolato in "0.4×" perché non sarebbe comunque vero a lungo: Grok e i GPT via kie
 * spesso vengono fatturati con flatCostUsd (credits_consumed della risposta), non con le RATES,
 * quindi il rapporto non è nemmeno conoscibile da qui. Un numero che non si può affermare
 * onestamente si toglie. Gli hint ora parlano solo di qualità e latenza.
 */

export function isChatTier(v: unknown): v is ChatTier {
  return (typeof v === 'string' && (CHAT_TIERS as readonly string[]).includes(v)) || isGatewayModelTier(v);
}

export function isCustomChatModel(v: unknown): v is ChatCustomModel {
  return typeof v === 'string' && (CHAT_CUSTOM_MODELS as readonly string[]).includes(v);
}

export function isGptCustomModel(v: unknown): v is 'gpt-terra' | 'gpt-sol' {
  return v === 'gpt-terra' || v === 'gpt-sol';
}

/**
 * Normalise anything stored/sent as a tier. `null` = nessuna scelta, e chi risolve prende il
 * default globale — non c'e` piu` una costante qui che possa dire il contrario del database.
 */
export function coerceChatTier(v: unknown): ChatTier | null {
  return isChatTier(v) ? v : null;
}
