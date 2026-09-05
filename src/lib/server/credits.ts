import type { SupabaseClient } from '@supabase/supabase-js';
import { FREE_CREDITS, PLANS } from '$lib/plans';
import { swallow } from '$lib/server/swallow';

// ── AI Credits: consumption tracking per billing period ─────────────────────────
// Every AI call logs cost_usd in ai_calls (tagged by brand_id via the AsyncLocalStorage
// context). This module sums those costs into "credits" (100 credits = $1 USD) and enforces
// the per-plan monthly quota. Every model is stored at 100% of list — Gemini Flash and Nano
// Banana Pro carried a per-plan discount until 2026-08 and no longer do, so the same quota now
// buys fewer looks and fewer stills. Quotas were NOT adjusted for this; that is a separate call.

export type Brand = {
  id: string;
  plan: string | null;
  activated_at: string | null;
  status: string;
};

export type CreditsUsage = {
  used: number;       // credits consumed this period (rounded)
  quota: number;      // plan quota + active grants
  bonus: number;      // sum of active credit_grants
  remaining: number;  // max(0, quota - used)
  periodStart: Date;
  periodEnd: Date;    // periodStart + 1 month
  percent: number;    // used / quota * 100
};

// ── Plan quotas ──────────────────────────────────────────────────────────────────
// Free (no plan): 400 credits ≈ €10 of API value. Paid tiers share credits with
// src/lib/plans.ts (PlanCards / pricing) so UI and entitlement cannot drift.
// `scale` (legacy grandfathered tier, not in PLANS) is mapped to the Pro quota
// explicitly so it never falls back to the free grant.
const CREDIT_QUOTAS: Record<string, number> = {
  '': FREE_CREDITS,
  ...Object.fromEntries(PLANS.map((p) => [p.key, p.credits])),
  // Legacy grandfathered tier — stessa quota di Pro (scale paga come Pro). Agganciato alla voce di
  // Pro e non a una cifra copiata: quando il prezzo di Pro cambia, questa lo segue.
  scale: PLANS.find((p) => p.key === 'pro')?.credits ?? FREE_CREDITS
};

export function creditQuota(plan: string | null | undefined): number {
  return CREDIT_QUOTAS[plan ?? ''] ?? FREE_CREDITS;
}

// ── Date helpers ─────────────────────────────────────────────────────────────────

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()));
}

/**
 * Find the start of the current billing period: the most recent monthly anniversary of
 * `anchor` that is <= `now`. E.g. anchor = Jan 15, now = Mar 3 → start = Feb 15.
 */
function shiftToAnchor(anchor: Date, now: Date): Date {
  const anchorDay = anchor.getUTCDate();
  // Start from the anchor's month in the same year, then walk forward until we pass `now`.
  let candidate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchorDay));
  // If candidate is in the future relative to now, we need to go back.
  // But it's easier to walk forward from (now - 1 month) to find the right period.
  // Strategy: compute the month difference, then verify.
  const nowTime = now.getTime();
  // Fast path: anchor is in the current month and already passed.
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), anchorDay));
  if (thisMonth.getTime() <= nowTime) return thisMonth;
  // Otherwise the period started last month.
  return addMonths(thisMonth, -1);
}

// ── Billing period ───────────────────────────────────────────────────────────────

/**
 * Current billing window: [period anchor, +1 month).
 * The anchor comes from Stripe (read live via the brand_billing_period RPC — annual plans
 * report a year-long item period, so shiftToAnchor normalises to the monthly anniversary).
 * Falls back to activated_at if there's no synced subscription, then to calendar month start.
 */
export function currentBillingPeriod(
  brand: Pick<Brand, 'activated_at'>,
  stripePeriodStart?: Date | null
): { start: Date; end: Date } {
  const anchor = stripePeriodStart
    ?? (brand.activated_at ? new Date(brand.activated_at) : monthStart(new Date()));
  const start = shiftToAnchor(anchor, new Date());
  const end = addMonths(start, 1);
  return { start, end };
}

