import { describe, it, expect } from 'vitest';
import { onboardingGateDecision, DAILY_ONBOARDING_GEN_LIMIT } from './brand-limits';
import { vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: { UNLIMITED_SLOT_EMAILS: 'founder@example.com' } }));

describe('onboardingGateDecision (pre-payment generation gate)', () => {
  it('blocks an unverified email', () => {
    expect(onboardingGateDecision({ email: 'x@y.com', emailConfirmedAt: null, generationsToday: 0 }))
      .toEqual({ ok: false, reason: 'email_unverified' });
  });

  it('allows a verified email under the daily cap', () => {
    expect(onboardingGateDecision({ email: 'x@y.com', emailConfirmedAt: '2026-07-15T00:00:00Z', generationsToday: DAILY_ONBOARDING_GEN_LIMIT - 1 }))
      .toEqual({ ok: true });
  });

  it('blocks at the daily cap', () => {
    expect(onboardingGateDecision({ email: 'x@y.com', emailConfirmedAt: '2026-07-15T00:00:00Z', generationsToday: DAILY_ONBOARDING_GEN_LIMIT }))
      .toEqual({ ok: false, reason: 'daily_limit' });
  });

  it('exempt (founder) accounts bypass both checks — unverified and over cap', () => {
    expect(onboardingGateDecision({ email: 'founder@example.com', emailConfirmedAt: null, generationsToday: 999 }))
      .toEqual({ ok: true });
  });
});
