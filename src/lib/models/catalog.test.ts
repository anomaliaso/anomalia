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

  it('defaults Auto and Fast to Luna, Pro to Grok', () => {
    expect(TIER_DEFAULT_FAMILY.auto).toBe('luna');
    expect(TIER_DEFAULT_FAMILY.fast).toBe('luna');
    expect(TIER_DEFAULT_FAMILY.pro).toBe('grok');
    expect(familyForTier('auto').id).toBe('luna');
    expect(familyForTier('auto', 'grok').id).toBe('grok');
    // Fast/Pro ignore agent override — explicit user pick.
    expect(familyForTier('fast', 'grok').id).toBe('luna');
    expect(familyForTier('pro', 'luna').id).toBe('grok');
  });
});