/**
 * Billing period anchor from the synced stripe.subscriptions table (security-definer RPC,
 * migration 0089). Null when the brand has no active subscription — callers fall back.
 * Cached 5 min per isolate: the anniversary does not move mid-request storm, and remaining()
 * is also called from calendar/plan/editorial on top of the layout deferred path.
 */
const STRIPE_PERIOD_TTL_MS = 5 * 60_000;
const stripePeriodByBrand = new Map<string, { value: Date | null; at: number }>();

export async function fetchStripePeriodStart(
  supabase: SupabaseClient,
  brandId: string
): Promise<Date | null> {
  const hit = stripePeriodByBrand.get(brandId);
  if (hit && Date.now() - hit.at < STRIPE_PERIOD_TTL_MS) return hit.value;

  const { data, error } = await supabase
    .rpc('brand_billing_period', { _brand_id: brandId })
    .maybeSingle<{ period_start: string | null; period_end: string | null }>();
  if (error) return null;
  const value = data?.period_start ? new Date(data.period_start) : null;
  stripePeriodByBrand.set(brandId, { value, at: Date.now() });
  return value;
}

// ── Org scope ────────────────────────────────────────────────────────────────────
// One subscription belongs to an ORGANIZATION and covers every brand under it, so the pool a
// brand spends from is the org's. The rollout is org-by-org: an org that has not had its turn
// yet carries nothing, and its paying brand still holds the plan, the subscription and the
// period — so every read is org-first and falls back to that brand. Both shapes answer the
// same numbers, which is what lets the migration run one org at a time.

export type OrgBilling = {
  orgId: string;
  /** organizations.plan, or the plan of whichever brand of the org still carries the subscription. */
  plan: string | null;
  activatedAt: string | null;
  /** The org's brand holding a subscription — the period source until the org has its own. */
  billingBrandId: string | null;
  brandIds: string[];
};

type OrgBrandRow = {
  id: string;
  plan: string | null;
  activated_at: string | null;
  stripe_subscription_id: string | null;
};

type OrgRow = {
  id: string;
  plan: string | null;
  activated_at: string | null;
  stripe_subscription_id: string | null;
  brands?: OrgBrandRow[];
};

const orgBillingByBrand = new Map<string, { value: OrgBilling | null; at: number }>();

/** The org a brand bills through, with plan and period source resolved for both rollout states. */
export async function resolveOrgBilling(
  supabase: SupabaseClient,
  brandId: string
): Promise<OrgBilling | null> {
  const hit = orgBillingByBrand.get(brandId);
  if (hit && Date.now() - hit.at < STRIPE_PERIOD_TTL_MS) return hit.value;

  const value = await readOrgBilling(supabase, brandId);
  orgBillingByBrand.set(brandId, { value, at: Date.now() });
  return value;
}

async function readOrgBilling(
  supabase: SupabaseClient,
  brandId: string
): Promise<OrgBilling | null> {
  const { data: brand } = await supabase
    .from('brands')
    .select('org_id')
    .eq('id', brandId)
    .maybeSingle();
  const orgId = (brand as { org_id?: string } | null)?.org_id;
  if (!orgId) return null;

  return readOrgBillingById(supabase, orgId);
}

/** The same reading for a caller that already holds the org and has no brand to reach it through. */
export async function readOrgBillingById(
  supabase: SupabaseClient,
  orgId: string
): Promise<OrgBilling | null> {
  const { data } = await supabase
    .from('organizations')
    .select(
      'id, plan, activated_at, stripe_subscription_id, brands(id, plan, activated_at, stripe_subscription_id)'
    )
    .eq('id', orgId)
    .maybeSingle();
  const org = data as OrgRow | null;
  if (!org) return null;

  const brands = org.brands ?? [];
  // At most one brand of an org pays (no customer holds two subscriptions), but pick by quota
  // rather than by arrival order so a stray second one can never shrink the pool.
  const paying = brands
    .filter((b) => b.stripe_subscription_id && b.plan)
    .sort((a, b) => creditQuota(b.plan) - creditQuota(a.plan))[0];

  return {
    orgId: org.id,
    plan: org.plan ?? paying?.plan ?? null,
    activatedAt: org.activated_at ?? paying?.activated_at ?? null,
    billingBrandId: org.stripe_subscription_id ? null : (paying?.id ?? null),
    brandIds: brands.map((b) => b.id)
  };
}

