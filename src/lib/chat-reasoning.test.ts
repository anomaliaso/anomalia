import { describe, it, expect } from 'vitest';
import { coerceChatTier, CHAT_TIERS, type ChatTier } from './chat-tiers';
import { modelFamily } from './models/catalog';
import {
  coerceReasoning,
  defaultReasoningFor,
  deepseekThinking,
  geminiThinkingLevel,
  grokReasoningEffort,
  gptReasoningEffort,
  isValidForTier,
  kieGptReasoningEffort,
  penultimateLevel,
  reasoningLevelsFor
} from './chat-reasoning';

/**
 * I vocabolari sono delle FAMIGLIE, non dei tier: Fast e Pro erano solo i nomi che il picker
 * dava a Luna e Grok. Tolti i preset, le scale restano — e si chiedono a chi le possiede.
 */
const LEVELS = {
  luna: modelFamily('luna').thinking,
  grok: modelFamily('grok').thinking,
  'deepseek-pro': modelFamily('deepseek-pro').thinking,
  'gpt-terra': modelFamily('gpt-terra').thinking,
  'gpt-sol': modelFamily('gpt-sol').thinking
} as const;

describe('i vocabolari di ragionamento', () => {
  it('gives each provider its own vocabulary, not a shared one', () => {
    expect(LEVELS.luna).toEqual(['low', 'medium', 'high']);
    expect(LEVELS.grok).toEqual(['low', 'medium', 'high', 'max']);
    // DeepSeek shares Gemini's off switch but not its 'medium': its API has no such effort.
    expect(LEVELS['deepseek-pro']).toEqual(['off', 'low', 'high', 'max']);
    expect(LEVELS['gpt-terra']).toEqual(['off', 'low', 'medium', 'high', 'max']);
    expect(LEVELS['gpt-sol']).toEqual(LEVELS['gpt-terra']);
    expect(isValidForTier('medium', 'deepseek-pro')).toBe(false);
    expect(isValidForTier('max', 'deepseek-pro')).toBe(true);
    // 'none' e' solo un alias legacy di coerceReasoning: isValidForTier vuole il valore reale ('off').
    expect(isValidForTier('none', 'gpt-terra')).toBe(false);
    expect(isValidForTier('max', 'gpt-sol')).toBe(true);
    expect(isValidForTier('off', 'gpt-sol')).toBe(true);
  });

  /**
   * Senza scelta si usa la scala COMUNE a tre gradini: non spegne il thinking e non ha un
   * gradino sopra 'high'. E` la stessa che prende un id del gateway, per lo stesso motivo — di
   * quel modello non conosciamo il vocabolario nativo.
   */
  it('nessuna scelta e un id del gateway condividono la scala comune', () => {
    expect(reasoningLevelsFor(null)).toEqual(['low', 'medium', 'high']);
    expect(reasoningLevelsFor('anthropic/claude-opus-5')).toEqual(['low', 'medium', 'high']);
    expect(isValidForTier('medium', null)).toBe(true);
    expect(isValidForTier('off', null)).toBe(false);
    expect(isValidForTier('max', null)).toBe(false);
    expect(isValidForTier('xhigh', null)).toBe(false);
  });
});

describe('il default di ragionamento', () => {
  it('e` il penultimo gradino della scala di quel modello', () => {
    for (const tier of CHAT_TIERS) {
      expect(defaultReasoningFor(tier)).toBe(penultimateLevel(reasoningLevelsFor(tier as ChatTier)));
    }
    expect(defaultReasoningFor('deepseek-pro')).toBe('high');
    expect(defaultReasoningFor('gpt-terra')).toBe('high');
    expect(defaultReasoningFor('gpt-sol')).toBe('high');
  });

  it('tiene la scala comune a medium', () => {
    expect(defaultReasoningFor(null)).toBe('medium');
    expect(geminiThinkingLevel(defaultReasoningFor(null))).toBe('medium');
  });
});

