import { describe, expect, it } from 'vitest';
import { openBillingProvider } from './open-provider';

describe('openBillingProvider — self-hosted default', () => {
  it('kind is "open"', () => {
    expect(openBillingProvider.kind).toBe('open');
  });

  it('gate() never throws, for any kind', async () => {
    await expect(openBillingProvider.gate('credits', { brandId: 'b1' })).resolves.toBeUndefined();
    await expect(openBillingProvider.gate('posts', { brandId: 'b1' })).resolves.toBeUndefined();
  });

  it('quota() is unlimited', async () => {
    expect(await openBillingProvider.quota('credits', { brandId: 'b1' })).toBe(Infinity);
    expect(await openBillingProvider.quota('posts', { brandId: 'b1' })).toBe(Infinity);
  });

  it('upgradeUrl() is undefined — nothing to sell', () => {
    expect(openBillingProvider.upgradeUrl({ brandId: 'b1' })).toBeUndefined();
  });

  it('plansAbove() is empty and isTopPlan() is true', () => {
    expect(openBillingProvider.plansAbove('pro')).toEqual([]);
    expect(openBillingProvider.isTopPlan(null)).toBe(true);
  });
});
