import { CHAT_TIERS, type ChatTier } from '$lib/chat-tiers';
import {
  coerceThinking,
  familyForTier,
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

/** Livelli offerti dal picker per un tier, data la famiglia sotto (agente o default tier). */
export function reasoningLevelsFor(
  tier: ChatTier,
  agentFamily?: ModelFamilyId | null
): readonly ThinkingLevel[] {
  return familyForTier(tier, agentFamily).thinking;
}

/**
 * @deprecated Prefer `reasoningLevelsFor(tier, agentFamily)`.
 * Mappa statica senza agente: Auto/Fast → Luna, Pro → Grok.
 */
export const REASONING_LEVELS: Record<ChatTier, readonly ThinkingLevel[]> = {
  auto: familyForTier('auto').thinking,
  fast: familyForTier('fast').thinking,
  pro: familyForTier('pro').thinking,
  'deepseek-pro': familyForTier('deepseek-pro').thinking,
  'gpt-terra': familyForTier('gpt-terra').thinking,
  'gpt-sol': familyForTier('gpt-sol').thinking
};

export function penultimateLevel(levels: readonly ThinkingLevel[]): ThinkingLevel {
  return levels[Math.max(0, levels.length - 2)];
}

/** Default thinking per tier (senza agente): dal catalogo. */
export const DEFAULT_REASONING: Record<ChatTier, ThinkingLevel> = Object.fromEntries(
  CHAT_TIERS.map((tier) => [tier, familyForTier(tier).defaultThinking])
) as Record<ChatTier, ThinkingLevel>;

export const CHAT_REASONING_KEY = 'anomalia.chatReasoning';

export function isChatReasoning(v: unknown): v is ChatReasoning {
  if (typeof v !== 'string') return false;
  if ((THINKING_LEVELS as readonly string[]).includes(v)) return true;
  return v === 'none' || v === 'xhigh';
}

export function isValidForTier(
  level: unknown,
  tier: ChatTier,
  agentFamily?: ModelFamilyId | null
): level is ThinkingLevel {
  if (typeof level !== 'string') return false;
  return (reasoningLevelsFor(tier, agentFamily) as readonly string[]).includes(level);
}

/**
 * Porta una scelta sui gradini della famiglia sotto il tier (e l'agente, se Auto).
 */
export function coerceReasoning(
  level: unknown,
  tier: ChatTier,
  agentFamily?: ModelFamilyId | null
): ThinkingLevel {
  return coerceThinking(level, familyForTier(tier, agentFamily));
}

/** DeepSeek V4 Pro: body thinking + effort nativi. */
export function deepseekThinking(level: ChatReasoning): {
  thinking: { type: 'enabled' | 'disabled' };
  reasoning_effort?: 'low' | 'high' | 'max';
} {
  const family = familyForTier('deepseek-pro');
  const common = coerceThinking(level, family);
  if (common === 'off') return { thinking: { type: 'disabled' } };
  const effort = nativeThinking(common, family) as 'low' | 'high' | 'max';
  return { thinking: { type: 'enabled' }, reasoning_effort: effort };
}

/** Gemini Flash: thinkingLevel nativo. */
export function geminiThinkingLevel(level: ChatReasoning): 'low' | 'medium' | 'high' {
  return nativeThinking(level, familyForTier('fast')) as 'low' | 'medium' | 'high';
}

/** Grok: effort nativo (max → xhigh). */
export function grokReasoningEffort(level: ChatReasoning): 'low' | 'medium' | 'high' | 'xhigh' {
  return nativeThinking(level, familyForTier('pro')) as 'low' | 'medium' | 'high' | 'xhigh';
}

/** Terra/Sol: effort nativo sul filo kie. */
export function gptReasoningEffort(
  level: ChatReasoning
): 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  return nativeThinking(level, familyForTier('gpt-terra')) as
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
  return nativeThinking(level, familyForTier('fast')) as 'low' | 'medium' | 'high';
}
