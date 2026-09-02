import { describe, expect, it, vi } from 'vitest';

const gateCreditsCoreMock = vi.fn(async () => {});
vi.mock('$lib/server/credits', () => ({
	gateCreditsCore: gateCreditsCoreMock,
	creditQuota: (plan: string | null | undefined) => (plan === 'pro' ? 4000 : 400)
}));
vi.mock('$lib/server/plans', () => ({
	postQuota: (plan: string | null | undefined) => (plan === 'pro' ? 90 : 15),
	plansAbove: (plan: string | null | undefined) => (plan === 'pro' ? [] : [{ key: 'pro' }]),
	isTopPlan: (plan: string | null | undefined) => plan === 'pro'
}));

describe('anomaliaBillingProvider', () => {
	it('is kind anomalia', async () => {
		const { anomaliaBillingProvider } = await import('./anomalia-provider');
		expect(anomaliaBillingProvider.kind).toBe('anomalia');
	});

	it('gate("credits", ...) calls the real enforcement, not a no-op', async () => {
		const { anomaliaBillingProvider } = await import('./anomalia-provider');
		await anomaliaBillingProvider.gate('credits', { brandId: 'brand-1' });
		expect(gateCreditsCoreMock).toHaveBeenCalledWith('brand-1');
	});

	it('gate("credits", ...) propagates a denial from gateCreditsCore', async () => {
		gateCreditsCoreMock.mockRejectedValueOnce(new Error('exhausted'));
		const { anomaliaBillingProvider } = await import('./anomalia-provider');
		await expect(anomaliaBillingProvider.gate('credits', { brandId: 'brand-1' })).rejects.toThrow(
			'exhausted'
		);
	});

	it('quota("credits", ...) reads the real per-plan quota', async () => {
		const { anomaliaBillingProvider } = await import('./anomalia-provider');
		await expect(anomaliaBillingProvider.quota('credits', { brandId: 'b', plan: 'pro' })).resolves.toBe(
			4000
		);
		await expect(anomaliaBillingProvider.quota('credits', { brandId: 'b', plan: null })).resolves.toBe(
			400
		);
	});

	it('quota("posts", ...) reads the real per-plan quota', async () => {
		const { anomaliaBillingProvider } = await import('./anomalia-provider');
		await expect(anomaliaBillingProvider.quota('posts', { brandId: 'b', plan: 'pro' })).resolves.toBe(
			90
		);
	});

	it('plansAbove/isTopPlan delegate to the real plan ladder', async () => {
		const { anomaliaBillingProvider } = await import('./anomalia-provider');
		expect(anomaliaBillingProvider.plansAbove('pro')).toEqual([]);
		expect(anomaliaBillingProvider.isTopPlan('pro')).toBe(true);
		expect(anomaliaBillingProvider.isTopPlan(null)).toBe(false);
	});

	it('upgradeUrl points at the brand billing settings when a slug is known', async () => {
		const { anomaliaBillingProvider } = await import('./anomalia-provider');
		expect(anomaliaBillingProvider.upgradeUrl({ brandId: 'b', brandSlug: 'demo' })).toBe(
			'/app/demo/settings/billing'
		);
		expect(anomaliaBillingProvider.upgradeUrl({ brandId: 'b' })).toBeUndefined();
	});
});
