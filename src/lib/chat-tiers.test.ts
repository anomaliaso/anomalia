import { describe, it, expect } from 'vitest';
import { MODEL_FAMILY_IDS } from '@anomalia/agent-contracts/contracts';
import {
  CHAT_CUSTOM_MODELS,
  CHAT_TIERS,
  coerceChatTier,
  isChatTier,
  isGatewayModelTier,
  isCustomChatModel,
  isGptCustomModel
} from './chat-tiers';

describe('chat tiers', () => {
  it('lists custom models, and nothing else', () => {
    expect(CHAT_CUSTOM_MODELS).toEqual(['deepseek-pro', 'gpt-terra', 'gpt-sol']);
    expect(CHAT_TIERS).toEqual(['deepseek-pro', 'gpt-terra', 'gpt-sol']);
  });

  /**
   * Auto, Fast e Pro non erano modelli: erano alias per LLM_DEFAULT_MODEL e per il SECONDO
   * elemento di LLM_MODELS. Chi li rimettesse qui riporterebbe un menu che non corrisponde a
   * niente che l'operatore possa scegliere.
   */
  it('non riconosce piu\' i preset spariti', () => {
    for (const preset of ['auto', 'fast', 'pro']) {
      expect(isChatTier(preset)).toBe(false);
      expect(coerceChatTier(preset)).toBe(null);
    }
  });

  it('nessuna scelta e\' null, non un preset di riserva', () => {
    expect(coerceChatTier(null)).toBe(null);
    expect(coerceChatTier('')).toBe(null);
    expect(coerceChatTier('anthropic/claude-opus-5')).toBe('anthropic/claude-opus-5');
  });

  it('derives custom ids from the contract vocabulary', () => {
    const contractIds = MODEL_FAMILY_IDS as readonly string[];
    expect(CHAT_CUSTOM_MODELS.every((id) => contractIds.includes(id))).toBe(true);
  });

  it('accepts named custom ids', () => {
    expect(isChatTier('deepseek-pro')).toBe(true);
    expect(isChatTier('gpt-terra')).toBe(true);
    expect(isChatTier('gpt-sol')).toBe(true);
    expect(isCustomChatModel('deepseek-pro')).toBe(true);
    expect(isCustomChatModel('pro')).toBe(false);
    expect(isGptCustomModel('gpt-terra')).toBe(true);
    expect(isGptCustomModel('deepseek-pro')).toBe(false);
  });

  // Il moltiplicatore di crediti nel picker è stato tolto: mentiva al contrario (Grok 4.6 e
  // DeepSeek V4 Pro costano MENO di Gemini Flash, il default Fast). Questo test è la guardia
  // che impedisce di reintrodurlo per abitudine — e agli hint di tornare a chiedere {mult}.
  it('never exports a credit multiplier for the model picker', async () => {
    const mod = (await import('./chat-tiers')) as Record<string, unknown>;
    expect(Object.keys(mod).filter((k) => /MULT|CreditMult/.test(k))).toEqual([]);
    const en = (await import('./i18n/locales/en.json')).default as unknown as {
      chat: { tier: Record<string, string> };
    };
    const tier = en.chat.tier;
    for (const [k, v] of Object.entries(tier)) {
      expect(`${k}:${v}`).not.toContain('{mult}');
    }
  });
});


/**
 * Il picker non offre più tre modelli scritti a mano: offre il catalogo del gateway, e un id come
 * `anthropic/claude-opus-5` è una scelta valida quanto "pro". Chi può dire se ESISTE è il server,
 * che ha il listino; qui si riconosce solo la forma, perché il client non deve indovinare.
 */
describe('un id di modello è un tier', () => {
  it('riconosce la forma vendor/modello', () => {
    expect(isChatTier('anthropic/claude-opus-5')).toBe(true);
    expect(isChatTier('openai/gpt-5.6-sol')).toBe(true);
    expect(isGatewayModelTier('anthropic/claude-opus-5')).toBe(true);
    expect(isGatewayModelTier('pro')).toBe(false);
  });

  it('non scambia per modello una stringa qualunque', () => {
    for (const junk of ['', '/', 'solo-testo', 'a/', '/b', 'a//b', 'spazi nel mezzo/x']) {
      expect(isGatewayModelTier(junk)).toBe(false);
    }
  });

  /**
   * I custom storici restano: ci sono thread che li hanno salvati, e sono famiglie native vere.
   * I preset no — un thread fermo su 'auto' torna al default invece di nominare un modello che
   * nessuno puo` piu` scegliere.
   */
  it('i tre custom storici restano validi', () => {
    for (const t of ['deepseek-pro', 'gpt-terra', 'gpt-sol']) {
      expect(isChatTier(t)).toBe(true);
    }
  });
});
