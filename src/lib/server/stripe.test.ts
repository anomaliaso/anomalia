import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const billingPortalSessionsCreate = vi.fn();
const subscriptionsRetrieve = vi.fn();
const subscriptionsUpdate = vi.fn();
const subscriptionsCancel = vi.fn();

vi.mock('$env/dynamic/private', () => ({
	env: { STRIPE_SECRET_KEY: 'sk_test_123' }
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

	it('sends an upgrade to the portal to pick the plan, naming no price', async () => {
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
		expect(subscriptionsRetrieve).not.toHaveBeenCalled();
	});
});

describe('applyRetentionCoupon', () => {
	it('applies the coupon to the subscription', async () => {
		const { applyRetentionCoupon } = await import('./stripe');
		await applyRetentionCoupon('sub_1', 'SAVE20');
		// `coupon` was removed from subscription updates in the API version this SDK pins
		// (2026-08-26.dahlia); sending it back would be a 400 "unknown parameter".
		expect(subscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
			discounts: [{ coupon: 'SAVE20' }]
		});
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

	// The owner used "cancel plan", was told it was cancelled, and Stripe keeps the status
	// `active` until the period runs out. Refusing here left them unable to delete their own
	// brand for up to a month.
	it('lets the delete through once cancellation is scheduled', async () => {
		subscriptionsRetrieve.mockResolvedValue({ status: 'active', cancel_at_period_end: true });
		const { ensureSubscriptionCanceled } = await import('./stripe');
		await expect(ensureSubscriptionCanceled('sub_1')).resolves.toBeUndefined();
	});

	it.each(['incomplete_expired', 'unpaid'])(
		'lets the delete through on the settled status %s',
		async (status) => {
			subscriptionsRetrieve.mockResolvedValue({ status });
			const { ensureSubscriptionCanceled } = await import('./stripe');
			await expect(ensureSubscriptionCanceled('sub_1')).resolves.toBeUndefined();
		}
	);

	// A stale id bills nobody. Refusing on it made the brand undeletable forever.
	it('lets the delete through when Stripe no longer knows the subscription', async () => {
		subscriptionsRetrieve.mockRejectedValue(
			Object.assign(new Error('No such subscription'), { code: 'resource_missing' })
		);
		const { ensureSubscriptionCanceled } = await import('./stripe');
		await expect(ensureSubscriptionCanceled('sub_1')).resolves.toBeUndefined();
	});

	// Failing open on an outage would delete a brand whose subscription is still charging.
	it('refuses when Stripe fails for any other reason', async () => {
		subscriptionsRetrieve.mockRejectedValue(
			Object.assign(new Error('connection error'), { code: 'api_connection_error' })
		);
		const { ensureSubscriptionCanceled } = await import('./stripe');
		await expect(ensureSubscriptionCanceled('sub_1')).rejects.toThrow('connection error');
	});
});
