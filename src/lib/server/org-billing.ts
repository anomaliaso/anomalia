import type { SupabaseClient } from '@supabase/supabase-js';

// Which Stripe customer and subscription a brand bills through.
//
// One subscription belongs to an ORGANIZATION and covers every brand under it. The rollout runs
// one org at a time, so both shapes are live at once: an org that has had its turn carries the
// ids itself, one that has not still leaves them on whichever of its brands pays. Every read is
// org-first and falls back to that brand — never to the caller's own brand, which may be a free
// sibling of a paying org and would answer "nothing here" for an org that pays.
//
// Twin of resolveOrgBilling() in credits.ts (PR #210, quota and period side): same two reads,
// different fields. Once both are on dev they should become one call.

export type OrgBilling = {
	orgId: string;
	customerId: string | null;
	subscriptionId: string | null;
	plan: string | null;
	/** Brands under the org — deleting one of several must not cancel what covers the others. */
	brandCount: number;
};

type BrandRow = {
	id: string;
	slug: string;
	plan: string | null;
	stripe_customer_id: string | null;
	stripe_subscription_id: string | null;
};

type OrgRow = {
	id: string;
	plan: string | null;
	stripe_customer_id: string | null;
	stripe_subscription_id: string | null;
	brands?: BrandRow[];
};

export async function orgBillingForBrand(
	supabase: SupabaseClient,
	brand: { slug?: string; id?: string }
): Promise<OrgBilling | null> {
	const key = brand.slug ? 'slug' : 'id';
	const value = brand.slug ?? brand.id;
	if (!value) return null;

	const { data: row } = await supabase
		.from('brands')
		.select('org_id')
		.eq(key, value)
		.maybeSingle();
	const orgId = (row as { org_id?: string } | null)?.org_id;
	if (!orgId) return null;

	const { data } = await supabase
		.from('organizations')
		.select(
			'id, plan, stripe_customer_id, stripe_subscription_id, brands(id, slug, plan, stripe_customer_id, stripe_subscription_id)'
		)
		.eq('id', orgId)
		.maybeSingle();
	const org = data as OrgRow | null;
	if (!org) return null;

	const brands = org.brands ?? [];
	const paying = brands.find((b) => b.stripe_customer_id);

	return {
		orgId: org.id,
		customerId: org.stripe_customer_id ?? paying?.stripe_customer_id ?? null,
		subscriptionId: org.stripe_subscription_id ?? paying?.stripe_subscription_id ?? null,
		plan: org.plan ?? paying?.plan ?? null,
		brandCount: brands.length
	};
}
