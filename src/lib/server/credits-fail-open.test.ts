import { beforeEach, describe, expect, it, vi } from 'vitest';

// gateCreditsCore allows the action when it cannot evaluate the ledger — deliberate, and right:
// a transient Supabase error must not block a paying customer. What it must NOT do is stay quiet
// about it, which is how a week of ungated AI went unnoticed.

const swallowed: { reason: string; err: unknown }[] = [];
vi.mock('$lib/server/swallow', () => ({
	swallow: (reason: string, err?: unknown) => {
		swallowed.push({ reason, err });
	}
}));

vi.mock('./ai-log', () => ({ isCreditExempt: () => false }));

beforeEach(() => {
	swallowed.length = 0;
	vi.resetModules();
});

describe('gateCreditsCore fail-open', () => {
	it('still allows the action when the ledger cannot be read', async () => {
		vi.doMock('./supabase-admin', () => ({
			createAdminClient: () => {
				throw new Error('supabase unreachable');
			}
		}));

		const { gateCreditsCore } = await import('./credits');
		await expect(gateCreditsCore('brand-1')).resolves.toBeUndefined();
	});

	it('reports the brand it could not evaluate instead of failing open in silence', async () => {
		vi.doMock('./supabase-admin', () => ({
			createAdminClient: () => {
				throw new Error('supabase unreachable');
			}
		}));

		const { gateCreditsCore } = await import('./credits');
		await gateCreditsCore('brand-1');

		expect(swallowed).toHaveLength(1);
		expect(swallowed[0].reason).toContain('brand-1');
	});

	// The org lookup and the ledger read are two separate fail-open catches since the pool moved to
	// the org. Both give up on the same question, so both have to say so — this pins the second:
	// the org lookup is let through (no org_id, so it resolves to null), the ledger read then throws.
	it('reports when the ledger read fails after the org lookup got through', async () => {
		let brandReads = 0;
		vi.doMock('./supabase-admin', () => ({
			createAdminClient: () => ({
				from: () => ({
					select: () => ({
						eq: () => ({
							maybeSingle: async () => {
								brandReads++;
								if (brandReads === 1) return { data: null, error: null };
								throw new Error('ledger unreachable');
							}
						})
					})
				})
			})
		}));

		const { gateCreditsCore } = await import('./credits');
		await expect(gateCreditsCore('brand-2')).resolves.toBeUndefined();

		expect(brandReads).toBeGreaterThan(1);
		expect(swallowed).toHaveLength(1);
		expect(swallowed[0].reason).toContain('brand-2');
	});
});
