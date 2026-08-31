import { describe, it, expect, vi } from 'vitest';
import { blogArticlesPerMonth, blogTranslationLanguages, blogArticlesPerWeek, postQuota, videoCap, mixCostUsd, VIDEO_SHARE, batchWeeks } from './plans';
import { PLAN_WEEKS } from './editorial-plan';
import { creditQuota } from './credits';

// The quotas are sized against a MEASURED cost per post, so they are only correct while the two
// stay in sync. This is the guard: raise POST_QUOTAS (or the unit costs) past what the plan's
// credits can pay for and it fails here, not on a customer's invoice.
//
// Post production is ~33% of a plan's credits in practice — the rest is blog, radar, SEO/GEO
// audits, strategy and chat. Credits are billed at 100 = $1.
const POST_BUDGET_SHARE = 0.33;
const CREDITS_PER_USD = 100;

describe('pricing display capacity matches server quotas', () => {
  it('postsPerMonth on each card equals POST_QUOTAS', async () => {
    const { PLANS } = await import('$lib/plans');
    for (const p of PLANS) {
      expect(p.postsPerMonth).toBe(postQuota(p.key));
    }
  });

  it('articlesPerMonth on each card equals BLOG_ARTICLES_PER_MONTH', async () => {
    const { PLANS } = await import('$lib/plans');
    for (const p of PLANS) {
      expect(p.articlesPerMonth).toBe(blogArticlesPerMonth(p.key));
    }
  });

  it('articlesPerWeek on each card equals BLOG_ARTICLES_PER_WEEK', async () => {
    const { PLANS } = await import('$lib/plans');
    for (const p of PLANS) {
      expect(p.articlesPerWeek).toBe(blogArticlesPerWeek(p.key));
    }
  });
});

describe('post quotas fit the credit envelope', () => {
  for (const plan of ['go', 'starter', 'pro']) {
    it(`${plan}: a month of the target mix stays inside its post-production budget`, () => {
      const budgetUsd = (creditQuota(plan) / CREDITS_PER_USD) * POST_BUDGET_SHARE;
      expect(mixCostUsd(plan)).toBeLessThanOrEqual(budgetUsd);
    });
  }

  it('an unknown plan falls back to the SMALLEST quota, never to unlimited', () => {
    expect(postQuota('enterprise-2029')).toBe(postQuota('go'));
    expect(postQuota(null)).toBe(postQuota('go'));
  });

  it('the video cap is derived from the quota, so the two cannot drift apart', () => {
    expect(videoCap('go')).toBe(Math.round(postQuota('go') * VIDEO_SHARE));
    expect(videoCap('starter')).toBe(Math.round(postQuota('starter') * VIDEO_SHARE));
    expect(videoCap('pro')).toBe(Math.round(postQuota('pro') * VIDEO_SHARE));
    // Whatever the numbers become, video must stay the DOMINANT format — that is the whole point
    // of trading post count for format.
    expect(videoCap('go')).toBeGreaterThan(postQuota('go') * 0.3);
    expect(videoCap('starter')).toBeGreaterThan(postQuota('starter') * 0.3);
  });
});

// The monthly ceiling gates the month planner and the autopilot drip. An unknown or absent plan must
// fall back to the LOWEST allowance, never to "unlimited" — the fallback is what a brand mid-upgrade,
// or a legacy row with a plan string we don't know, actually gets.
describe('blogArticlesPerMonth', () => {
  it('scales 2× then 3×: Go 15 / Starter 30 / Pro 90', () => {
    expect(blogArticlesPerMonth('go')).toBe(15);
    expect(blogArticlesPerMonth('starter')).toBe(30);
    expect(blogArticlesPerMonth('pro')).toBe(90);
  });

  it('falls back to the go allowance for unknown/absent plans (free matches Go)', () => {
    expect(blogArticlesPerMonth(null)).toBe(15);
    expect(blogArticlesPerMonth(undefined)).toBe(15);
    expect(blogArticlesPerMonth('enterprise-2029')).toBe(15);
  });

  it('keeps the legacy scale tier covered', () => {
    expect(blogArticlesPerMonth('scale')).toBe(90);
  });

  it('is a ceiling above what the default cadence can produce in a month', () => {
    expect(blogArticlesPerWeek('go') * 4).toBeLessThanOrEqual(blogArticlesPerMonth('go'));
    expect(blogArticlesPerWeek('starter') * 4).toBeLessThanOrEqual(blogArticlesPerMonth('starter'));
    expect(blogArticlesPerWeek('pro') * 4).toBeLessThanOrEqual(blogArticlesPerMonth('pro'));
  });
});