/** The plan the org bills on, for a caller holding only a brand id. */
export async function orgPlanForBrand(
  supabase: SupabaseClient,
  brandId: string
): Promise<string | null> {
  return (await resolveOrgBilling(supabase, brandId))?.plan ?? null;
}

const orgPeriodByOrg = new Map<string, { value: Date | null; at: number }>();

/** Period anchor for the org: its own subscription first, its paying brand's while it waits. */
async function fetchOrgPeriodStart(
  supabase: SupabaseClient,
  org: OrgBilling
): Promise<Date | null> {
  const hit = orgPeriodByOrg.get(org.orgId);
  if (hit && Date.now() - hit.at < STRIPE_PERIOD_TTL_MS) return hit.value;

  const { data, error } = await supabase
    .rpc('org_billing_period', { _org_id: org.orgId })
    .maybeSingle<{ period_start: string | null }>();
  let value = !error && data?.period_start ? new Date(data.period_start) : null;
  if (!value && org.billingBrandId) {
    value = await fetchStripePeriodStart(supabase, org.billingBrandId);
  }
  orgPeriodByOrg.set(org.orgId, { value, at: Date.now() });
  return value;
}

// ── Usage query ──────────────────────────────────────────────────────────────────

const CREDITS_PER_USD = 100;

/**
 * Sum cost_usd × 100 from ai_calls in the current billing period for this brand.
 * Only rows with a non-null cost_usd and brand_id are counted (excludes exempt/dev calls).
 * Active credit_grants boost the quota (one-time / time-bound extras).
 * Spend is summed in SQL (`sum_brand_ai_cost_usd`); grants run in parallel with that RPC.
 */
export async function getCreditsUsage(
  supabase: SupabaseClient,
  brand: Brand
): Promise<CreditsUsage> {
  const org = await resolveOrgBilling(supabase, brand.id);
  // No org in reach (a brand row that isn't there, or a read that failed): answer for the brand
  // alone, exactly as before org-level billing. Never leave a caller without a budget.
  if (!org) return brandCreditsUsage(supabase, brand);

  return orgCreditsUsage(supabase, org, brand.activated_at);
}

/**
 * The pool as the org sees it. Split out of getCreditsUsage unchanged: a brand-free render has
 * no brand row to carry an anchor, and everything below the org already ignored the brand.
 */
export async function orgCreditsUsage(
  supabase: SupabaseClient,
  org: OrgBilling,
  activatedAtFallback: string | null = null
): Promise<CreditsUsage> {
  const periodStart = await fetchOrgPeriodStart(supabase, org);
  const { start, end } = currentBillingPeriod(
    { activated_at: org.activatedAt ?? activatedAtFallback },
    periodStart
  );
  const planQuota = creditQuota(org.plan);

  // Grants + spend don't depend on each other. Spend is summed in SQL (PostgREST
  // aggregates are disabled — see 0158 / sum_org_ai_cost_usd).
  const [bonus, { data: spentUsd, error }] = await Promise.all([
    sumActiveCreditGrants(supabase, org),
    supabase.rpc('sum_org_ai_cost_usd', {
      p_org_id: org.orgId,
      p_start: start.toISOString(),
      p_end: end.toISOString()
    })
  ]);
  const quota = planQuota + bonus;

  if (error) {
    console.warn('[credits] query failed:', error.message);
    return { used: 0, quota, bonus, remaining: quota, periodStart: start, periodEnd: end, percent: 0 };
  }

  const used = Math.round(Number(spentUsd ?? 0) * CREDITS_PER_USD);
  return {
    used,
    quota,
    bonus,
    remaining: Math.max(0, quota - used),
    periodStart: start,
    periodEnd: end,
    percent: quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
  };
}

