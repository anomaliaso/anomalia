import type { SupabaseClient } from '@supabase/supabase-js';
import { FREE_CREDITS, PLANS } from '$lib/plans';

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
  // Legacy grandfathered tier — same quota as Pro (scale pays Pro-level pricing).
  scale: 12000
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
  const periodStart = await fetchStripePeriodStart(supabase, brand.id);
  const { start, end } = currentBillingPeriod(brand, periodStart);
  const planQuota = creditQuota(brand.plan);

  // Grants + spend don't depend on each other. Spend is summed in SQL (PostgREST
  // aggregates are disabled — see 0158 / sum_brand_ai_cost_usd).
  const [bonus, { data: spentUsd, error }] = await Promise.all([
    sumActiveCreditGrants(supabase, brand.id),
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

/** Active grants: never-expiring, or expires_at still in the future. */
export async function sumActiveCreditGrants(
  supabase: SupabaseClient,
  brandId: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('credit_grants')
    .select('amount, expires_at')
    .eq('brand_id', brandId);

  if (error) {
    console.warn('[credits] grants query failed:', error.message);
    return 0;
  }

  return (data ?? []).reduce((sum, row) => {
    const exp = row.expires_at as string | null;
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
  // Invalidate the hard-gate cache so the gift is visible immediately.
  gateCache.delete(opts.brandId);
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
 * The real enforcement, moved out of gateCredits() unchanged so the anomalia provider can call
 * it without gateCredits recursing back through itself. Not for direct use — call gateCredits().
 */
export async function gateCreditsCore(brandId: string): Promise<void> {
  // One-time system generation (onboarding pipeline) is exempt — it must always complete and has
  // its own runaway watchdog. Dynamic import dodges any credits↔ai-log init-order cycle.
  const { isCreditExempt } = await import('./ai-log');
  if (isCreditExempt()) return;
  const hit = gateCache.get(brandId);
  if (hit && Date.now() - hit.at < GATE_TTL_MS) {
    assertCreditsAvailable(hit.usage);
    return;
  }
  let usage: CreditsUsage | null = null;
  try {
    const admin = createAdminClient();
    const { data: brand } = await admin
      .from('brands')
      .select('id, plan, activated_at, status')
      .eq('id', brandId)
      .maybeSingle();
    if (!brand) return;
    usage = await getCreditsUsage(admin, brand as Brand);
    gateCache.set(brandId, { usage, at: Date.now() });
  } catch {
    return; // fail-open: cannot evaluate → allow
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
  brandId: string,
  monthKey: string,
  start: Date
): Promise<boolean> {
  const now = new Date().toISOString();
  const { error: insErr } = await supabase
    .from('brand_usage')
    .insert({ brand_id: brandId, month: monthKey, credits_warned_at: now });
  if (!insErr) return true; // la riga del mese non c'era: l'abbiamo creata noi
  const { data } = await supabase
    .from('brand_usage')
    .update({ credits_warned_at: now })
    .eq('brand_id', brandId)
    .eq('month', monthKey)
    .or(`credits_warned_at.is.null,credits_warned_at.lt.${start.toISOString()}`)
    .select('id');
  return !!data?.length;
}

/**
 * Send a one-time email warning when credit usage exceeds 80% of the quota.
 * Uses brand_usage.credits_warned_at for anti-spam: one email per billing period.
 * Fire-and-forget: never throws, never blocks the caller.
 */
export async function maybeSendCreditWarning(
  supabase: SupabaseClient,
  brand: { id: string; name: string; org_id?: string | null; plan?: string | null; slug?: string },
  usage: CreditsUsage
): Promise<void> {
  try {
    if (usage.percent < WARNING_THRESHOLD) return;

    // The billing window is already resolved inside `usage` — reuse it, don't recompute.
    const start = usage.periodStart;
    const monthKey = start.toISOString().slice(0, 10); // YYYY-MM-DD, aligned to brand_usage.month

    // Anti-spam: already warned this period?
    const { data: u } = await supabase
      .from('brand_usage')
      .select('credits_warned_at')
      .eq('brand_id', brand.id)
      .eq('month', monthKey)
      .maybeSingle();

    if (u?.credits_warned_at && new Date(u.credits_warned_at as string) >= start) return; // already sent

    // Resolve recipients
    const contacts = await brandContacts(supabase, brand.org_id ?? '', brand.id);
    if (!contacts.length) return;

    // Si prenota PRIMA di spedire, e solo chi vince la corsa spedisce. La lettura qui sopra da sola
    // bastava finché a chiamare era l'autopilot, uno alla volta; ora chiama anche la rotta crediti,
    // che il layout interroga ogni 45s da ogni scheda aperta — due poll simultanei passavano
    // entrambi il controllo e mandavano due mail. Se poi l'invio fallisce si perde un avviso: è
    // esattamente il compromesso che questa funzione dichiara ("non critico"), al contrario dello spam.
    if (!(await claimCreditWarning(supabase, brand.id, monthKey, start))) return;

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
