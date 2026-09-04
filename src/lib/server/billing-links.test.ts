import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgBillingForBrand = vi.fn();
const createBillingPortalSession = vi.fn();
const applyRetentionCoupon = vi.fn();
const cancelSubscriptionAtPeriodEnd = vi.fn();

vi.mock('$lib/server/org-billing', () => ({
	orgBillingForBrand: (...args: unknown[]) => orgBillingForBrand(...args)
}));
vi.mock('$lib/server/stripe', () => ({
	createBillingPortalSession: (...args: unknown[]) => createBillingPortalSession(...args),
	applyRetentionCoupon: (...args: unknown[]) => applyRetentionCoupon(...args),
	cancelSubscriptionAtPeriodEnd: (...args: unknown[]) => cancelSubscriptionAtPeriodEnd(...args)
}));

import { billingLink } from './billing-links';

const PAYING_ORG = {
	orgId: 'org-1',
	customerId: 'cus_1',
	subscriptionId: 'sub_1',
	plan: 'starter',
	brandCount: 2
};

const RETURN_URL = 'https://anomalia.test/app/billing';

beforeEach(() => {
	vi.clearAllMocks();
	orgBillingForBrand.mockResolvedValue(PAYING_ORG);
	createBillingPortalSession.mockResolvedValue('https://billing.stripe.com/session/xyz');
});

describe('billingLink', () => {
	it('hands back the portal url for the customer the ORG bills through', async () => {
		const link = await billingLink({} as never, { slug: 'demo', returnUrl: RETURN_URL });

		expect(link).toEqual({ url: 'https://billing.stripe.com/session/xyz' });
		expect(createBillingPortalSession).toHaveBeenCalledWith({
			customerId: 'cus_1',
			returnUrl: RETURN_URL,
			flow: undefined,
			subscriptionId: 'sub_1'
		});
	});

	it('asks for the subscription_update flow when the caller wants to change plan', async () => {
		await billingLink({} as never, { slug: 'demo', returnUrl: RETURN_URL, flow: 'upgrade' });

		expect(createBillingPortalSession).toHaveBeenCalledWith({
			customerId: 'cus_1',
			returnUrl: RETURN_URL,
			flow: 'upgrade',
			subscriptionId: 'sub_1'
		});
	});

	it('refuses no_org_billing when the brand bills through no org', async () => {
		orgBillingForBrand.mockResolvedValue(null);

		const link = await billingLink({} as never, { slug: 'ghost', returnUrl: RETURN_URL });

		expect(link).toEqual({ refusal: 'no_org_billing', message: '' });
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('refuses no_customer before calling Stripe about a customer that does not exist', async () => {
		orgBillingForBrand.mockResolvedValue({ ...PAYING_ORG, customerId: null, subscriptionId: null });

		const link = await billingLink({} as never, { slug: 'demo', returnUrl: RETURN_URL });

		expect(link).toEqual({ refusal: 'no_customer', message: '' });
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('refuses no_subscription when an upgrade has nothing to update', async () => {
		orgBillingForBrand.mockResolvedValue({ ...PAYING_ORG, subscriptionId: null });

		const link = await billingLink({} as never, {
			slug: 'demo',
			returnUrl: RETURN_URL,
			flow: 'upgrade'
		});

		expect(link).toEqual({ refusal: 'no_subscription', message: '' });
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('turns a Stripe failure into stripe_unavailable, keeping what Stripe said', async () => {
		createBillingPortalSession.mockRejectedValue(new Error('connection error'));

		const link = await billingLink({} as never, { slug: 'demo', returnUrl: RETURN_URL });

		expect(link).toEqual({ refusal: 'stripe_unavailable', message: 'connection error' });
	});

	it('leaves a Stripe throw that is not an Error without a message to repeat', async () => {
		createBillingPortalSession.mockRejectedValue('boom');

		const link = await billingLink({} as never, { slug: 'demo', returnUrl: RETURN_URL });

		expect(link).toEqual({ refusal: 'stripe_unavailable', message: '' });
	});

	it('never cancels, never discounts, never edits the subscription', async () => {
		await billingLink({} as never, { slug: 'demo', returnUrl: RETURN_URL, flow: 'upgrade' });

		expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
		expect(applyRetentionCoupon).not.toHaveBeenCalled();
	});
});