/** The brand-only reading, kept whole for the case where no org can be resolved. */
async function brandCreditsUsage(
  supabase: SupabaseClient,
  brand: Brand
): Promise<CreditsUsage> {
  const periodStart = await fetchStripePeriodStart(supabase, brand.id);
  const { start, end } = currentBillingPeriod(brand, periodStart);
  const planQuota = creditQuota(brand.plan);

  const [bonus, { data: spentUsd, error }] = await Promise.all([
    sumGrantRows(supabase, (q) => q.eq('brand_id', brand.id)),
    supabase.rpc('sum_brand_ai_cost_usd', {
      p_brand_id: brand.id,
      p_start: start.toISOString(),
      p_end: end.toISOString()
    })
  ]);
  const quota = planQuota + bonus;

  if (error) {
    console.warn('[credits] query failed:', error.message);
    return { used: 0, quota, bonus, remaining: quota, periodStart: start, periodEnd: end, percent: 0 };
  }

  const used = Math.round(Number(spentUsd ?? 0) * CREDITS_PER_USD);
  return {
    used,
    quota,
    bonus,
    remaining: Math.max(0, quota - used),
    periodStart: start,
    periodEnd: end,
    percent: quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0
  };
}

/**
 * Active grants for the whole org: the ones handed to the org itself, plus the ones handed to
 * any of its brands. A grant names one or the other (migration 20260903190000's check
 * constraint), and both land in the same shared pool.
 */
export async function sumActiveCreditGrants(
  supabase: SupabaseClient,
  org: OrgBilling
): Promise<number> {
  const [orgGrants, brandGrants] = await Promise.all([
    sumGrantRows(supabase, (q) => q.eq('org_id', org.orgId)),
    org.brandIds.length
      ? sumGrantRows(supabase, (q) => q.in('brand_id', org.brandIds))
      : Promise.resolve(0)
  ]);
  return orgGrants + brandGrants;
}

