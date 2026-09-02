import { describe, it, expect } from 'vitest';
import { coerceChatTier, DEFAULT_CHAT_TIER, CHAT_TIERS, type ChatTier } from './chat-tiers';
import { defaultReasoningFor, reasoningLevelsFor } from './chat-reasoning';
import {
  coerceReasoning,
  DEFAULT_REASONING,
  deepseekThinking,
  geminiThinkingLevel,
  grokReasoningEffort,
  gptReasoningEffort,
  isValidForTier,
  kieGptReasoningEffort,
  penultimateLevel,
  REASONING_LEVELS
} from './chat-reasoning';

describe('REASONING_LEVELS', () => {
  it('gives each provider its own vocabulary, not a shared one', () => {
    expect(REASONING_LEVELS.fast).toEqual(['low', 'medium', 'high']);
    expect(REASONING_LEVELS.pro).toEqual(['low', 'medium', 'high', 'max']);
    // DeepSeek shares Gemini's off switch but not its 'medium': its API has no such effort.
    expect(REASONING_LEVELS['deepseek-pro']).toEqual(['off', 'low', 'high', 'max']);
    expect(REASONING_LEVELS['gpt-terra']).toEqual(['off', 'low', 'medium', 'high', 'max']);
    expect(REASONING_LEVELS['gpt-sol']).toEqual(REASONING_LEVELS['gpt-terra']);
    expect(isValidForTier('off', 'pro')).toBe(false);
    // Grok's ceiling is 'max' on the common scale (native xhigh on the wire).
    expect(isValidForTier('max', 'pro')).toBe(true);
    expect(isValidForTier('medium', 'fast')).toBe(true);
    expect(isValidForTier('medium', 'deepseek-pro')).toBe(false);
    // Luna (dietro Fast) non spegne il thinking e non ha un gradino sopra 'high'.
    expect(isValidForTier('off', 'fast')).toBe(false);
    expect(isValidForTier('max', 'fast')).toBe(false);
    expect(isValidForTier('xhigh', 'fast')).toBe(false);
    expect(isValidForTier('max', 'deepseek-pro')).toBe(true);
    // 'none' e' solo un alias legacy di coerceReasoning: isValidForTier vuole il valore reale ('off').
    expect(isValidForTier('none', 'gpt-terra')).toBe(false);
    expect(isValidForTier('max', 'gpt-sol')).toBe(true);
    expect(isValidForTier('off', 'gpt-sol')).toBe(true);
  });
});

describe('DEFAULT_REASONING', () => {
  it('is the penultimate level of that model’s own list, Fast e Auto exceptedi', () => {
    for (const tier of CHAT_TIERS) {
      if (tier === 'fast' || tier === 'auto') continue;
      expect(DEFAULT_REASONING[tier]).toBe(penultimateLevel(REASONING_LEVELS[tier as ChatTier]));
    }
    expect(DEFAULT_REASONING.pro).toBe('high');
    expect(DEFAULT_REASONING['deepseek-pro']).toBe('high');
    expect(DEFAULT_REASONING['gpt-terra']).toBe('high');
    expect(DEFAULT_REASONING['gpt-sol']).toBe('high');
  });

  // Fast e Auto → Luna a medium; Pro → Grok a high (catalogo).
  it('tiene Fast e Auto a medium, Pro a high', () => {
    expect(DEFAULT_REASONING.fast).toBe('medium');
    expect(DEFAULT_REASONING.auto).toBe('medium');
    expect(DEFAULT_REASONING.pro).toBe('high');
    expect(geminiThinkingLevel(DEFAULT_REASONING.fast)).toBe('medium');
    expect(geminiThinkingLevel(DEFAULT_REASONING.auto)).toBe('medium');
  });
});

describe('coerceReasoning', () => {
  it('keeps a level the tier already offers', () => {
    expect(coerceReasoning('medium', 'fast')).toBe('medium');
    expect(coerceReasoning('medium', 'pro')).toBe('medium');
    expect(coerceReasoning('off', 'gpt-terra')).toBe('off');
  });

  it('maps the ceiling onto the other ceiling across a tier switch', () => {
    // Scala comune: max resta max su Grok; sul filo diventa xhigh (nativeThinking).
    expect(coerceReasoning('max', 'pro')).toBe('max');
    expect(coerceReasoning('xhigh', 'pro')).toBe('max');
    expect(coerceReasoning('xhigh', 'deepseek-pro')).toBe('max');
    expect(coerceReasoning('xhigh', 'fast')).toBe('high');
    expect(coerceReasoning('max', 'fast')).toBe('high');
  });

  it("lands 'off' on Grok's floor, which has no off switch", () => {
    expect(coerceReasoning('off', 'pro')).toBe('low');
  });

  it('breaks a tie toward the cheaper side', () => {
    // medium (2) sits exactly between low (1) and high (3) on the DeepSeek scale.
    expect(coerceReasoning('medium', 'deepseek-pro')).toBe('low');
  });

  it('falls back to the tier default for junk', () => {
    expect(coerceReasoning('turbo', 'fast')).toBe('medium');
    expect(coerceReasoning(null, 'pro')).toBe('high');
    expect(coerceReasoning(null, 'deepseek-pro')).toBe('high');
    expect(coerceReasoning(null, 'gpt-sol')).toBe('high');
  });
});

