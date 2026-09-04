import { env } from '$env/dynamic/private';
import Stripe from 'stripe';

let client: Stripe | null = null;

function stripe(): Stripe {
  if (!client) {
    if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}

/**
 * Every plan change happens inside Stripe's hosted portal, on the prices configured there — the
 * app never names a price id, so there is nothing here to drift from the Stripe dashboard.
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
