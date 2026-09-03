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

const PLAN_PRICE_ENV: Record<string, string | undefined> = {
  go: env.STRIPE_PRICE_GO,
  starter: env.STRIPE_PRICE_STARTER,
  pro: env.STRIPE_PRICE_PRO
};

function priceIdForPlan(plan: string): string {
  const id = PLAN_PRICE_ENV[plan];
  if (!id) throw new Error(`No Stripe price configured for plan "${plan}"`);
  return id;
}

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

export async function createUpgradePortalSession(opts: {
  customerId: string;
  subscriptionId: string;
  plan: string;
  returnUrl: string;
}): Promise<string> {
  const price = priceIdForPlan(opts.plan);
  const subscription = await stripe().subscriptions.retrieve(opts.subscriptionId);
  const item = subscription.items.data[0];
  if (!item) throw new Error('Subscription has no items to upgrade');

  const session = await stripe().billingPortal.sessions.create({
    customer: opts.customerId,
    return_url: opts.returnUrl,
    flow_data: {
      type: 'subscription_update_confirm',
      subscription_update_confirm: {
        subscription: opts.subscriptionId,
        items: [{ id: item.id, price, quantity: item.quantity ?? 1 }]
      }
    }
  });
  return session.url;
}

export async function applyRetentionCoupon(subscriptionId: string, coupon: string): Promise<void> {
  await stripe().subscriptions.update(subscriptionId, { coupon });
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
 * Blocks brand deletion while a paid subscription is still on (deleteBrand maps 'active_plan' to
 * an explicit "cancel your plan first" error) instead of silently canceling it as a side effect.
 */
export async function ensureSubscriptionCanceled(subscriptionId: string): Promise<void> {
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  if (sub.status === 'canceled') return;
  throw new Error('active_plan');
}
