import type { BillingProvider } from '$lib/billing/contract';
import { creditQuota, gateCreditsCore, orgPlanForBrand } from '$lib/server/credits';
import { isTopPlan, plansAbove, postQuota } from '$lib/server/plans';
import { createAdminClient } from '$lib/server/supabase-admin';

/**
 * The plan a quota answers to belongs to the ORG, not to the brand the caller happens to hold:
 * one subscription covers every brand under it. `ctx.plan` is the brand's, which after that org
 * migrates is the frozen rollback copy — right often enough to hide the times it is stale. It
 * stays as the fallback so a failed lookup never shrinks a paying brand's quota.
 */
async function planForQuota(ctx: { brandId: string; plan?: string | null }): Promise<string | null> {
  try {
    return (await orgPlanForBrand(createAdminClient(), ctx.brandId)) ?? ctx.plan ?? null;
  } catch {
    return ctx.plan ?? null;
  }
}

export const anomaliaBillingProvider: BillingProvider = {
  kind: 'anomalia',

  async gate(kind, ctx) {
    if (kind === 'credits') {
      await gateCreditsCore(ctx.brandId);
    }
  },

  async quota(kind, ctx) {
    const plan = await planForQuota(ctx);
    return kind === 'credits' ? creditQuota(plan) : postQuota(plan);
  },

  upgradeUrl(ctx) {
    return ctx.brandSlug ? `/app/${ctx.brandSlug}/settings/billing` : undefined;
  },

  plansAbove(plan) {
    return plansAbove(plan);
  },

  isTopPlan(plan) {
    return isTopPlan(plan);
  }
};
