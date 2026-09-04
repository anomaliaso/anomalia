import { describe, expect, it, vi, beforeEach } from 'vitest';
import { creditQuota } from './credits';

// credits.ts caches the resolved org and its period for 5 minutes at module scope. Without a
// reset each test would answer from the previous one's seed — and quietly pass for it.
beforeEach(() => {
  vi.resetModules();
});

// The pool is the ORG's, not the brand's: spend, grants and quota all answer for every brand
// under the org. During the org-by-org rollout an org may not carry its billing columns yet
// (#185 keeps the brand ones populated as the rollback net), so every read is org-first with a
// fall back to whichever brand of that org still holds the subscription.

type Row = Record<string, any>;

type Seed = {
  organizations?: Row[];
  brands?: Row[];
  credit_grants?: Row[];
  org_usage?: Row[];
  /** sum_org_ai_cost_usd answers, in USD, per org id. */
  spendByOrg?: Record<string, number>;
  /** org_billing_period answers, per org id. */
  periodByOrg?: Record<string, string>;
  /** brand_billing_period answers, per brand id. */
  periodByBrand?: Record<string, string>;
};

function makeDb(seed: Seed = {}) {
  const db = {
    organizations: seed.organizations ?? [],
    brands: seed.brands ?? [],
    credit_grants: seed.credit_grants ?? [],
    org_usage: seed.org_usage ?? []
  };
  const calls: string[] = [];

  function rows(table: string): Row[] {
    return (db as Record<string, Row[]>)[table] ?? [];
  }

  function query(table: string) {
    const eq: Record<string, unknown> = {};
    const inList: Record<string, unknown[]> = {};
    const chain: any = {
      eq: (k: string, v: unknown) => {
        eq[k] = v;
        return chain;
      },
      in: (k: string, v: unknown[]) => {
        inList[k] = v;
        return chain;
      },
      select: () => chain,
      limit: () => chain,
      order: () => chain,
      matched: () =>
        rows(table).filter(
          (r) =>
            Object.entries(eq).every(([k, v]) => r[k] === v) &&
            Object.entries(inList).every(([k, v]) => v.includes(r[k]))
        ),
      maybeSingle: async () => {
        calls.push(`${table}.select`);
        const row = chain.matched()[0];
        return { data: row ? withChildren(table, row) : null, error: null };
      },
      then: (resolve: (v: any) => unknown) => {
        calls.push(`${table}.select`);
        return Promise.resolve({ data: chain.matched(), error: null }).then(resolve);
      }
    };
    return chain;
  }

  // organizations rows carry their brands, the way a PostgREST embed does.
  function withChildren(table: string, row: Row): Row {
    if (table !== 'organizations') return row;
    return { ...row, brands: db.brands.filter((b) => b.org_id === row.id) };
  }

  const client = {
    from: (table: string) => ({
      select: () => query(table),
      insert: async (row: Row) => {
        calls.push(`${table}.insert`);
        const dup = rows(table).some(
          (r) => r.org_id === row.org_id && r.month === row.month && table === 'org_usage'
        );
        if (dup) return { data: null, error: { message: 'duplicate key' } };
        rows(table).push({ id: `${table}-${rows(table).length + 1}`, ...row });
        return { data: null, error: null };
      },
      update: (patch: Row) => {
        const eq: Record<string, unknown> = {};
        const chain: any = {
          eq: (k: string, v: unknown) => {
            eq[k] = v;
            return chain;
          },
          or: () => chain,
          select: async () => {
            calls.push(`${table}.update`);
            const hit = rows(table).filter((r) =>
              Object.entries(eq).every(([k, v]) => r[k] === v)
            );
            hit.forEach((r) => Object.assign(r, patch));
            return { data: hit, error: null };
          }
        };
        return chain;
      }
    }),
    rpc: (name: string, args: Row) => {
      calls.push(name);
      if (name === 'sum_org_ai_cost_usd') {
        return Promise.resolve({ data: seed.spendByOrg?.[args.p_org_id as string] ?? 0, error: null });
      }
      const period =
        name === 'org_billing_period'
          ? seed.periodByOrg?.[args._org_id as string]
          : seed.periodByBrand?.[args._brand_id as string];
      const result = {
        data: period ? { period_start: period, period_end: null } : null,
        error: null
      };
      return { maybeSingle: async () => result, then: (r: any) => Promise.resolve(result).then(r) };
    }
  };

  return { client, db, calls };
}

const ORG = 'org-1';

/** An org whose billing columns are already filled in — a migrated one. */
function migratedOrg(plan: string) {
  return {
    organizations: [
      { id: ORG, plan, activated_at: null, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }
    ],
    brands: [
      { id: 'brand-a', org_id: ORG, plan: null, activated_at: null, stripe_subscription_id: null },
      { id: 'brand-b', org_id: ORG, plan: null, activated_at: null, stripe_subscription_id: null }
    ]
  };
}

/** An org still waiting its turn in the rollout: the paying brand still holds everything. */
function notMigratedOrg(plan: string) {
  return {
    organizations: [
      { id: ORG, plan: null, activated_at: null, stripe_customer_id: null, stripe_subscription_id: null }
    ],
    brands: [
      { id: 'brand-a', org_id: ORG, plan, activated_at: null, stripe_subscription_id: 'sub_1' },
      { id: 'brand-b', org_id: ORG, plan: null, activated_at: null, stripe_subscription_id: null }
    ]
  };
}

