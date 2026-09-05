/**
 * What an organization's billing row needs, decided from its own row and its brands.
 *
 * Lives apart from the command in migrate-org-billing.ts on purpose: this is the part that
 * decides what gets written to a real billing row, so it is a pure function a test can hold
 * without the command's env, its Supabase client, or its side effects.
 */
import { PAID_PLAN_IDS } from '../src/lib/plans';

export type BrandRow = {
  id: string;
  name: string | null;
  plan: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  activated_at: string | null;
};

export type OrgRow = {
  id: string;
  name: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  activated_at: string | null;
  brands: BrandRow[];
};

export type BillingValues = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  activated_at: string | null;
};

export type OrgPlan =
  | { kind: 'migrate'; brandId: string; brandName: string | null; values: BillingValues }
  | { kind: 'skip'; reason: string }
  | { kind: 'conflict'; brandIds: string[] }
  | { kind: 'done' };

export const isPaying = (b: BrandRow) =>
  !!b.stripe_subscription_id && (PAID_PLAN_IDS as readonly string[]).includes(String(b.plan));

/**
 * What this org needs, from its own row and its brands. Same two conditions `payingOrgId` uses in
 * src/lib/server/org.ts — a cancelled subscription keeps its id and loses its plan (0104), so
 * neither alone tells a live subscription from a dead one.
 *
 * `activated_at` rides along even though nothing reads it today (a paying org takes its period
 * from Stripe, and until the brand columns are dropped `resolveOrgBilling` falls back to the
 * paying brand's). It is one column in an UPDATE that is already happening, and it is what keeps
 * the free-plan anchor from quietly moving to the calendar month on the day those columns go.
 */
export function planForOrg(org: OrgRow): OrgPlan {
  const brands = org.brands ?? [];
  if (brands.length === 0) return { kind: 'skip', reason: 'no brands' };

  const paying = brands.filter(isPaying);
  if (paying.length > 1) return { kind: 'conflict', brandIds: paying.map((b) => b.id) };
  if (paying.length === 0) return { kind: 'skip', reason: 'no paying brand — stays free' };

  const brand = paying[0];
  const values: BillingValues = {
    stripe_customer_id: brand.stripe_customer_id,
    stripe_subscription_id: brand.stripe_subscription_id,
    plan: brand.plan,
    activated_at: brand.activated_at
  };

  const settled =
    org.stripe_customer_id === values.stripe_customer_id &&
    org.stripe_subscription_id === values.stripe_subscription_id &&
    org.plan === values.plan;
  if (settled) return { kind: 'done' };

  return { kind: 'migrate', brandId: brand.id, brandName: brand.name, values };
}
