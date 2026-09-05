import { z } from 'zod';
import type { BrandEndpoint, EndpointFailure } from './index';

const LinkSchema = z
  .string()
  .describe('One-time Stripe URL. Give it to the account owner and keep no copy');

const PlanSchema = z.object({ key: z.string(), label: z.string() });

const PortalInputSchema = z.object({}).strict();

const PortalResultSchema = z.object({
  ok: z.literal(true),
  url: LinkSchema
});

const CheckoutInputSchema = z
  .object({
    plan: z
      .string()
      .min(1)
      .optional()
      .describe('Plan key the human wants, e.g. "pro". Refused if the org cannot move up to it')
  })
  .strict();

const CheckoutResultSchema = z.object({
  ok: z.literal(true),
  url: LinkSchema,
  plans: z.array(PlanSchema).describe('The plans the hosted page will offer')
});

/**
 * Reaching a brand is not authority over its organization's money, and a customer who cannot
 * pay is not a caller who typed something wrong: `no_customer` and `no_subscription` describe
 * an account that has not subscribed yet, and `stripe_unavailable` / `no_org_billing` are ours.
 */
const BILLING_FAILURES: readonly EndpointFailure[] = [
  { error: 'not_org_owner', status: 403 },
  { error: 'no_customer', status: 409 },
  { error: 'no_org_billing', status: 500 },
  { error: 'stripe_unavailable', status: 502 }
];

export type BillingPortalLinkResult = z.infer<typeof PortalResultSchema>;
export type CheckoutLinkInput = z.infer<typeof CheckoutInputSchema>;
export type CheckoutLinkResult = z.infer<typeof CheckoutResultSchema>;

export const BILLING_PORTAL_LINK = {
  tool: 'create_billing_portal_link',
  title: 'Billing portal link',
  description:
    'Mint a one-time link to this organization Stripe billing portal and hand it to the account ' +
    'owner. On that page THEY can read invoices, change the card, switch plan and CANCEL the ' +
    'subscription — you never open it and never act inside it, you return the URL and stop. ' +
    'Treat the URL as a credential: whoever holds it reaches that customer billing, so give it ' +
    'to the owner once, in the reply, and never store or repeat it. Only the organization owner ' +
    'can mint one. Calls no model and spends no credits: it works precisely when credits are gone.',
  method: 'POST',
  pathUnderBrand: '/billing/portal',
  input: PortalInputSchema,
  output: PortalResultSchema,
  failures: BILLING_FAILURES,
  destructive: false
} satisfies BrandEndpoint;

export const CHECKOUT_LINK = {
  tool: 'create_checkout_link',
  title: 'Checkout link',
  description:
    'Mint a one-time link where the human picks a paid plan and pays, on Stripe own hosted page. ' +
    'You never pay, never change a plan and never apply a discount: you return the URL, they ' +
    'complete it. The same page can also CANCEL the subscription, so treat the URL as the owner ' +
    'credential — whoever holds it reaches that customer billing — and hand it over once, never ' +
    'stored, never repeated. Only the organization owner can mint one. Calls no model and spends ' +
    'no credits. An organization that never subscribed has no Stripe customer to check out ' +
    'against: the refusal carries app_billing_url, which is where the human starts.',
  method: 'POST',
  pathUnderBrand: '/billing/checkout',
  input: CheckoutInputSchema,
  output: CheckoutResultSchema,
  failures: [
    ...BILLING_FAILURES,
    { error: 'unknown_plan', status: 400 },
    { error: 'no_subscription', status: 409 }
  ],
  destructive: false
} satisfies BrandEndpoint;
