/**
 * Catalogo modelli: interfaccia comune + mappa verso il vocabolario nativo di ogni provider.
 *
 * La UI e gli agenti parlano SOLO la scala comune (`ThinkingLevel`). Ogni famiglia dichiara
 * quali gradini offre e come si scrivono sul filo. Cambiare Grok o Luna è una riga qui,
 * non un if sparso in chat-reasoning / model.ts.
 *
 * Tier (auto/fast/pro) ≠ modello: il tier è la scelta utente; la famiglia è ciò che
 * l'agente o il tier risolvono. Il vocabolario delle famiglie vive nei contratti
 * (`@anomalia/agent-contracts/contracts`), vedi anche `AgentSpec.model`.
 */
import type { ModelFamilyId } from '@anomalia/agent-contracts/contracts';

export type { ModelFamilyId };

/** Scala unica in prodotto: off → max. Niente none/xhigh in UI. */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'low',
  'medium',
  'high',
  'max'
] as const;

/** Intensità relativa: serve a portare una scelta quando si cambia famiglia. */
export const THINKING_RANK: Record<ThinkingLevel, number> = {
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
  max: 4
};

export type ModelProvider = 'kie' | 'gemini' | 'deepseek' | 'xiaomi';

export type ModelCapabilities = {
  vision: boolean;
  video: boolean;
  /** Può spegnere del tutto il thinking (solo DeepSeek oggi). */
  thinkingOff: boolean;
};

/**
 * Una famiglia di modello: id stabile, id wire (o factory), livelli comuni offerti,
 * e la mappa verso ciò che il provider accetta davvero.
 */
export type ModelFamily = {
  id: ModelFamilyId;
  /** Provider di trasporto preferito. */
  provider: ModelProvider;
  /** Id sul filo (o prefisso leggibile). Può essere sovrascritto da env al resolve. */
  wireId: string;
  /** Gradini del picker quando QUESTA famiglia è sotto. */
  thinking: readonly ThinkingLevel[];
  /** Default se l'utente non ha scelto. */
  defaultThinking: ThinkingLevel;
  /** Common → stringa nativa (effort / thinkingLevel / …). */
  toNativeThinking: (level: ThinkingLevel) => string;
  capabilities: ModelCapabilities;
};

function nearest(
  want: ThinkingLevel,
  offered: readonly ThinkingLevel[]
): ThinkingLevel {
  const rank = THINKING_RANK[want];
  return offered.reduce((best, c) => {
    const d = Math.abs(THINKING_RANK[c] - rank);
    const bestD = Math.abs(THINKING_RANK[best] - rank);
    if (d < bestD) return c;
    // A parità, il più economico (rank più basso).
    return d === bestD && THINKING_RANK[c] < THINKING_RANK[best] ? c : best;
  });
}

/** Porta un livello (o spazzatura) sui gradini che la famiglia offre. */
export function coerceThinking(
  level: unknown,
  family: ModelFamily
): ThinkingLevel {
  if (typeof level === 'string' && (family.thinking as readonly string[]).includes(level)) {
    return level as ThinkingLevel;
  }
  // Alias legacy dalla vecchia unione ChatReasoning.
  if (level === 'none') return coerceThinking('off', family);
  if (level === 'xhigh') return coerceThinking('max', family);
  if (typeof level === 'string' && level in THINKING_RANK) {
    return nearest(level as ThinkingLevel, family.thinking);
  }
  return family.defaultThinking;
}

export function nativeThinking(level: unknown, family: ModelFamily): string {
  return family.toNativeThinking(coerceThinking(level, family));
}

// ── Famiglie ──────────────────────────────────────────────────────────────────

const LUNA_THINKING = ['low', 'medium', 'high'] as const satisfies readonly ThinkingLevel[];
const GROK_THINKING = ['low', 'medium', 'high', 'max'] as const satisfies readonly ThinkingLevel[];
const DEEPSEEK_THINKING = ['off', 'low', 'high', 'max'] as const satisfies readonly ThinkingLevel[];
const GPT56_THINKING = ['off', 'low', 'medium', 'high', 'max'] as const satisfies readonly ThinkingLevel[];

/**
 * GPT 5.6 Luna (kie Codex). Tre gradini misurati; off/max collassano sul pavimento/soffitto.
 * Native: reasoning.effort low|medium|high (kie non ha off; max → high).
 */
