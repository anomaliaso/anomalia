import { describe, it, expect } from 'vitest';
import { MODEL_FAMILY_IDS } from '@anomalia/agent-contracts/contracts';
import {
  CHAT_CUSTOM_MODELS,
  CHAT_PRESET_TIERS,
  CHAT_TIERS,
  isChatTier,
  isGatewayModelTier,
  isCustomChatModel,
  isGptCustomModel
} from './chat-tiers';

describe('chat tiers', () => {
  it('lists presets then custom models', () => {
    expect(CHAT_PRESET_TIERS).toEqual(['auto', 'fast', 'pro']);
    expect(CHAT_CUSTOM_MODELS).toEqual(['deepseek-pro', 'gpt-terra', 'gpt-sol']);
    expect(CHAT_TIERS).toEqual(['auto', 'fast', 'pro', 'deepseek-pro', 'gpt-terra', 'gpt-sol']);
  });

  it('derives custom ids from the contract vocabulary', () => {
    const contractIds = MODEL_FAMILY_IDS as readonly string[];
    expect(CHAT_CUSTOM_MODELS.every((id) => contractIds.includes(id))).toBe(true);
    expect(CHAT_TIERS.filter((t) => !(CHAT_PRESET_TIERS as string[]).includes(t))).toEqual([
      ...CHAT_CUSTOM_MODELS
    ]);
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

  it('i preset e i tre custom storici restano validi: ci sono thread che li hanno salvati', () => {
    for (const t of ['auto', 'fast', 'pro', 'deepseek-pro', 'gpt-terra', 'gpt-sol']) {
      expect(isChatTier(t)).toBe(true);
    }
  });
});
