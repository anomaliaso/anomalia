import { describe, expect, it } from 'vitest';
import { planForOrg } from './org-billing-plan';

const PAYING = {
  id: 'b-pay',
  name: 'Paying',
  plan: 'pro',
  stripe_customer_id: 'cus_1',
  stripe_subscription_id: 'sub_1',
  activated_at: '2026-01-15T00:00:00Z'
};

const FREE = {
  id: 'b-free',
  name: 'Free',
  plan: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  activated_at: null
};

function org(brands: unknown[], own: Record<string, unknown> = {}) {
  return {
    id: 'org-1',
    name: 'Org',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    plan: null,
    activated_at: null,
    ...own,
    brands
  } as never;
}

describe('planForOrg', () => {
  it('copies the paying brand up to the org', () => {
    const plan = planForOrg(org([FREE, PAYING]));

    expect(plan).toEqual({
      kind: 'migrate',
      brandId: 'b-pay',
      brandName: 'Paying',
      values: {
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
        plan: 'pro',
        activated_at: '2026-01-15T00:00:00Z'
      }
    });
  });

  it('skips an org with no paying brand', () => {
    expect(planForOrg(org([FREE]))).toEqual({
      kind: 'skip',
      reason: 'no paying brand — stays free'
    });
  });

  it('skips an org with no brands at all', () => {
    expect(planForOrg(org([]))).toEqual({
      kind: 'skip',
      reason: 'no brands'
    });
  });

  // 0104 clears the plan on cancellation but keeps the subscription id: both conditions are
  // what tells a live subscription from a dead one.
  it('does not treat a cancelled subscription as paying', () => {
    const cancelled = { ...PAYING, plan: null };
    expect(planForOrg(org([cancelled]))).toEqual({
      kind: 'skip',
      reason: 'no paying brand — stays free'
    });
  });

  it('does not treat a paid plan without a subscription as paying', () => {
    const noSub = { ...PAYING, stripe_subscription_id: null };
    expect(planForOrg(org([noSub]))).toEqual({
      kind: 'skip',
      reason: 'no paying brand — stays free'
    });
  });

  it('refuses to choose when two brands of the org pay', () => {
    const second = { ...PAYING, id: 'b-pay-2', name: 'Second', stripe_subscription_id: 'sub_2' };
    expect(planForOrg(org([PAYING, second]))).toEqual({
      kind: 'conflict',
      brandIds: ['b-pay', 'b-pay-2']
    });
  });

  it('reports an already-migrated org instead of rewriting it', () => {
    const already = org([PAYING], {
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      plan: 'pro'
    });
    expect(planForOrg(already)).toEqual({ kind: 'done' });
  });

  // Idempotence has to survive a *partial* row too: re-running must finish the job, not skip it.
  it('re-migrates an org whose row is only half written', () => {
    const half = org([PAYING], { stripe_customer_id: 'cus_1' });
    expect(planForOrg(half)).toMatchObject({ kind: 'migrate', brandId: 'b-pay' });
  });
});
