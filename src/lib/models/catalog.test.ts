import { describe, expect, it } from 'vitest';
import { MODEL_FAMILY_IDS } from '@anomalia/agent-contracts/contracts';
import {
  coerceThinking,
  familyForTier,
  GROK,
  LUNA,
  MODEL_FAMILIES,
  nativeThinking,
  TIER_DEFAULT_FAMILY
} from './catalog';

describe('model catalog', () => {
  it('keeps catalog families in sync with the contract vocabulary', () => {
    expect(Object.keys(MODEL_FAMILIES)).toEqual(MODEL_FAMILY_IDS);
  });

  it('lists every family with a common thinking scale and a native map', () => {
    for (const f of Object.values(MODEL_FAMILIES)) {
      expect(f.thinking.length).toBeGreaterThan(0);
      expect(f.thinking).toContain(f.defaultThinking);
      for (const level of f.thinking) {
        expect(nativeThinking(level, f)).toBeTruthy();
      }
    }
  });

  it('maps common max → xhigh on Grok and keeps Luna on low|medium|high', () => {
    expect(nativeThinking('max', GROK)).toBe('xhigh');
    expect(nativeThinking('high', GROK)).toBe('high');
    expect(nativeThinking('off', LUNA)).toBe('low');
    expect(nativeThinking('max', LUNA)).toBe('high');
    expect(nativeThinking('medium', LUNA)).toBe('medium');
  });

  it('accepts legacy none/xhigh aliases into the common scale', () => {
    expect(coerceThinking('none', LUNA)).toBe('low');
    expect(coerceThinking('xhigh', GROK)).toBe('max');
    expect(coerceThinking('nonsense', LUNA)).toBe(LUNA.defaultThinking);
  });

  /**
   * La famiglia serve SOLO a dire quali gradini di ragionamento mostrare. Un custom model ha un
   * vocabolario nativo suo; tutto il resto — un id del gateway, o nessuna scelta — usa la scala
   * comune a tre gradini, invece di inventarsi un vocabolario che non conosciamo.
   */
  it('tiene una famiglia solo per i custom model', () => {
    expect(TIER_DEFAULT_FAMILY['deepseek-pro']).toBe('deepseek-pro');
    expect(familyForTier('deepseek-pro').id).toBe('deepseek-pro');
  });

  it('un id del gateway e nessuna scelta prendono la scala comune', () => {
    expect(familyForTier('anthropic/claude-opus-5').id).toBe('luna');
    expect(familyForTier(null).id).toBe('luna');
  });

  /** I preset non hanno piu` una famiglia: se ne riavessero una, sarebbero tornati. */
  it('non conosce piu\' auto, fast e pro', () => {
    for (const preset of ['auto', 'fast', 'pro']) {
      expect(TIER_DEFAULT_FAMILY[preset]).toBeUndefined();
    }
  });
});
