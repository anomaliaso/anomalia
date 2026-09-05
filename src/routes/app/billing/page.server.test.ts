import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The account-level billing page answers for the ORGANIZATION: one pool, one plan, and a
 * per-brand table that says who is eating it. The cases that carry the design are the ones a
 * naive per-brand page gets wrong — a free brand of a paying org must still show the paid
 * plan, and the breakdown must cover every brand of the org, not just the one in the URL.
 */

const getCreditsUsage = vi.fn();
const ensureOrgForUser = vi.fn();
const billingPortal = vi.fn();

vi.mock('$lib/server/credits', () => ({
	getCreditsUsage: (...a: unknown[]) => getCreditsUsage(...a)
}));
vi.mock('$lib/server/org', () => ({
	ensureOrgForUser: (...a: unknown[]) => ensureOrgForUser(...a)
}));
vi.mock('$lib/server/settings-actions', () => ({
	billingPortal: (...a: unknown[]) => billingPortal(...a),
	upgrade: vi.fn(),
	applyRetention: vi.fn(),
	cancelPlan: vi.fn()
}));

import { load, actions } from './+page.server';

const PERIOD = {
	used: 400,
	quota: 4000,
	bonus: 0,
	remaining: 3600,
	percent: 10,
	periodStart: new Date('2026-09-01T00:00:00Z'),
	periodEnd: new Date('2026-10-01T00:00:00Z')
};

type Org = Record<string, unknown>;

/** organizations + brands, plus the per-brand spend the page asks for one brand at a time. */
function fakeSupabase(org: Org | null, spendByBrand: Record<string, number> = {}) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client: any = {
		auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'ana@example.com' } } }) },
		from: () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const q: any = {
				select: () => q,
				eq: () => q,
				async maybeSingle() {
					return { data: org, error: null };
				}
			};
			return q;
		},
		rpc: async (_fn: string, args: { p_brand_id: string }) => ({
			data: (spendByBrand[args.p_brand_id] ?? 0) / 100,
			error: null
		})
	};
	return client;
}

function run(supabase: unknown) {
	return (load as (e: unknown) => Promise<Record<string, any>>)({
		locals: { supabase },
		url: new URL('https://example.test/app/billing')
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	getCreditsUsage.mockResolvedValue(PERIOD);
	ensureOrgForUser.mockResolvedValue('org-1');
});

describe('/app/billing', () => {
	it('shows the org pool once, not a sum of per-brand quotas', async () => {
		const data = await run(
			fakeSupabase({
				id: 'org-1',
				name: 'Ana',
				owner_id: 'u1',
				plan: 'pro',
				stripe_customer_id: 'cus_1',
				brands: [
					{ id: 'b1', name: 'One', slug: 'one', plan: 'pro', stripe_customer_id: 'cus_1' },
					{ id: 'b2', name: 'Two', slug: 'two', plan: null, stripe_customer_id: null }
				]
			})
		);

		expect(getCreditsUsage).toHaveBeenCalledTimes(1);
		expect(data.credits.quota).toBe(4000);
		expect(data.org.plan).toBe('pro');
	});

	it('breaks usage down over every brand of the org', async () => {
		const data = await run(
			fakeSupabase(
				{
					id: 'org-1',
					name: 'Ana',
					owner_id: 'u1',
					plan: 'pro',
					stripe_customer_id: 'cus_1',
					brands: [
						{ id: 'b1', name: 'One', slug: 'one', plan: 'pro', stripe_customer_id: 'cus_1' },
						{ id: 'b2', name: 'Two', slug: 'two', plan: null, stripe_customer_id: null }
					]
				},
				{ b1: 300, b2: 100 }
			)
		);

		expect(data.brands).toEqual([
			{ id: 'b1', name: 'One', slug: 'one', credits: 300 },
			{ id: 'b2', name: 'Two', slug: 'two', credits: 100 }
		]);
	});

	it('counts the org as billable when only a sibling brand carries the customer', async () => {
		// The org row has no customer yet (not migrated); its paying brand does. A page that
		// looked at the org alone would offer "choose a plan" to someone already paying.
		const data = await run(
			fakeSupabase({
				id: 'org-1',
				name: 'Ana',
				owner_id: 'u1',
				plan: null,
				stripe_customer_id: null,
				brands: [
					{ id: 'b1', name: 'One', slug: 'one', plan: 'pro', stripe_customer_id: 'cus_1' },
					{ id: 'b2', name: 'Two', slug: 'two', plan: null, stripe_customer_id: null }
				]
			})
		);

		expect(data.hasBilling).toBe(true);
		expect(data.billingBrandSlug).toBe('one');
	});

	it('runs a billing action against the org brand that carries the subscription', async () => {
		// The action itself is the brand one, unchanged — it just has to be handed the right slug,
		// not whichever brand happens to come first.
		const supabase = fakeSupabase({
			id: 'org-1',
			name: 'Ana',
			owner_id: 'u1',
			plan: null,
			stripe_customer_id: null,
			brands: [
				{ id: 'b2', name: 'Two', slug: 'two', plan: null, stripe_subscription_id: null },
				{ id: 'b1', name: 'One', slug: 'one', plan: 'pro', stripe_subscription_id: 'sub_1' }
			]
		});

		await (actions.billingPortal as (e: unknown) => Promise<unknown>)({
			locals: { supabase },
			params: {}
		});

		expect(billingPortal).toHaveBeenCalledTimes(1);
		expect(billingPortal.mock.calls[0][0].params).toEqual({ brand: 'one' });
	});

	it('has no billing brand to act through when the org has no brands', async () => {
		const data = await run(
			fakeSupabase({
				id: 'org-1',
				name: 'Ana',
				owner_id: 'u1',
				plan: null,
				stripe_customer_id: null,
				brands: []
			})
		);

		expect(data.brands).toEqual([]);
		expect(data.billingBrandSlug).toBeNull();
		expect(getCreditsUsage).not.toHaveBeenCalled();
	});
});