// Translations are the top tier's multiplier, so the count must be 0 below it — a non-zero fallback
// would hand the feature to every unknown plan string.
describe('blogTranslationLanguages', () => {
  it('is 3 on the top tier and 0 on starter', () => {
    expect(blogTranslationLanguages('pro')).toBe(3);
    expect(blogTranslationLanguages('starter')).toBe(0);
  });

  it('defaults to 0 for unknown/absent plans, never to the paid perk', () => {
    expect(blogTranslationLanguages(null)).toBe(0);
    expect(blogTranslationLanguages(undefined)).toBe(0);
    expect(blogTranslationLanguages('enterprise-2029')).toBe(0);
  });
});

// blogMonthlyUsage clamps at zero: a brand that somehow exceeded the cap (cadence changed mid-month,
// plan downgraded) must read as "0 left", never as a negative that would flip `remaining > 0` checks.
describe('blogMonthlyUsage', () => {
  // Mirrors the real chain: .select(head).eq(brand).is(translation_of, null).gte(monthStart).
  // The `.is` link is load-bearing — the cap counts ORIGINALS, so translations must not consume it.
  function fakeAdmin(count: number) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({ is: () => ({ gte: () => Promise.resolve({ count }) }) })
        })
      })
    } as never;
  }

  it('reports what is left for the month', async () => {
    const { blogMonthlyUsage } = await import('./blog-generate');
    expect(await blogMonthlyUsage(fakeAdmin(4), 'b', 'starter')).toEqual({ cap: 30, used: 4, remaining: 26 });
  });

  it('clamps remaining at 0 when the cap was already exceeded', async () => {
    const { blogMonthlyUsage } = await import('./blog-generate');
    const u = await blogMonthlyUsage(fakeAdmin(45), 'b', 'starter');
    expect(u.used).toBe(45);
    expect(u.remaining).toBe(0);
  });

  it('treats a null count (empty table) as zero used', async () => {
    const { blogMonthlyUsage } = await import('./blog-generate');
    expect((await blogMonthlyUsage(fakeAdmin(null as unknown as number), 'b', 'pro')).remaining).toBe(90);
  });
});

describe('isExportOnlyPlan', () => {
  it('is true for Go — a paid tier that sells zero connected accounts', async () => {
    const { isExportOnlyPlan } = await import('./plans');
    expect(isExportOnlyPlan('go')).toBe(true);
  });

  it('is false for the tiers that include social accounts', async () => {
    const { isExportOnlyPlan } = await import('./plans');
    expect(isExportOnlyPlan('starter')).toBe(false);
    expect(isExportOnlyPlan('pro')).toBe(false);
    expect(isExportOnlyPlan('scale')).toBe(false);
  });

  it('is false for free/trial — no paid promise to keep, so the produce gate still applies', async () => {
    const { isExportOnlyPlan } = await import('./plans');
    expect(isExportOnlyPlan(null)).toBe(false);
    expect(isExportOnlyPlan(undefined)).toBe(false);
    expect(isExportOnlyPlan('')).toBe(false);
    expect(isExportOnlyPlan('nonexistent')).toBe(false);
  });

  it('stays derived from ACCOUNT_LIMITS, so a future export tier inherits the behaviour', async () => {
    const { isExportOnlyPlan, accountLimit, ACCOUNT_LIMITS } = await import('./plans');
    for (const [plan, limit] of Object.entries(ACCOUNT_LIMITS)) {
      expect(accountLimit(plan)).toBe(limit);
      expect(isExportOnlyPlan(plan)).toBe(limit === 0);
    }
  });
});

// Un batch di una settimana sola costringeva l'utente ad approvare quattro volte al mese, e
// impediva a una serie di costruire un arco fra un episodio e il successivo. Due settimane sono il
// default; quattro — l'intero ciclo in un colpo — sono una cosa che si vende.
describe('batchWeeks', () => {
  it('due settimane per tutti', () => {
    expect(batchWeeks('go')).toBe(2);
    expect(batchWeeks('starter')).toBe(2);
    expect(batchWeeks(null)).toBe(2);
  });

  it('il pro può pianificare il ciclo intero', () => {
    expect(batchWeeks('pro', 4)).toBe(4);
  });

  it('sotto il pro la richiesta di quattro viene riportata a due', () => {
    expect(batchWeeks('starter', 4)).toBe(2);
  });

  it('non si va mai oltre il ciclo del piano editoriale', () => {
    expect(batchWeeks('pro', 99)).toBe(PLAN_WEEKS);
  });

  it('meno di una settimana non è un batch', () => {
    expect(batchWeeks('pro', 0)).toBe(2);
  });
});
