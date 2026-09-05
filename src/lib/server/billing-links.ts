import type { SupabaseClient } from '@supabase/supabase-js';
import { orgBillingForBrand } from '$lib/server/org-billing';

const stripeApi = () => import('$lib/server/stripe');

/**
 * The one table of reasons a Stripe link cannot be minted. The web billing actions and the API
 * endpoints read the same rows, so a reason that means "activate first" in the browser cannot
 * come to mean something else to an external agent. `stripe_unavailable` is ours, not the
 * caller's, and every surface has to keep saying so.
 */
export type BillingLinkRefusal =
	| 'no_org_billing'
	| 'no_customer'
	| 'no_subscription'
	| 'stripe_unavailable';

export type BillingLink =
	| { url: string; refusal?: undefined; message?: undefined }
	| { url?: undefined; refusal: BillingLinkRefusal; message: string };

const refuse = (refusal: BillingLinkRefusal, message = ''): BillingLink => ({ refusal, message });

export async function billingLink(
	supabase: SupabaseClient,
	opts: { slug: string; returnUrl: string; flow?: 'payment_method' | 'upgrade' }
): Promise<BillingLink> {
	const billing = await orgBillingForBrand(supabase, { slug: opts.slug });
	if (!billing) return refuse('no_org_billing');
	if (!billing.customerId) return refuse('no_customer');
	if (opts.flow === 'upgrade' && !billing.subscriptionId) return refuse('no_subscription');

	try {
		const { createBillingPortalSession } = await stripeApi();
		const url = await createBillingPortalSession({
			customerId: billing.customerId,
			returnUrl: opts.returnUrl,
			flow: opts.flow,
			subscriptionId: billing.subscriptionId
		});
		return { url };
	} catch (e) {
		return refuse('stripe_unavailable', e instanceof Error ? e.message : '');
	}
}
