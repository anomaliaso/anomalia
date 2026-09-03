import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const billingPortalSessionsCreate = vi.fn();
const subscriptionsRetrieve = vi.fn();
const subscriptionsUpdate = vi.fn();
const subscriptionsCancel = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: {
		STRIPE_SECRET_KEY: 'sk_test_123',
		STRIPE_PRICE_GO: 'price_go',
		STRIPE_PRICE_STARTER: 'price_starter',
		STRIPE_PRICE_PRO: 'price_pro'
	}
}));

vi.mock('stripe', () => ({
	default: class MockStripe {
		billingPortal = { sessions: { create: billingPortalSessionsCreate } };
		subscriptions = {
			retrieve: subscriptionsRetrieve,
			update: subscriptionsUpdate,
			cancel: subscriptionsCancel
		};
	}
}));

beforeEach(() => {
	vi.resetModules();
	billingPortalSessionsCreate.mockReset();
	subscriptionsRetrieve.mockReset();
	subscriptionsUpdate.mockReset();
	subscriptionsCancel.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('createBillingPortalSession', () => {
	it('opens the portal home when no flow is requested', async () => {
		billingPortalSessionsCreate.mockResolvedValue({ url: 'https://portal/home' });
		const { createBillingPortalSession } = await import('./stripe');

		const url = await createBillingPortalSession({
			customerId: 'cus_1',
			returnUrl: 'https://app/return',
			flow: undefined,
			subscriptionId: 'sub_1'
		});

		expect(url).toBe('https://portal/home');
		expect(billingPortalSessionsCreate).toHaveBeenCalledWith({
			customer: 'cus_1',
			return_url: 'https://app/return'
		});
	});

	it('requests the payment_method_update flow', async () => {
		billingPortalSessionsCreate.mockResolvedValue({ url: 'https://portal/pm' });
		const { createBillingPortalSession } = await import('./stripe');

		await createBillingPortalSession({
			customerId: 'cus_1',
			returnUrl: 'https://app/return',
			flow: 'payment_method',
			subscriptionId: 'sub_1'
		});

		expect(billingPortalSessionsCreate).toHaveBeenCalledWith({
			customer: 'cus_1',
			return_url: 'https://app/return',
			flow_data: { type: 'payment_method_update' }
		});
	});

	it('requests the generic subscription_update flow', async () => {
		billingPortalSessionsCreate.mockResolvedValue({ url: 'https://portal/upgrade' });
		const { createBillingPortalSession } = await import('./stripe');

		await createBillingPortalSession({
			customerId: 'cus_1',
			returnUrl: 'https://app/return',
			flow: 'upgrade',
			subscriptionId: 'sub_1'
		});

		expect(billingPortalSessionsCreate).toHaveBeenCalledWith({
			customer: 'cus_1',
			return_url: 'https://app/return',
			flow_data: { type: 'subscription_update', subscription_update: { subscription: 'sub_1' } }
		});
	});
});

describe('createUpgradePortalSession', () => {
	it('looks up the subscription item and confirms the new price', async () => {
		subscriptionsRetrieve.mockResolvedValue({
			items: { data: [{ id: 'si_1', quantity: 1 }] }
		});
		billingPortalSessionsCreate.mockResolvedValue({ url: 'https://portal/confirm' });
		const { createUpgradePortalSession } = await import('./stripe');

		const url = await createUpgradePortalSession({
			customerId: 'cus_1',
			subscriptionId: 'sub_1',
			plan: 'pro',
			returnUrl: 'https://app/return'
		});

		expect(url).toBe('https://portal/confirm');
		expect(subscriptionsRetrieve).toHaveBeenCalledWith('sub_1');
		expect(billingPortalSessionsCreate).toHaveBeenCalledWith({
			customer: 'cus_1',
			return_url: 'https://app/return',
			flow_data: {
				type: 'subscription_update_confirm',
				subscription_update_confirm: {
					subscription: 'sub_1',
					items: [{ id: 'si_1', price: 'price_pro', quantity: 1 }]
				}
			}
		});
	});

	it('rejects a plan with no configured Stripe price', async () => {
		const { createUpgradePortalSession } = await import('./stripe');

		await expect(
			createUpgradePortalSession({
				customerId: 'cus_1',
				subscriptionId: 'sub_1',
				plan: 'nonexistent',
				returnUrl: 'https://app/return'
			})
		).rejects.toThrow('No Stripe price configured for plan "nonexistent"');
	});
});

describe('applyRetentionCoupon', () => {
	it('applies the coupon to the subscription', async () => {
		const { applyRetentionCoupon } = await import('./stripe');
		await applyRetentionCoupon('sub_1', 'SAVE20');
		expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_1', { coupon: 'SAVE20' });
	});
});

describe('cancelSubscriptionAtPeriodEnd', () => {
	it('schedules the cancellation and returns the end date', async () => {
		subscriptionsUpdate.mockResolvedValue({ cancel_at: 1735689600 });
		const { cancelSubscriptionAtPeriodEnd } = await import('./stripe');

		const { endsAt } = await cancelSubscriptionAtPeriodEnd('sub_1', {
			feedback: 'too_expensive',
			comment: 'pricey'
		});

		expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
			cancel_at_period_end: true,
			cancellation_details: { feedback: 'too_expensive', comment: 'pricey' }
		});
		expect(endsAt).toBe(new Date(1735689600 * 1000).toISOString());
	});

	it('returns null when Stripe reports no cancel_at date', async () => {
		subscriptionsUpdate.mockResolvedValue({ cancel_at: null });
		const { cancelSubscriptionAtPeriodEnd } = await import('./stripe');

		const { endsAt } = await cancelSubscriptionAtPeriodEnd('sub_1', {});
		expect(endsAt).toBeNull();
	});
});

describe('ensureSubscriptionCanceled', () => {
	it('resolves silently when the subscription is already canceled', async () => {
		subscriptionsRetrieve.mockResolvedValue({ status: 'canceled' });
		const { ensureSubscriptionCanceled } = await import('./stripe');
		await expect(ensureSubscriptionCanceled('sub_1')).resolves.toBeUndefined();
	});

	it('throws active_plan when the subscription is still active', async () => {
		subscriptionsRetrieve.mockResolvedValue({ status: 'active' });
		const { ensureSubscriptionCanceled } = await import('./stripe');
		await expect(ensureSubscriptionCanceled('sub_1')).rejects.toThrow('active_plan');
	});
});