export const LUNA: ModelFamily = {
  id: 'luna',
  provider: 'kie',
  wireId: 'gpt-5-6-luna',
  thinking: LUNA_THINKING,
  defaultThinking: 'medium',
  toNativeThinking: (level) => {
    const v = nearest(level, LUNA_THINKING);
    return v; // low|medium|high
  },
  capabilities: { vision: true, video: false, thinkingOff: false }
};

/**
 * Grok 4.6 (kie). Native: low|medium|high|xhigh — il nostro max diventa xhigh.
 */
export const GROK: ModelFamily = {
  id: 'grok',
  provider: 'kie',
  wireId: 'grok-4-6',
  thinking: GROK_THINKING,
  defaultThinking: 'high',
  toNativeThinking: (level) => {
    const v = nearest(level, GROK_THINKING);
    return v === 'max' ? 'xhigh' : v;
  },
  capabilities: { vision: true, video: false, thinkingOff: false }
};

/**
 * Gemini 3.x Flash (ripiego). Native thinkingLevel: low|medium|high.
 */
export const GEMINI_FLASH: ModelFamily = {
  id: 'gemini-flash',
  provider: 'gemini',
  wireId: 'gemini-3.7-flash',
  thinking: LUNA_THINKING,
  defaultThinking: 'medium',
  toNativeThinking: (level) => nearest(level, LUNA_THINKING),
  capabilities: { vision: true, video: true, thinkingOff: false }
};

/**
 * DeepSeek V4 Pro. Unico con off vero. Native: thinking disabled | effort low|high|max.
 * Non ha medium: collassa su high (più vicino a medium+ che a low).
 */
export const DEEPSEEK_PRO: ModelFamily = {
  id: 'deepseek-pro',
  provider: 'deepseek',
  wireId: 'deepseek-v4-pro',
  thinking: DEEPSEEK_THINKING,
  defaultThinking: 'high',
  toNativeThinking: (level) => {
    if (level === 'off') return 'off';
    if (level === 'low') return 'low';
    if (level === 'max') return 'max';
    // medium e high → high
    return 'high';
  },
  capabilities: { vision: false, video: false, thinkingOff: true }
};

/** GPT 5.6 Terra / Sol (kie Codex). Native: none|low|medium|high|xhigh|max. */
function gpt56Family(id: 'gpt-terra' | 'gpt-sol', wireId: string): ModelFamily {
  return {
    id,
    provider: 'kie',
    wireId,
    thinking: GPT56_THINKING,
    defaultThinking: 'high',
    toNativeThinking: (level) => {
      const v = nearest(level, GPT56_THINKING);
      if (v === 'off') return 'none';
      // kie Codex OpenAPI: low|medium|high|xhigh — max → xhigh sul filo se serve
      if (v === 'max') return 'xhigh';
      return v;
    },
    capabilities: { vision: true, video: false, thinkingOff: true }
  };
}

export const GPT_TERRA = gpt56Family('gpt-terra', 'gpt-5-6-terra');
export const GPT_SOL = gpt56Family('gpt-sol', 'gpt-5-6-sol');

export const MODEL_FAMILIES: Record<ModelFamilyId, ModelFamily> = {
  luna: LUNA,
  grok: GROK,
  'gemini-flash': GEMINI_FLASH,
  'deepseek-pro': DEEPSEEK_PRO,
  'gpt-terra': GPT_TERRA,
  'gpt-sol': GPT_SOL
};

export function modelFamily(id: ModelFamilyId): ModelFamily {
  return MODEL_FAMILIES[id];
}

// ── Tier utente → famiglia di default (senza agente) ──────────────────────────

import type { ChatTier } from '$lib/chat-tiers';

/**
 * Cosa risolve un tier del picker quando nessun agente impone altro.
 * Auto = Luna (default prodotto). Pro = Grok. Fast = Luna.
 */
export const TIER_DEFAULT_FAMILY: Record<ChatTier, ModelFamilyId> = {
  auto: 'luna',
  fast: 'luna',
  pro: 'grok',
  'deepseek-pro': 'deepseek-pro',
  'gpt-terra': 'gpt-terra',
  'gpt-sol': 'gpt-sol'
};

/** Famiglia sotto un tier, opzionalmente sovrascritta dalla policy dell'agente. */
export function familyForTier(
  tier: ChatTier,
  agentFamily?: ModelFamilyId | null
): ModelFamily {
  // Solo Auto è "scelta dell'agente". Fast/Pro/custom restano la scelta esplicita dell'utente.
  if (tier === 'auto' && agentFamily) return modelFamily(agentFamily);
  return modelFamily(TIER_DEFAULT_FAMILY[tier]);
}
