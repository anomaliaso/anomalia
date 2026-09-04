import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { Currency } from '$lib/plans';

let client: Stripe | null = null;

function stripe(): Stripe {
  if (!client) {
    if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}

/**
 * The FIRST subscription is the one thing the hosted portal cannot sell: it changes a
 * subscription, and there is none yet. Checkout has to be handed a price, so these ids live here
 * — and nowhere else. Every later plan change stays in the portal, on the prices configured
 * there. Not secret (they travel in the checkout URL); the eurozone pays in EUR, everyone else on
 * the parallel USD ladder.
 */
export const PRICES = {
  go: {
    eur: { month: 'price_1U1Li6RxN8PTIw40wpOkPdVy', year: 'price_1U1Li7RxN8PTIw40r1ESOfKs' },
    usd: { month: 'price_1U1Li7RxN8PTIw40cSQTHgoa', year: 'price_1U1Li7RxN8PTIw40DS8GpdHG' }
  },
  starter: {
    eur: { month: 'price_1Tfx7NRxN8PTIw40e2md3XM3', year: 'price_1Tfx7ORxN8PTIw40zbThuICT' },
    usd: { month: 'price_1TwIisRxN8PTIw40DO1gzGRn', year: 'price_1TwIkiRxN8PTIw4069cfBSqj' }
  },
  pro: {
    eur: { month: 'price_1TsqcSRxN8PTIw40NwIFR94X', year: 'price_1TsqcSRxN8PTIw40uJn3KM8f' },
    usd: { month: 'price_1TwIkiRxN8PTIw40pHJIw9YA', year: 'price_1TwIkjRxN8PTIw40mkrp09Hn' }
  }
} as const;

export function priceFor(plan: string, cycle: string, currency: Currency): string | undefined {
  const tier = PRICES[plan as keyof typeof PRICES];
  return tier ? tier[currency][cycle === 'year' ? 'year' : 'month'] : undefined;
}

/**
 * Purchasing-power discounts, auto-applied at checkout from the visitor's country
 * (`x-vercel-ip-country`). Good-faith, not fraud-proof: a VPN defeats it. First match wins, and
 * the coupons live in the same Stripe account as the prices above.
 */
const GEO_COUPONS: Array<{ coupon: string; countries: ReadonlySet<string> }> = [
  {
    coupon: 'latam40',
    countries: new Set([
      'MX',
      'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA',
      'CO', 'VE', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'BR', 'GY', 'SR',
      'DO', 'CU'
    ])
  },
  {
    // Singapore and Brunei stay out: high income, no purchasing-power case.
    coupon: 'sea50',
    countries: new Set(['ID', 'TH', 'VN', 'PH', 'MY', 'MM', 'KH', 'LA', 'TL'])
  }
];

export function geoCouponFor(country: string | null | undefined): string | undefined {
  if (!country) return undefined;
  return GEO_COUPONS.find((g) => g.countries.has(country))?.coupon;
}

/**
 * A brand's Stripe customer, created on first need. The id on the row is what migration 0007's
 * trigger joins on to mirror the subscription back into `brands.plan` / `brands.status`, so it
 * has to be written before checkout, not after it.
 */
export async function ensureBrandCustomer(
  supabase: SupabaseClient,
  brand: { id: string; name: string; stripe_customer_id: string | null }
): Promise<string> {
  if (brand.stripe_customer_id) return brand.stripe_customer_id;

  const customer = await stripe().customers.create({
    name: brand.name,
    metadata: { brand_id: brand.id }
  });
  await supabase.from('brands').update({ stripe_customer_id: customer.id }).eq('id', brand.id);

  return customer.id;
}

/**
 * Stripe-hosted checkout for the first subscription. `subscription_data.metadata.plan` is not
 * decoration: the 0007 trigger reads it to set `brands.plan` when the subscription lands.
 *
 * Regime forfettario — no VAT is charged, so `automatic_tax` stays OFF; the VAT id and legal name
 * are still collected for the invoice.
 */
export async function createCheckoutSession(opts: {
  customerId: string;
  brandId: string;
  plan: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  couponId?: string;
}): Promise<string> {
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer: opts.customerId,
    line_items: [{ price: opts.priceId, quantity: 1 }],
    // Stripe forbids pairing `discounts` with `allow_promotion_codes`: an auto-applied geo coupon
    // replaces the promo-code field rather than sitting next to it.
    ...(opts.couponId ? { discounts: [{ coupon: opts.couponId }] } : { allow_promotion_codes: true }),
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    tax_id_collection: { enabled: true },
    customer_update: { name: 'auto', address: 'auto' },
    billing_address_collection: 'required',
    subscription_data: { metadata: { brand_id: opts.brandId, plan: opts.plan } },
    metadata: { brand_id: opts.brandId }
  });
  if (!session.url) throw new Error('Stripe: no checkout URL');

  return session.url;
}

