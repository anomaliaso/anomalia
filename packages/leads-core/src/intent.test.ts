import { describe, it, expect } from 'vitest';
import { normalizeIntent, INTENT_RANK } from './intent';

describe('intent', () => {
  it('normalises anything the model returns to a known band', () => {
    expect(normalizeIntent('seeking_now')).toBe('seeking_now');
    expect(normalizeIntent('SEEKING_NOW')).toBe('seeking_now');
    expect(normalizeIntent('ready to buy')).toBe('none');
    expect(normalizeIntent(undefined)).toBe('none');
  });

  it('ranks someone asking now above someone venting', () => {
    expect(INTENT_RANK.seeking_now).toBeGreaterThan(INTENT_RANK.comparing);
    expect(INTENT_RANK.comparing).toBeGreaterThan(INTENT_RANK.researching);
    expect(INTENT_RANK.researching).toBeGreaterThan(INTENT_RANK.venting);
    expect(INTENT_RANK.venting).toBeGreaterThan(INTENT_RANK.none);
  });
});
