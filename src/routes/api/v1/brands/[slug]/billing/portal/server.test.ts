import { beforeEach, describe, expect, it, vi } from 'vitest';

const orgBillingForBrand = vi.fn();
const isOrgOwner = vi.fn();
const createBillingPortalSession = vi.fn();
const applyRetentionCoupon = vi.fn();
const cancelSubscriptionAtPeriodEnd = vi.fn();
const ensureSubscriptionCanceled = vi.fn();
const gateCredits = vi.fn();
const structured = vi.fn();

vi.mock('$lib/server/cli-auth', () => ({
	authenticate: vi.fn(),
	loadBrandForUser: vi.fn(),
	checkApiKeyWriteAccess: vi.fn(() => undefined),
	gateAiAction: vi.fn()
}));
vi.mock('$lib/server/org-billing', () => ({
	orgBillingForBrand: (...args: unknown[]) => orgBillingForBrand(...args),
	isOrgOwner: (...args: unknown[]) => isOrgOwner(...args)
}));
vi.mock('$lib/server/stripe', () => ({
	createBillingPortalSession: (...args: unknown[]) => createBillingPortalSession(...args),
	applyRetentionCoupon: (...args: unknown[]) => applyRetentionCoupon(...args),
	cancelSubscriptionAtPeriodEnd: (...args: unknown[]) => cancelSubscriptionAtPeriodEnd(...args),
	ensureSubscriptionCanceled: (...args: unknown[]) => ensureSubscriptionCanceled(...args)
}));
vi.mock('$lib/server/credits', () => ({
	gateCredits: (...args: unknown[]) => gateCredits(...args),
	CreditsExhaustedError: class extends Error {}
}));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/app-url', () => ({ appOrigin: () => 'https://anomalia.test' }));

import { POST } from './+server';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess, gateAiAction } from '$lib/server/cli-auth';

const PORTAL_URL = 'https://billing.stripe.com/p/session/live_xyz';

const ORG_BILLING = {
	orgId: 'org-1',
	customerId: 'cus_org',
	subscriptionId: 'sub_org',
	plan: 'starter',
	brandCount: 2
};

function call(body: unknown = {}, slug = 'demo') {
	const url = new URL(`https://anomalia.test/api/v1/brands/${slug}/billing/portal`);
	return (POST as (event: unknown) => Promise<Response>)({
		request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
		params: { slug },
		url
	}).then(async (res) => ({ res, body: await res.json().catch(() => null) }));
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(authenticate).mockResolvedValue({
		supabase: {},
		user: { id: 'user-1' },
		apiKey: undefined,
		error: null
	} as never);
	vi.mocked(loadBrandForUser).mockResolvedValue({
		brand: { id: 'brand-1', org_id: 'org-1', slug: 'demo' },
		error: null
	} as never);
	vi.mocked(checkApiKeyWriteAccess).mockReturnValue(undefined);
	isOrgOwner.mockResolvedValue(true);
	orgBillingForBrand.mockResolvedValue(ORG_BILLING);
	createBillingPortalSession.mockResolvedValue(PORTAL_URL);
});

describe('POST /api/v1/brands/:slug/billing/portal', () => {
	it('hands back the portal url instead of redirecting to it', async () => {
		const { res, body } = await call();

		expect(res.status).toBe(200);
		expect(res.headers.get('location')).toBeNull();
		expect(body).toEqual({ ok: true, url: PORTAL_URL });
	});

	it('opens the portal of the ORG customer, not of the brand in the url', async () => {
		await call();

		expect(orgBillingForBrand).toHaveBeenCalledWith(expect.anything(), { slug: 'demo' });
		expect(createBillingPortalSession).toHaveBeenCalledWith({
			customerId: 'cus_org',
			returnUrl: 'https://anomalia.test/app/billing',
			flow: undefined,
			subscriptionId: 'sub_org'
		});
	});

	it('checks the owner against the org the brand belongs to', async () => {
		await call();

		expect(isOrgOwner).toHaveBeenCalledWith(expect.anything(), 'org-1', 'user-1');
	});

	it('never charges, never changes a plan, never cancels', async () => {
		await call();

		expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
		expect(applyRetentionCoupon).not.toHaveBeenCalled();
		expect(ensureSubscriptionCanceled).not.toHaveBeenCalled();
	});

	it('never gates on credits: whoever ran out is exactly who needs this link', async () => {
		await call();

		expect(gateAiAction).not.toHaveBeenCalled();
		expect(gateCredits).not.toHaveBeenCalled();
		expect(structured).not.toHaveBeenCalled();
	});

	it('refuses a caller who reaches the brand but does not own the org billing', async () => {
		isOrgOwner.mockResolvedValue(false);

		const { res, body } = await call();

		expect(res.status).toBe(403);
		expect(body.error).toBe('not_org_owner');
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('says no_customer, and where the human subscribes, when nobody ever paid', async () => {
		orgBillingForBrand.mockResolvedValue({ ...ORG_BILLING, customerId: null, subscriptionId: null });

		const { res, body } = await call();

		expect(res.status).toBe(409);
		expect(body.error).toBe('no_customer');
		expect(body.app_billing_url).toBe('https://anomalia.test/app/billing');
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('a Stripe outage is ours: 502, not a 4xx that accuses the caller', async () => {
		createBillingPortalSession.mockRejectedValue(new Error('connection error'));

		const { res, body } = await call();

		expect(res.status).toBe(502);
		expect(body.error).toBe('stripe_unavailable');
	});

	it('an org we cannot resolve is ours too: 500, not a 404 about the brand', async () => {
		orgBillingForBrand.mockResolvedValue(null);

		const { res, body } = await call();

		expect(res.status).toBe(500);
		expect(body.error).toBe('no_org_billing');
	});

	it('rejects a request without authentication', async () => {
		vi.mocked(authenticate).mockResolvedValue({
			error: new Response('Unauthorized', { status: 401 })
		} as never);

		const { res } = await call();

		expect(res.status).toBe(401);
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('rejects a brand the caller cannot reach', async () => {
		vi.mocked(loadBrandForUser).mockResolvedValue({
			error: new Response(JSON.stringify({ error: 'Brand not found' }), { status: 404 })
		} as never);

		const { res } = await call({}, 'altrui');

		expect(res.status).toBe(404);
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('rejects a read-only API key: this link leads to a cancel button', async () => {
		vi.mocked(checkApiKeyWriteAccess).mockReturnValue(
			new Response(JSON.stringify({ error: 'API key is read-only' }), { status: 403 }) as never
		);

		const { res } = await call();

		expect(res.status).toBe(403);
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('rejects a field the contract does not declare instead of ignoring it', async () => {
		const { res, body } = await call({ flow: 'cancel' });

		expect(res.status).toBe(400);
		expect(body.error).toBe('invalid_input');
		expect(createBillingPortalSession).not.toHaveBeenCalled();
	});
});