/**
 * Every plan CHANGE happens inside Stripe's hosted portal, on the prices configured there — the
 * app names a price only to open the first subscription (see PRICES above).
 */
export async function createBillingPortalSession(opts: {
  customerId: string;
  returnUrl: string;
  flow?: 'payment_method' | 'upgrade';
  subscriptionId: string | null;
}): Promise<string> {
  const flow_data =
    opts.flow === 'payment_method'
      ? { type: 'payment_method_update' as const }
      : opts.flow === 'upgrade' && opts.subscriptionId
        ? {
            type: 'subscription_update' as const,
            subscription_update: { subscription: opts.subscriptionId }
          }
        : undefined;

  const session = await stripe().billingPortal.sessions.create({
    customer: opts.customerId,
    return_url: opts.returnUrl,
    ...(flow_data ? { flow_data } : {})
  });
  return session.url;
}

export async function applyRetentionCoupon(subscriptionId: string, coupon: string): Promise<void> {
  await stripe().subscriptions.update(subscriptionId, { discounts: [{ coupon }] });
}

export async function cancelSubscriptionAtPeriodEnd(
  subscriptionId: string,
  opts: { feedback?: string; comment?: string }
): Promise<{ endsAt: string | null }> {
  const sub = await stripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
    cancellation_details: {
      feedback: opts.feedback as Stripe.SubscriptionUpdateParams.CancellationDetails.Feedback | undefined,
      comment: opts.comment || undefined
    }
  });
  return { endsAt: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null };
}

/**
 * States that will never bill again on their own: Stripe has either ended the subscription or
 * given up collecting. `past_due` and `incomplete` stay out — those still recover on a retry, and
 * the owner can end them from the portal in one click.
 */
const SETTLED_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'canceled',
  'incomplete_expired',
  'unpaid'
]);

/**
 * Blocks brand deletion while a subscription can still charge someone (deleteBrand maps
 * 'active_plan' to an explicit "cancel your plan first" error) instead of silently canceling it
 * as a side effect.
 *
 * Anything that cannot charge again lets the delete through, including the case the strict
 * `status === 'canceled'` check used to trap: an owner who just used "cancel plan" carries
 * `cancel_at_period_end` with the status still `active`, was told they had cancelled, and could
 * not delete their own brand until the period ran out. A subscription id Stripe no longer knows
 * is treated the same way — it bills nobody, and refusing on it made the brand undeletable
 * forever. Every other Stripe failure (network, auth) still refuses: failing open there would
 * delete a brand whose subscription is very much alive.
 */
export async function ensureSubscriptionCanceled(subscriptionId: string): Promise<void> {
  let sub: Stripe.Subscription;
  try {
    sub = await stripe().subscriptions.retrieve(subscriptionId);
  } catch (e) {
    if ((e as Stripe.errors.StripeError)?.code === 'resource_missing') return;
    throw e;
  }
  if (SETTLED_STATUSES.has(sub.status) || sub.cancel_at_period_end) return;
  throw new Error('active_plan');
}
