import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { getCreditsUsage } from '$lib/server/credits';
import { ensureOrgForUser } from '$lib/server/org';
import { plansAbove, isTopPlan } from '$lib/server/plans';
import {
  billingPortal,
  upgrade,
  applyRetention,
  cancelPlan
} from '$lib/server/settings-actions';

const CREDITS_PER_USD = 100;

type BrandRow = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  status: string | null;
  activated_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

type OrgRow = {
  id: string;
  name: string;
  owner_id: string;
  plan: string | null;
  stripe_customer_id: string | null;
  brands: BrandRow[] | null;
};

/**
 * One subscription covers the whole organization, so this page answers for the org: its plan,
 * its pool, and which of its brands is spending it.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw redirect(303, '/login');

  const orgId = await ensureOrgForUser(supabase, user);
  if (!orgId) throw redirect(303, '/app');

  const { data } = await supabase
    .from('organizations')
    .select(
      'id, name, owner_id, plan, stripe_customer_id, brands(id, name, slug, plan, status, activated_at, stripe_customer_id, stripe_subscription_id)'
    )
    .eq('id', orgId)
    .maybeSingle();
  const org = data as OrgRow | null;
  if (!org) throw redirect(303, '/app');

  const brands = org.brands ?? [];
  // The brand the org bills through, for both rollout states: the org's own columns once it has
  // been migrated, that brand's while it waits. Its slug is where the billing forms post.
  const billingBrand = brands.find((b) => b.stripe_subscription_id && b.plan) ?? brands[0] ?? null;
  const plan = org.plan ?? billingBrand?.plan ?? null;

  const empty = {
    org: { id: org.id, name: org.name, plan },
    credits: null,
    brands: [] as { id: string; name: string; slug: string; credits: number }[],
    hasBilling: false,
    billingBrandSlug: null as string | null,
    upgrades: plansAbove(plan),
    atTopPlan: isTopPlan(plan),
    isOwner: org.owner_id === user.id
  };
  if (!billingBrand) return empty;

  const credits = await getCreditsUsage(supabase, {
    id: billingBrand.id,
    plan: billingBrand.plan,
    activated_at: billingBrand.activated_at,
    status: billingBrand.status ?? 'active'
  });

  // Per-brand spend over the ORG's period, so the rows add up to the pool's "used".
  const spends = await Promise.all(
    brands.map(async (b) => {
      const { data: usd } = await supabase.rpc('sum_brand_ai_cost_usd', {
        p_brand_id: b.id,
        p_start: credits.periodStart.toISOString(),
        p_end: credits.periodEnd.toISOString()
      });
      return {
        id: b.id,
        name: b.name,
        slug: b.slug,
        credits: Math.round(Number(usd ?? 0) * CREDITS_PER_USD)
      };
    })
  );

  return {
    ...empty,
    credits: {
      used: credits.used,
      quota: credits.quota,
      bonus: credits.bonus,
      remaining: credits.remaining,
      percent: credits.percent,
      periodStart: credits.periodStart.toISOString(),
      periodEnd: credits.periodEnd.toISOString()
    },
    brands: spends,
    hasBilling: !!(org.stripe_customer_id || billingBrand.stripe_customer_id),
    billingBrandSlug: billingBrand.slug
  };
};

/**
 * The billing actions are the brand ones, unchanged: they resolve the org themselves and take the
 * brand slug from `params`. Running them here — rather than posting to the brand route, whose GET
 * now redirects — is what keeps a `fail()` visible: a redirecting load would swallow the message.
 */
async function billingBrandSlug(supabase: App.Locals['supabase']): Promise<string | null> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;
  const orgId = await ensureOrgForUser(supabase, user);
  if (!orgId) return null;

  const { data } = await supabase
    .from('organizations')
    .select('brands(slug, plan, stripe_subscription_id)')
    .eq('id', orgId)
    .maybeSingle();
  const brands = ((data as { brands?: BrandRow[] } | null)?.brands ?? []) as BrandRow[];
  return (brands.find((b) => b.stripe_subscription_id && b.plan) ?? brands[0])?.slug ?? null;
}

function onBillingBrand(fn: (event: RequestEvent) => unknown) {
  return async (event: RequestEvent) => {
    const brand = await billingBrandSlug(event.locals.supabase);
    if (!brand) return fail(400, { billingError: 'No brand to bill' });
    return fn({ ...event, params: { ...event.params, brand } } as RequestEvent);
  };
}

export const actions: Actions = {
  billingPortal: onBillingBrand(billingPortal as (e: RequestEvent) => unknown),
  upgrade: onBillingBrand(upgrade as (e: RequestEvent) => unknown),
  applyRetention: onBillingBrand(applyRetention as (e: RequestEvent) => unknown),
  cancelPlan: onBillingBrand(cancelPlan as (e: RequestEvent) => unknown)
};
