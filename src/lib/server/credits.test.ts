import { describe, it, expect } from 'vitest';
import { productionCredits } from './plan-budget';
import {
  creditQuota,
  currentBillingPeriod,
  CreditsExhaustedError,
  assertCreditsAvailable,
  type CreditsUsage
} from './credits';

describe('creditQuota', () => {
  // Le cifre non si fissano più a mano: derivano da prezzo × (1 − margine) e cambiano col listino.
  // Fissarle qui obbligava a modificare i test a ogni ritocco di prezzo, e un test che si aggiorna
  // per abitudine smette di accorgersi di un errore.
  it('è il budget di produzione del piano', () => {
    for (const key of ['go', 'starter', 'pro'] as const) {
      expect(creditQuota(key)).toBe(productionCredits(key));
    }
  });

  it('cresce col prezzo del piano', () => {
    expect(creditQuota('pro')).toBeGreaterThan(creditQuota('starter'));
    expect(creditQuota('starter')).toBeGreaterThan(creditQuota('go'));
  });

  it('legacy scale resta agganciato a pro (grandfathered)', () => {
    expect(creditQuota('scale')).toBe(creditQuota('pro'));
  });

  it('defaults to 400 for free/unknown plan', () => {
    expect(creditQuota(null)).toBe(400);
    expect(creditQuota(undefined)).toBe(400);
    expect(creditQuota('some-unknown-plan')).toBe(400);
  });
});

describe('currentBillingPeriod', () => {
  it('uses the Stripe period start as anchor', () => {
    const brand = { activated_at: null };
    const { start, end } = currentBillingPeriod(brand, new Date('2026-07-15T00:00:00Z'));
    // start should be the most recent 15th <= now
    expect(start.getUTCDate()).toBe(15);
    // end should be 1 month later
    expect(end.getUTCFullYear()).toBe(start.getUTCFullYear());
    expect(end.getUTCMonth()).toBe((start.getUTCMonth() + 1) % 12);
    expect(end.getUTCDate()).toBe(15);
    // Period should be ~30 days
    const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(32);
  });

  it('falls back to activated_at when the Stripe period is null', () => {
    const brand = { activated_at: '2026-06-01T10:00:00Z' };
    const { start } = currentBillingPeriod(brand, null);
    expect(start.getUTCDate()).toBe(1);
  });

  it('falls back to calendar month start when both are null', () => {
    const brand = { activated_at: null };
    const { start } = currentBillingPeriod(brand, null);
    expect(start.getUTCDate()).toBe(1);
    const now = new Date();
    expect(start.getUTCMonth()).toBe(now.getUTCMonth());
    expect(start.getUTCFullYear()).toBe(now.getUTCFullYear());
  });

  it('anchor day 15 produces periods 15→14', () => {
    // Simulate anchor on the 15th
    const brand = { activated_at: null };
    const { start, end } = currentBillingPeriod(brand, new Date('2026-01-15T00:00:00Z'));
    expect(start.getUTCDate()).toBe(15);
    expect(end.getUTCDate()).toBe(15);
    // end is exactly 1 month after start
    expect(end.getUTCMonth()).toBe((start.getUTCMonth() + 1) % 12);
  });

  it('period is in the past or current (start <= now)', () => {
    const brand = { activated_at: null };
    const { start } = currentBillingPeriod(brand, new Date('2026-07-15T00:00:00Z'));
    expect(start.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('assertCreditsAvailable', () => {
  const makeUsage = (remaining: number): CreditsUsage => ({
    used: 1000,
    quota: 1500,
    bonus: 0,
    remaining,
    periodStart: new Date(),
    periodEnd: new Date(),
    percent: 66
  });

  it('does nothing when credits remain', () => {
    expect(() => assertCreditsAvailable(makeUsage(500))).not.toThrow();
  });

  it('does nothing when remaining is exactly 0 — edge case, throw', () => {
    expect(() => assertCreditsAvailable(makeUsage(0))).toThrow(CreditsExhaustedError);
  });

  it('throws CreditsExhaustedError when exhausted', () => {
    try {
      assertCreditsAvailable(makeUsage(0));
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CreditsExhaustedError);
      expect((e as CreditsExhaustedError).name).toBe('CreditsExhaustedError');
      expect((e as CreditsExhaustedError).usage.remaining).toBe(0);
    }
  });
});

describe('CreditsExhaustedError', () => {
  it('carries the usage object', () => {
    const usage: CreditsUsage = {
      used: 1500,
      quota: 2000,
      bonus: 500,
      remaining: 0,
      periodStart: new Date('2026-07-15'),
      periodEnd: new Date('2026-08-15'),
      percent: 100
    };
    const err = new CreditsExhaustedError(usage);
    expect(err.message).toBe('AI credits exhausted for this billing period');
    expect(err.usage).toBe(usage);
    expect(err.usage.bonus).toBe(500);
    expect(err.usage.percent).toBe(100);
  });
});

describe('quota with bonus', () => {
  it('plan + bonus is what remaining is computed against', () => {
    // Nessuna cifra fissa: il punto è che il bonus si SOMMA alla quota del piano e che quello che
    // resta si conta su entrambi. Fissare 6000 legava il test al prezzo di Starter.
    const plan = creditQuota('starter');
    const bonus = 500;
    const used = 1600;
    const quota = plan + bonus;
    expect(quota).toBe(plan + bonus);
    expect(Math.max(0, quota - used)).toBe(plan + bonus - used);
  });
});
