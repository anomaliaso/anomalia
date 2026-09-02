import { type ChatTier } from '$lib/chat-tiers';
import {
  coerceThinking,
  familyForTier,
  modelFamily,
  nativeThinking,
  type ModelFamilyId,
  type ThinkingLevel,
  THINKING_LEVELS
} from '$lib/models/catalog';

/**
 * Reasoning effort in UI / storage: la scala COMUNE del catalogo modelli.
 *
 * I vocabolari nativi (xhigh, none, thinkingLevel Gemini, …) vivono solo in
 * `src/lib/models/catalog.ts` come `toNativeThinking`. Qui non si inventano alias.
 *
 * Compat: 'none' e 'xhigh' restano accettati in ingresso (coerce → off / max) così
 * preferenze e righe vecchie non 400-ano.
 */
export type ChatReasoning = ThinkingLevel | 'none' | 'xhigh';

export type { ThinkingLevel };

/** Livelli offerti dal picker per un tier. */
export function reasoningLevelsFor(tier: ChatTier | null): readonly ThinkingLevel[] {
  return familyForTier(tier).thinking;
}

/** Il default di un tier qualunque, id del gateway e "nessuna scelta" compresi. */
export function defaultReasoningFor(tier: ChatTier | null): ThinkingLevel {
  return familyForTier(tier).defaultThinking;
}

export function penultimateLevel(levels: readonly ThinkingLevel[]): ThinkingLevel {
  return levels[Math.max(0, levels.length - 2)];
}

export const CHAT_REASONING_KEY = 'anomalia.chatReasoning';

export function isChatReasoning(v: unknown): v is ChatReasoning {
  if (typeof v !== 'string') return false;
  if ((THINKING_LEVELS as readonly string[]).includes(v)) return true;
  return v === 'none' || v === 'xhigh';
}

export function isValidForTier(level: unknown, tier: ChatTier | null): level is ThinkingLevel {
  if (typeof level !== 'string') return false;
  return (reasoningLevelsFor(tier) as readonly string[]).includes(level);
}

/** Porta una scelta sui gradini della famiglia sotto il tier. */
export function coerceReasoning(level: unknown, tier: ChatTier | null): ThinkingLevel {
  return coerceThinking(level, familyForTier(tier));
}

/** DeepSeek V4 Pro: body thinking + effort nativi. */
export function deepseekThinking(level: ChatReasoning): {
  thinking: { type: 'enabled' | 'disabled' };
  reasoning_effort?: 'low' | 'high' | 'max';
} {
  const family = modelFamily('deepseek-pro');
  const common = coerceThinking(level, family);
  if (common === 'off') return { thinking: { type: 'disabled' } };
  const effort = nativeThinking(common, family) as 'low' | 'high' | 'max';
  return { thinking: { type: 'enabled' }, reasoning_effort: effort };
}

/** Gemini Flash: thinkingLevel nativo. */
export function geminiThinkingLevel(level: ChatReasoning): 'low' | 'medium' | 'high' {
  return nativeThinking(level, modelFamily('luna')) as 'low' | 'medium' | 'high';
}

/** Grok: effort nativo (max → xhigh). */
export function grokReasoningEffort(level: ChatReasoning): 'low' | 'medium' | 'high' | 'xhigh' {
  return nativeThinking(level, modelFamily('grok')) as 'low' | 'medium' | 'high' | 'xhigh';
}

/** Terra/Sol: effort nativo sul filo kie. */
export function gptReasoningEffort(
  level: ChatReasoning
): 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  return nativeThinking(level, modelFamily('gpt-terra')) as
    | 'none'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max';
}

/**
 * kie Codex OpenAPI: low|medium|high|xhigh. none/max già mappati dal catalogo Terra.
 * Luna usa solo low|medium|high — per Luna si chiama nativeThinking sulla famiglia luna.
 */
export function kieGptReasoningEffort(level: ChatReasoning): 'low' | 'medium' | 'high' | 'xhigh' {
  const v = gptReasoningEffort(level);
  if (v === 'none') return 'low';
  if (v === 'max') return 'xhigh';
  return v;
}

/** Effort nativo per Luna (low|medium|high). */
export function lunaReasoningEffort(level: ChatReasoning): 'low' | 'medium' | 'high' {
  return nativeThinking(level, modelFamily('luna')) as 'low' | 'medium' | 'high';
}