describe('coerceReasoning', () => {
  it('keeps a level the tier already offers', () => {
    expect(coerceReasoning('medium', null)).toBe('medium');
    expect(coerceReasoning('off', 'gpt-terra')).toBe('off');
  });

  it('maps the ceiling onto the other ceiling across a tier switch', () => {
    expect(coerceReasoning('xhigh', 'deepseek-pro')).toBe('max');
    // La scala comune non ha un gradino sopra 'high': i soffitti altrui ci atterrano sopra.
    expect(coerceReasoning('xhigh', null)).toBe('high');
    expect(coerceReasoning('max', null)).toBe('high');
  });

  it("lands 'off' on the common floor, which has no off switch", () => {
    expect(coerceReasoning('off', null)).toBe('low');
  });

  it('breaks a tie toward the cheaper side', () => {
    // medium (2) sits exactly between low (1) and high (3) on the DeepSeek scale.
    expect(coerceReasoning('medium', 'deepseek-pro')).toBe('low');
  });

  it('falls back to the tier default for junk', () => {
    expect(coerceReasoning('turbo', null)).toBe('medium');
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
    for (const level of LEVELS.grok) {
      const effort = deepseekThinking(level).reasoning_effort;
      expect(effort === undefined || ['low', 'high', 'max'].includes(effort)).toBe(true);
    }
  });
});

describe('geminiThinkingLevel', () => {
  it('never emits a value outside the three levels 3.7 Flash documents', () => {
    const allowed = new Set(['low', 'medium', 'high']);
    for (const levels of Object.values(LEVELS)) {
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
    for (const levels of Object.values(LEVELS)) {
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

/** Il posto che era di Auto adesso e` "nessuna scelta": stessa scala, stesso default. */
describe('nessuna scelta', () => {
  it('usa la scala comune, e parte da medium', () => {
    expect(reasoningLevelsFor(null)).toEqual(LEVELS.luna);
    expect(defaultReasoningFor(null)).toBe('medium');
    expect(coerceReasoning('high', null)).toBe('high');
    expect(coerceReasoning('nonsense', null)).toBe('medium');
    expect(coerceReasoning(undefined, null)).toBe('medium');
  });

  it('sends DeepSeek thinking on when the vision swap borrows that level', () => {
    const t = deepseekThinking(defaultReasoningFor(null));
    expect(t.thinking).toEqual({ type: 'enabled' });
    expect(['low', 'high', 'max']).toContain(t.reasoning_effort);
  });
});

describe('coerceChatTier', () => {
  it('keeps a real tier and answers null for anything else', () => {
    expect(coerceChatTier('deepseek-pro')).toBe('deepseek-pro');
    expect(coerceChatTier('gpt-terra')).toBe('gpt-terra');
    expect(coerceChatTier('gpt-sol')).toBe('gpt-sol');
    expect(coerceChatTier(null)).toBe(null);
    expect(coerceChatTier('gpt-9')).toBe(null);
  });
});


/**
 * Con il catalogo del gateway il tier può essere un id qualunque. Prima erano mappe con sei
 * chiavi, e su un id nuovo restituivano undefined — cioè il picker si schiantava su `.length`
 * alla prima apertura del menu.
 */
describe('un tier che è un id di modello', () => {
  it('ha comunque una scala di ragionamento', () => {
    expect(reasoningLevelsFor('anthropic/claude-opus-5').length).toBeGreaterThan(0);
    expect(defaultReasoningFor('anthropic/claude-opus-5')).toBeTruthy();
  });

  /** Un custom model conserva il suo vocabolario nativo: non e` un id del gateway. */
  it('i custom model restano quelli di prima', () => {
    expect(reasoningLevelsFor('deepseek-pro')).toEqual(LEVELS['deepseek-pro']);
    expect(defaultReasoningFor('deepseek-pro')).toBe('high');
  });
});