const FREE_BRAND = { id: 'brand-b', plan: null, activated_at: null, status: 'active' };

describe('getCreditsUsage, org-scoped', () => {
  it('reads the quota from the org when the org is migrated', async () => {
    const { client } = makeDb({ ...migratedOrg('pro'), spendByOrg: { [ORG]: 0 } });
    const { getCreditsUsage } = await import('./credits');

    const usage = await getCreditsUsage(client as never, FREE_BRAND);

    expect(usage.quota).toBe(creditQuota('pro'));
  });

  it("falls back to the org's paying brand while the org is not migrated yet", async () => {
    // brand-b is free and carries nothing; the org pays through brand-a. Reading brand-b must
    // still answer with the pool the org actually has.
    const { client } = makeDb({ ...notMigratedOrg('pro'), spendByOrg: { [ORG]: 0 } });
    const { getCreditsUsage } = await import('./credits');

    const usage = await getCreditsUsage(client as never, FREE_BRAND);

    expect(usage.quota).toBe(creditQuota('pro'));
  });

  it('spends from one shared pool: every brand of the org counts', async () => {
    const { client, calls } = makeDb({ ...migratedOrg('pro'), spendByOrg: { [ORG]: 3 } });
    const { getCreditsUsage } = await import('./credits');

    const usage = await getCreditsUsage(client as never, FREE_BRAND);

    expect(calls).toContain('sum_org_ai_cost_usd');
    expect(calls).not.toContain('sum_brand_ai_cost_usd');
    expect(usage.used).toBe(300); // 3 USD × 100 credits
  });

  it('adds org-targeted grants and the grants of every brand in the org', async () => {
    const { client } = makeDb({
      ...migratedOrg('pro'),
      spendByOrg: { [ORG]: 0 },
      credit_grants: [
        { amount: 500, expires_at: null, org_id: ORG, brand_id: null },
        { amount: 250, expires_at: null, org_id: null, brand_id: 'brand-a' },
        { amount: 999, expires_at: null, org_id: null, brand_id: 'brand-elsewhere' }
      ]
    });
    const { getCreditsUsage } = await import('./credits');

    const usage = await getCreditsUsage(client as never, FREE_BRAND);

    expect(usage.bonus).toBe(750); // 500 org + 250 sibling brand, never the outsider's 999
  });

  it("takes the billing period from the org's own subscription", async () => {
    const { client, calls } = makeDb({
      ...migratedOrg('pro'),
      spendByOrg: { [ORG]: 0 },
      periodByOrg: { [ORG]: '2026-07-15T00:00:00Z' }
    });
    const { getCreditsUsage } = await import('./credits');

    const usage = await getCreditsUsage(client as never, FREE_BRAND);

    expect(calls).toContain('org_billing_period');
    expect(usage.periodStart.getUTCDate()).toBe(15);
  });

  it("falls back to the paying brand's period while the org is not migrated", async () => {
    const { client, calls } = makeDb({
      ...notMigratedOrg('pro'),
      spendByOrg: { [ORG]: 0 },
      periodByBrand: { 'brand-a': '2026-07-15T00:00:00Z' }
    });
    const { getCreditsUsage } = await import('./credits');

    const usage = await getCreditsUsage(client as never, FREE_BRAND);

    expect(calls).toContain('brand_billing_period');
    expect(usage.periodStart.getUTCDate()).toBe(15);
  });
});

describe('gateCreditsCore, org-scoped cache', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('two brands of the same org share one pool reading', async () => {
    // The cache keys on the org: the second brand must not pay for the same sum all over again.
    const { client, calls } = makeDb({ ...migratedOrg('pro'), spendByOrg: { [ORG]: 0 } });
    vi.doMock('./supabase-admin', () => ({ createAdminClient: () => client }));
    vi.doMock('./ai-log', () => ({ isCreditExempt: () => false }));

    const { gateCreditsCore } = await import('./credits');
    await gateCreditsCore('brand-a');
    await gateCreditsCore('brand-b');

    expect(calls.filter((c) => c === 'sum_org_ai_cost_usd')).toHaveLength(1);
  });
});

describe('maybeSendCreditWarning', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('claims the warning once per org, not once per brand', async () => {
    const { client, db } = makeDb({ ...migratedOrg('pro'), spendByOrg: { [ORG]: 0 } });
    vi.doMock('./scheduler', () => ({
      brandContacts: async () => [{ email: 'ana@example.com', locale: 'en' }]
    }));
    vi.doMock('$lib/server/brand-notify', () => ({ notifyBrandContacts: async () => {} }));

    const { maybeSendCreditWarning } = await import('./credits');
    const usage = {
      used: 900,
      quota: 1000,
      bonus: 0,
      remaining: 100,
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-10-01T00:00:00Z'),
      percent: 90
    };

    await maybeSendCreditWarning(client as never, { id: 'brand-a', name: 'A', org_id: ORG }, usage);
    await maybeSendCreditWarning(client as never, { id: 'brand-b', name: 'B', org_id: ORG }, usage);

    expect(db.org_usage).toHaveLength(1);
    expect(db.org_usage[0].org_id).toBe(ORG);
  });
});
