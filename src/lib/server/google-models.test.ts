import { beforeEach, describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { GEMINI_FLASH, geminiFlash, isGeminiFlashId, NANO_BANANA_PRO, isNanoBananaProId, geminiVisualCreditShare } = await import('./google-models');

describe('GEMINI_FLASH', () => {
  it('is a Gemini Flash model id — the default when the env var is unset', () => {
    expect(GEMINI_FLASH).toMatch(/^gemini-\d+(\.\d+)?-flash$/);
  });
});

describe('geminiVisualCreditShare', () => {
  // Flash and Nano Banana Pro are billed at FULL list, like every other model: what the call
  // costs us is what the brand pays. Until 2026-08 this returned a per-plan discount (free 0.75,
  // go 0.35, starter 0.3, pro/scale 0.27), which is why the plans are still enumerated here — if
  // ANY of them ever comes back a fraction, that is a revenue change and this test must catch it.
  // Do not collapse this to a single toBe(1): the plans are the assertion.
  it('bills every plan at 100% of list — no discount, no plan variation', () => {
    for (const plan of [null, undefined, '', 'free', 'go', 'starter', 'pro', 'scale', 'GO', 'unknown']) {
      expect(geminiVisualCreditShare(plan)).toBe(1);
    }
  });
});

describe('Nano Banana Pro id', () => {
  it('matches Pro stills, not Nano Banana 2', () => {
    expect(isNanoBananaProId(NANO_BANANA_PRO)).toBe(true);
    expect(isNanoBananaProId('gemini-3.1-flash-image')).toBe(false);
  });
});

describe('isGeminiFlashId', () => {
  it('accepts text/vision Flash ids, including future minor bumps', () => {
    expect(isGeminiFlashId(GEMINI_FLASH)).toBe(true);
    expect(isGeminiFlashId('gemini-3.8-flash')).toBe(true);
    expect(isGeminiFlashId('gemini-3-flash')).toBe(true);
    expect(isGeminiFlashId('gemini-3.6-flash')).toBe(true);
  });

  it('rejects image models, junk, and empty values', () => {
    expect(isGeminiFlashId('gemini-3.1-flash-image')).toBe(false);
    expect(isGeminiFlashId('gemini-3-pro-image-preview')).toBe(false);
    expect(isGeminiFlashId('not-a-model')).toBe(false);
    expect(isGeminiFlashId('')).toBe(false);
    expect(isGeminiFlashId(undefined)).toBe(false);
  });
});

describe('geminiFlash', () => {
  beforeEach(() => {
    delete env.GEMINI_FLASH;
  });

  it('returns the default when GEMINI_FLASH is unset', () => {
    expect(geminiFlash()).toBe(GEMINI_FLASH);
  });

  it('reads a valid override at call time — flipping the env var needs no rebuild', () => {
    env.GEMINI_FLASH = 'gemini-3.8-flash';
    expect(geminiFlash()).toBe('gemini-3.8-flash');
    env.GEMINI_FLASH = GEMINI_FLASH;
    expect(geminiFlash()).toBe(GEMINI_FLASH);
  });

  it('trims whitespace on a valid id', () => {
    env.GEMINI_FLASH = '  gemini-3.8-flash  ';
    expect(geminiFlash()).toBe('gemini-3.8-flash');
  });

  it('falls back to the default for image models, junk, and empty strings', () => {
    for (const v of ['gemini-3.1-flash-image', 'gemini-3-pro-image-preview', 'not-a-model', '']) {
      env.GEMINI_FLASH = v;
      expect(geminiFlash()).toBe(GEMINI_FLASH);
    }
  });
});
