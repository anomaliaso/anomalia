/**
 * User-selectable chat model.
 * Auto = pick per turn (today: Fast at full thinking), Fast = GPT 5.6 Luna via kie, Pro = Grok 4.6
 * via kie. Custom models are named explicitly — DeepSeek V4 Pro, GPT 5.6 Terra, GPT 5.6 Sol.
 *
 * Billing is NEVER multiplied here. Credits = Σ ai_calls.cost_usd × 100, and cost_usd comes
 * from real token usage × RATES in ai-log.ts (or flatCostUsd when the provider bills that way).
 * Every model is billed at 100% of list, on every plan — including Gemini Flash and Nano Banana
 * Pro, which carried a per-plan discount until 2026-08.
 */
import type { ModelFamilyId } from '@anomalia/agent-contracts/contracts';

export type ChatPresetTier = 'auto' | 'fast' | 'pro';
const CHAT_CUSTOM_MODEL_IDS = ['deepseek-pro', 'gpt-terra', 'gpt-sol'] as const satisfies readonly ModelFamilyId[];
export type ChatCustomModel = (typeof CHAT_CUSTOM_MODEL_IDS)[number];
/**
 * Un id del gateway (`anthropic/claude-opus-5`) è una scelta valida quanto un preset: il picker
 * offre il catalogo, non tre nomi scritti a mano. Qui se ne riconosce solo la FORMA — se quel
 * modello esista davvero lo sa il server, che ha il listino, e un id sconosciuto ricade sul
 * default invece di rompere il turno.
 */
export type ChatGatewayModelTier = string;
export type ChatTier = ChatPresetTier | ChatCustomModel | ChatGatewayModelTier;

const GATEWAY_MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

export function isGatewayModelTier(v: unknown): boolean {
  return typeof v === 'string' && GATEWAY_MODEL_ID.test(v.trim());
}

export const CHAT_PRESET_TIERS: ChatPresetTier[] = ['auto', 'fast', 'pro'];
export const CHAT_CUSTOM_MODELS: ChatCustomModel[] = [...CHAT_CUSTOM_MODEL_IDS];
export const CHAT_TIERS: ChatTier[] = [...CHAT_PRESET_TIERS, ...CHAT_CUSTOM_MODELS];

/** What a chat starts on when the brand has not set its own default. */
export const DEFAULT_CHAT_TIER: ChatTier = 'auto';

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

/** Normalise anything stored/sent as a tier, falling back to the default. */
export function coerceChatTier(v: unknown): ChatTier {
  return isChatTier(v) ? v : DEFAULT_CHAT_TIER;
}
