import { describe, expect, it, vi } from 'vitest';
import type { BillingProvider } from '$lib/billing/contract';

// gateCredits() (the chokepoint 29 call sites use) now delegates to billingProvider().gate().
// Mocking '$lib/server/billing' directly — gateCredits's one dependency — proves the delegation
// itself cleanly: a fake provider that denies makes gateCredits throw, a fake provider that
// allows makes it resolve, with no Supabase involved. (anomalia-provider.test.ts separately
// proves the real anomalia provider's gate('credits', ...) still calls the real,
// unrewritten gateCreditsCore.)

const mockProvider: { current: BillingProvider | null } = { current: null };
vi.mock('./billing', () => ({
  billingProvider: async () => mockProvider.current
}));

function fakeProvider(kind: 'open' | 'anomalia', gate: BillingProvider['gate']): BillingProvider {
  return {
    kind,
    gate,
    quota: async () => Infinity,
    upgradeUrl: () => undefined,
    plansAbove: () => [],
    isTopPlan: () => true
  };
}

describe('gateCredits() delegation', () => {
  it('propagates a denial thrown by the provider (mirrors anomalia when the ledger is exhausted)', async () => {
    const { CreditsExhaustedError } = await import('$lib/server/credits');
    mockProvider.current = fakeProvider('anomalia', async () => {
      throw new CreditsExhaustedError({
        used: 400,
        quota: 400,
        bonus: 0,
        remaining: 0,
        periodStart: new Date(),
        periodEnd: new Date(),
        percent: 100
      });
    });
    const { gateCredits } = await import('$lib/server/credits');
    await expect(gateCredits('brand-1')).rejects.toBeInstanceOf(CreditsExhaustedError);
  });

  it('resolves when the provider allows (the open-provider mutation this lotto makes)', async () => {
    const gateFn = vi.fn(async () => {});
    mockProvider.current = fakeProvider('open', gateFn);
    const { gateCredits } = await import('$lib/server/credits');
    await expect(gateCredits('brand-1')).resolves.toBeUndefined();
    expect(gateFn).toHaveBeenCalledWith('credits', { brandId: 'brand-1' });
  });
});