describe('deepseekThinking', () => {
  it('disables thinking on off and sends no effort with it', () => {
    expect(deepseekThinking('off')).toEqual({ thinking: { type: 'disabled' } });
  });

  it('enables thinking and passes the effort through', () => {
    expect(deepseekThinking('max')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max'
    });
  });

  it('never leaks a Grok-only level into the DeepSeek body', () => {
    expect(deepseekThinking('xhigh').reasoning_effort).toBe('max');
    for (const level of REASONING_LEVELS.pro) {
      const effort = deepseekThinking(level).reasoning_effort;
      expect(effort === undefined || ['low', 'high', 'max'].includes(effort)).toBe(true);
    }
  });
});

describe('geminiThinkingLevel', () => {
  it('never emits a value outside the three levels 3.7 Flash documents', () => {
    const allowed = new Set(['low', 'medium', 'high']);
    for (const levels of Object.values(REASONING_LEVELS)) {
      for (const level of levels) {
        expect(allowed.has(geminiThinkingLevel(level))).toBe(true);
      }
    }
  });

  it('lands the off switch on the floor — this model has none', () => {
    expect(geminiThinkingLevel('off')).toBe('low');
    expect(geminiThinkingLevel('none')).toBe('low');
  });
});

describe('grokReasoningEffort', () => {
  it('passes Grok levels straight through', () => {
    expect(grokReasoningEffort('medium')).toBe('medium');
    expect(grokReasoningEffort('xhigh')).toBe('xhigh');
  });

  it('never emits a value outside the documented Grok scale', () => {
    const allowed = new Set(['low', 'medium', 'high', 'xhigh']);
    for (const levels of Object.values(REASONING_LEVELS)) {
      for (const level of levels) {
        expect(allowed.has(grokReasoningEffort(level))).toBe(true);
      }
    }
  });
});

describe('gptReasoningEffort', () => {
  it('keeps none as-is, and writes the common max as xhigh on the kie wire', () => {
    expect(gptReasoningEffort('none')).toBe('none');
    expect(gptReasoningEffort('max')).toBe('xhigh');
    expect(gptReasoningEffort('xhigh')).toBe('xhigh');
  });
});

describe('kieGptReasoningEffort', () => {
  it('maps none/max onto the kie Codex enum', () => {
    expect(kieGptReasoningEffort('none')).toBe('low');
    expect(kieGptReasoningEffort('max')).toBe('xhigh');
    expect(kieGptReasoningEffort('high')).toBe('high');
    expect(kieGptReasoningEffort('xhigh')).toBe('xhigh');
  });
});

// Auto = "scelta dell'agente": default Luna (stessi livelli di Fast). Motion sovrascrive a Grok.
describe('auto tier', () => {
  it('usa i livelli di Luna di default, e parte da medium', () => {
    expect(REASONING_LEVELS.auto).toEqual(REASONING_LEVELS.fast);
    expect(DEFAULT_REASONING.auto).toBe('medium');
    expect(coerceReasoning('high', 'auto')).toBe('high');
    expect(coerceReasoning('nonsense', 'auto')).toBe('medium');
    expect(coerceReasoning(undefined, 'auto')).toBe('medium');
    // Con famiglia Grok (motion): max è valido, xhigh collassa su max.
    expect(coerceReasoning('max', 'auto', 'grok')).toBe('max');
    expect(coerceReasoning('xhigh', 'auto', 'grok')).toBe('max');
  });

  it('sends DeepSeek thinking on when the vision swap borrows Auto’s level', () => {
    const t = deepseekThinking(DEFAULT_REASONING.auto);
    expect(t.thinking).toEqual({ type: 'enabled' });
    expect(['low', 'high', 'max']).toContain(t.reasoning_effort);
  });
});

describe('coerceChatTier', () => {
  it('keeps a real tier and falls back to auto for anything else', () => {
    expect(coerceChatTier('pro')).toBe('pro');
    expect(coerceChatTier('fast')).toBe('fast');
    expect(coerceChatTier('auto')).toBe('auto');
    expect(coerceChatTier('deepseek-pro')).toBe('deepseek-pro');
    expect(coerceChatTier('gpt-terra')).toBe('gpt-terra');
    expect(coerceChatTier('gpt-sol')).toBe('gpt-sol');
    expect(coerceChatTier(null)).toBe(DEFAULT_CHAT_TIER);
    expect(coerceChatTier('gpt-9')).toBe('auto');
  });
});


/**
 * Con il catalogo del gateway il tier può essere un id qualunque: `REASONING_LEVELS[tier]` e
 * `DEFAULT_REASONING[tier]` erano mappe con sei chiavi, e su un id nuovo restituivano undefined —
 * cioè il picker si schiantava su `.length` alla prima apertura del menu.
 */
describe('un tier che è un id di modello', () => {
  it('ha comunque una scala di ragionamento', () => {
    expect(reasoningLevelsFor('anthropic/claude-opus-5').length).toBeGreaterThan(0);
    expect(defaultReasoningFor('anthropic/claude-opus-5')).toBeTruthy();
  });

  it('i preset restano quelli di prima', () => {
    expect(defaultReasoningFor('pro')).toBe(DEFAULT_REASONING.pro);
    expect(reasoningLevelsFor('fast')).toEqual(REASONING_LEVELS.fast);
  });
});