/** Active: never-expiring, or expires_at still in the future. */
async function sumGrantRows(
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  filter: (q: any) => any
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await filter(
    supabase.from('credit_grants').select('amount, expires_at')
  );

  if (error) {
    console.warn('[credits] grants query failed:', error.message);
    return 0;
  }

  return ((data ?? []) as { amount: unknown; expires_at: string | null }[]).reduce((sum, row) => {
    const exp = row.expires_at;
    if (exp && exp <= now) return sum;
    const n = Number(row.amount);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

// ── Enforcement ──────────────────────────────────────────────────────────────────

export class CreditsExhaustedError extends Error {
  public usage: CreditsUsage;
  constructor(usage: CreditsUsage) {
    super('AI credits exhausted for this billing period');
    this.name = 'CreditsExhaustedError';
    this.usage = usage;
  }
}

/**
 * Gate: throws CreditsExhaustedError if no credits remain.
 * Call before any AI chokepoint to enforce the quota.
 */
export function assertCreditsAvailable(usage: CreditsUsage): void {
  if (usage.remaining <= 0) {
    throw new CreditsExhaustedError(usage);
  }
}

// ── Self-contained hard gate ─────────────────────────────────────────────────────
// The runaway-spend circuit breaker (incident 2026-07-13: one crash-looping onboarding job
// burned ~$365 in 42h). Called at the top of every expensive flow AND inside renderImage —
// the costly chokepoint — so even a loop nobody anticipated stops at the quota.
// Fail-OPEN by design: a billing outage must never take the product down. The 60s per-brand
// cache bounds the DB overhead to ~3 queries per brand per minute.

import { createAdminClient } from './supabase-admin';

const gateCache = new Map<string, { usage: CreditsUsage; at: number }>();
const GATE_TTL_MS = 60_000;

/**
 * Insert a credit_grants row (quota boost). Service-role client required —
 * there is no authenticated insert policy on credit_grants.
 */
export async function grantCredits(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    amount: number;
    note?: string | null;
    createdBy?: string | null;
    expiresAt?: string | null;
  }
): Promise<void> {
  const amount = Math.floor(Number(opts.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('grantCredits: amount must be a positive integer');
  }
  const { error } = await supabase.from('credit_grants').insert({
    brand_id: opts.brandId,
    amount,
    note: opts.note ?? null,
    created_by: opts.createdBy ?? null,
    expires_at: opts.expiresAt ?? null
  });
  if (error) throw new Error(`grantCredits failed: ${error.message}`);
  // Invalidate the hard-gate cache so the gift is visible immediately. The gate keys on the org
  // now, so the entry to drop is the org's — the gift lands in the pool all its brands share.
  const org = await resolveOrgBilling(supabase, opts.brandId);
  gateCache.delete(org?.orgId ?? opts.brandId);
}

/**
 * The 29 call sites (17 direct + 12 via cli-auth.ts's gateAiAction) all call THIS function,
 * unchanged — it's the chokepoint. It delegates to the billing provider: the open provider's
 * gate() is a no-op, the anomalia provider's gate() calls gateCreditsCore below (the real,
 * unrewritten enforcement). Dynamic import dodges a credits↔billing↔credits init-order cycle
 * (same trick already used below for ai-log).
 */
export async function gateCredits(brandId: string): Promise<void> {
  const { billingProvider } = await import('./billing');
  const provider = await billingProvider();
  await provider.gate('credits', { brandId });
}

/**
 * Both fail-open paths below give up on the same thing — evaluating the ledger — and both let the
 * action through on purpose: a transient Supabase error must not block a paying customer. Neither
 * may do it silently. Unmetered AI nobody is told about is exactly how a week of it went unnoticed.
 */
function reportFailOpen(brandId: string, err: unknown): void {
  swallow(`credits: allowed brand ${brandId} without evaluating its ledger`, err);
}

/**
 * The real enforcement, moved out of gateCredits() unchanged so the anomalia provider can call
 * it without gateCredits recursing back through itself. Not for direct use — call gateCredits().
 */
export async function gateCreditsCore(brandId: string): Promise<void> {
  // One-time system generation (onboarding pipeline) is exempt — it must always complete and has
  // its own runaway watchdog. Dynamic import dodges any credits↔ai-log init-order cycle.
  const { isCreditExempt } = await import('./ai-log');
  if (isCreditExempt()) return;

  // The pool is the org's, so the cache entry is too: every brand under an org reads and refreshes
  // the same one, instead of each paying for its own copy of the same numbers.
  let admin: SupabaseClient | null = null;
  let cacheKey = brandId;
  try {
    admin = createAdminClient();
    const org = await resolveOrgBilling(admin, brandId);
    if (org) cacheKey = org.orgId;
  } catch (e) {
    reportFailOpen(brandId, e);
    return;
  }

  // Outside the try on purpose: a denial here is the gate doing its job, and must not be
  // swallowed by the fail-open catch below.
  const hit = gateCache.get(cacheKey);
  if (hit && Date.now() - hit.at < GATE_TTL_MS) {
    assertCreditsAvailable(hit.usage);
    return;
  }

  let usage: CreditsUsage | null = null;
  try {
    const { data: brand } = await admin
      .from('brands')
      .select('id, plan, activated_at, status')
      .eq('id', brandId)
      .maybeSingle();
    if (!brand) return;
    usage = await getCreditsUsage(admin, brand as Brand);
    gateCache.set(cacheKey, { usage, at: Date.now() });
  } catch (e) {
    reportFailOpen(brandId, e);
    return;
  }
  assertCreditsAvailable(usage);
}

// ── Soft warning email (>80%) ──────────────────────────────────────────────────

const WARNING_THRESHOLD = 80;

import { env as publicEnv } from '$env/dynamic/public';
import { brandContacts } from './scheduler';
import { creditWarningEmailSubject, creditWarningEmailHtml, creditWarningEmailText } from './email';

/**
 * Segna `credits_warned_at` per questo periodo e dice se il claim è nostro. È l'unico lucchetto:
 * il vincolo unico (brand_id, month) fa perdere il secondo INSERT, e l'UPDATE tocca solo una riga
 * non ancora marcata in questo periodo. True = tocca a noi mandare la mail.
 */
async function claimCreditWarning(
  supabase: SupabaseClient,
  orgId: string,
  monthKey: string,
  start: Date
): Promise<boolean> {
  const now = new Date().toISOString();
  const { error: insErr } = await supabase
    .from('org_usage')
    .insert({ org_id: orgId, month: monthKey, credits_warned_at: now });
  if (!insErr) return true; // la riga del mese non c'era: l'abbiamo creata noi
  const { data } = await supabase
    .from('org_usage')
    .update({ credits_warned_at: now })
    .eq('org_id', orgId)
    .eq('month', monthKey)
    .or(`credits_warned_at.is.null,credits_warned_at.lt.${start.toISOString()}`)
    .select('id');
  return !!data?.length;
}

/**
 * Send a one-time email warning when credit usage exceeds 80% of the quota.
 * Uses org_usage.credits_warned_at for anti-spam: one email per billing period, per org.
 * Fire-and-forget: never throws, never blocks the caller.
 */
export async function maybeSendCreditWarning(
  supabase: SupabaseClient,
  brand: { id: string; name: string; org_id?: string | null; plan?: string | null; slug?: string },
  usage: CreditsUsage
): Promise<void> {
  try {
    if (usage.percent < WARNING_THRESHOLD) return;

    // One pool, one warning: the anti-spam flag lives on the org, so an org with five brands
    // gets one email when the shared pool crosses the threshold, not five identical ones.
    const orgId = brand.org_id ?? (await resolveOrgBilling(supabase, brand.id))?.orgId;
    if (!orgId) return;

    // The billing window is already resolved inside `usage` — reuse it, don't recompute.
    const start = usage.periodStart;
    const monthKey = start.toISOString().slice(0, 10); // YYYY-MM-DD, aligned to org_usage.month

    // Anti-spam: already warned this period?
    const { data: u } = await supabase
      .from('org_usage')
      .select('credits_warned_at')
      .eq('org_id', orgId)
      .eq('month', monthKey)
      .maybeSingle();

    if (u?.credits_warned_at && new Date(u.credits_warned_at as string) >= start) return; // already sent

    // Resolve recipients
    const contacts = await brandContacts(supabase, orgId, brand.id);
    if (!contacts.length) return;

    // Si prenota PRIMA di spedire, e solo chi vince la corsa spedisce. La lettura qui sopra da sola
    // bastava finché a chiamare era l'autopilot, uno alla volta; ora chiama anche la rotta crediti,
    // che il layout interroga ogni 45s da ogni scheda aperta — due poll simultanei passavano
    // entrambi il controllo e mandavano due mail. Se poi l'invio fallisce si perde un avviso: è
    // esattamente il compromesso che questa funzione dichiara ("non critico"), al contrario dello spam.
    if (!(await claimCreditWarning(supabase, orgId, monthKey, start))) return;

    const appBase = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
    const dashboardUrl = brand.slug ? `${appBase}/app/${brand.slug}` : appBase;

    const { notifyBrandContacts } = await import('$lib/server/brand-notify');
    await notifyBrandContacts(supabase, contacts, {
      logPrefix: '[credits]',
      buildEmail: (locale, to) => ({
        to,
        subject: creditWarningEmailSubject(locale, brand.name, usage.percent),
        html: creditWarningEmailHtml(locale, {
          percent: usage.percent,
          used: usage.used,
          quota: usage.quota,
          resetDate: usage.periodEnd,
          brandName: brand.name,
          dashboardUrl
        }),
        text: creditWarningEmailText(locale, {
          percent: usage.percent,
          used: usage.used,
          quota: usage.quota,
          resetDate: usage.periodEnd,
          brandName: brand.name,
          dashboardUrl
        })
      }),
      push: dashboardUrl
        ? { url: dashboardUrl, tag: `credits-${brand.id}` }
        : undefined
    });
  } catch (e) {
    // Warning is non-critical — never break the caller
    console.warn('[credits] maybeSendCreditWarning failed:', e instanceof Error ? e.message : e);
  }
}
