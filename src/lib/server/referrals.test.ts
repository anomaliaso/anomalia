import { describe, expect, it } from 'vitest';
import { isValidReferralCode, REFERRAL_CREDITS_EACH } from './referrals';

describe('referrals', () => {
  it('accepts lowercase alphanumeric codes of length 6–12', () => {
    expect(isValidReferralCode('abc123')).toBe(true);
    expect(isValidReferralCode('abcdefgh')).toBe(true);
    expect(isValidReferralCode('a1b2c3d4e5f6')).toBe(true);
  });

  it('rejects invalid codes', () => {
    expect(isValidReferralCode('')).toBe(false);
    expect(isValidReferralCode(null)).toBe(false);
    expect(isValidReferralCode('short')).toBe(false);
    expect(isValidReferralCode('THIS_IS_BAD')).toBe(false);
    expect(isValidReferralCode('has space')).toBe(false);
    expect(isValidReferralCode('toolongcode12x')).toBe(false);
  });

  it('accepts mixed case then lowercases at capture', () => {
    expect(isValidReferralCode('AbCdEfGh')).toBe(true);
  });

  it('gifts a meaningful credit amount', () => {
    expect(REFERRAL_CREDITS_EACH).toBeGreaterThanOrEqual(200);
  });
});
