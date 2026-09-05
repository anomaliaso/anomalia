import { describe, expect, it } from 'vitest';
import { orgBillingForBrand } from './org-billing';

type Row = Record<string, any>;

/**
 * organizations + brands in both rollout shapes: an org that has had its turn carries the
 * billing columns, one that has not still leaves them on its paying brand.
 */
function makeDb(org: Row | null, brands: Row[]) {
	return {
		from: (table: string) => {
			if (table === 'brands') {
				const filters: Record<string, unknown> = {};
				const chain = {
					select: () => chain,
					eq: (k: string, v: unknown) => {
						filters[k] = v;
						return chain;
					},
					maybeSingle: async () => {
						const row = brands.find((b) => Object.entries(filters).every(([k, v]) => b[k] === v));
						return { data: row ? { org_id: row.org_id } : null, error: null };
					}
				};
				return chain;
			}
			if (table === 'organizations') {
				const chain = {
					select: () => chain,
					eq: () => chain,
					maybeSingle: async () => ({
						data: org ? { ...org, brands } : null,
						error: null
					})
				};
				return chain;
			}
			throw new Error(`unexpected table ${table}`);
		}
	};
}

const MIGRATED = {
	id: 'org-1',
	plan: 'pro',
	stripe_customer_id: 'cus_org',
	stripe_subscription_id: 'sub_org'
};

const NOT_MIGRATED = {
	id: 'org-1',
	plan: null,
	stripe_customer_id: null,
	stripe_subscription_id: null
};

const PAYING_BRAND = {
	id: 'b1',
	slug: 'paying',
	org_id: 'org-1',
	plan: 'pro',
	stripe_customer_id: 'cus_brand',
	stripe_subscription_id: 'sub_brand'
};

const FREE_SIBLING = {
	id: 'b2',
	slug: 'free',
	org_id: 'org-1',
	plan: null,
	stripe_customer_id: null,
	stripe_subscription_id: null
};

describe('orgBillingForBrand', () => {
	it('uses the org ids once the org has been migrated', async () => {
		const db = makeDb(MIGRATED, [PAYING_BRAND]);
		const billing = await orgBillingForBrand(db as never, { slug: 'paying' });

		expect(billing).toMatchObject({
			orgId: 'org-1',
			customerId: 'cus_org',
			subscriptionId: 'sub_org',
			plan: 'pro'
		});
	});

	it('falls back to the paying brand while the org waits its turn', async () => {
		const db = makeDb(NOT_MIGRATED, [PAYING_BRAND]);
		const billing = await orgBillingForBrand(db as never, { slug: 'paying' });

		expect(billing).toMatchObject({
			customerId: 'cus_brand',
			subscriptionId: 'sub_brand',
			plan: 'pro'
		});
	});

	it("answers for a free brand with its paying sibling's subscription", async () => {
		const db = makeDb(NOT_MIGRATED, [FREE_SIBLING, PAYING_BRAND]);
		const billing = await orgBillingForBrand(db as never, { slug: 'free' });

		// The naive fallback — the caller's own brand — answers "no billing here" and hides the
		// billing UI from an org that pays.
		expect(billing).toMatchObject({
			customerId: 'cus_brand',
			subscriptionId: 'sub_brand',
			plan: 'pro'
		});
	});

	it('reports no billing when nothing in the org pays', async () => {
		const db = makeDb(NOT_MIGRATED, [FREE_SIBLING]);
		const billing = await orgBillingForBrand(db as never, { slug: 'free' });

		expect(billing).toMatchObject({ customerId: null, subscriptionId: null, plan: null });
	});

	it('counts the org brands, so deleting one of several can spare the subscription', async () => {
		const db = makeDb(MIGRATED, [PAYING_BRAND, FREE_SIBLING]);
		const billing = await orgBillingForBrand(db as never, { slug: 'paying' });

		expect(billing?.brandCount).toBe(2);
	});

	it('is null for a brand that is not there', async () => {
		const db = makeDb(MIGRATED, [PAYING_BRAND]);
		expect(await orgBillingForBrand(db as never, { slug: 'ghost' })).toBeNull();
	});
});
