import type { BillingProvider } from '$lib/billing/contract';
import { creditQuota, gateCreditsCore } from '$lib/server/credits';
import { isTopPlan, plansAbove, postQuota } from '$lib/server/plans';

export const anomaliaBillingProvider: BillingProvider = {
  kind: 'anomalia',

  async gate(kind, ctx) {
    if (kind === 'credits') {
      await gateCreditsCore(ctx.brandId);
    }
  },

  async quota(kind, ctx) {
    return kind === 'credits' ? creditQuota(ctx.plan) : postQuota(ctx.plan);
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
