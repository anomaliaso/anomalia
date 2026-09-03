import { beforeEach, describe, expect, it, vi } from 'vitest';

// The fallback to the permissive provider is the shape of the incident that left AI ungated in
// production for a week: it is correct behaviour for a self-hosted fork, and a revenue defect
// everywhere else. These tests pin WHICH of the two it reports.

const swallowed: string[] = [];
vi.mock('$lib/server/swallow', () => ({
	swallow: (reason: string) => {
		swallowed.push(reason);
	}
}));

beforeEach(() => {
	swallowed.length = 0;
	vi.resetModules();
});

describe('billingProvider() fallback reporting', () => {
	it('reports when the paid provider throws on load', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('./anomalia-provider', () => {
			throw new Error('not available in the open build');
		});

		const { billingProvider } = await import('./index');
		const provider = await billingProvider();

		expect(provider.kind).toBe('open');
		expect(swallowed).toHaveLength(1);
		expect(swallowed[0]).toMatch(/billing/i);
	});

	it('reports when the paid provider loads but exports nothing', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('./anomalia-provider', () => ({ anomaliaBillingProvider: undefined }));

		const { billingProvider } = await import('./index');
		const provider = await billingProvider();

		expect(provider.kind).toBe('open');
		expect(swallowed).toHaveLength(1);
	});

	it('stays silent when BILLING_PROVIDER=open asked for it', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: { BILLING_PROVIDER: 'open' } }));
		vi.doMock('./anomalia-provider', () => {
			throw new Error('not available in the open build');
		});

		const { billingProvider } = await import('./index');
		const provider = await billingProvider();

		expect(provider.kind).toBe('open');
		expect(swallowed).toEqual([]);
	});

	it('stays silent when the paid provider is there', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('./anomalia-provider', () => ({
			anomaliaBillingProvider: { kind: 'anomalia', gate: async () => {} }
		}));

		const { billingProvider } = await import('./index');
		const provider = await billingProvider();

		expect(provider.kind).toBe('anomalia');
		expect(swallowed).toEqual([]);
	});

	it('reports once, not on all 29 gate call sites', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('./anomalia-provider', () => {
			throw new Error('not available in the open build');
		});

		const { billingProvider } = await import('./index');
		await billingProvider();
		await billingProvider();
		await billingProvider();

		expect(swallowed).toHaveLength(1);
	});
});
