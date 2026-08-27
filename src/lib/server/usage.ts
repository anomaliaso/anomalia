import type { SupabaseClient } from '@supabase/supabase-js';
import { VIDEO_SHARE } from './plans';
import { getCreditsUsage, type Brand as CreditsBrand, type CreditsUsage } from './credits';

// Per-brand monthly quota tracking (table brand_usage, migration 0014). The month is
// anchored to the brand's wall-clock timezone so a brand near a date line rolls over on
// its own local 1st, not UTC's — matching how schedule.ts derives wall-clock via Intl.

// Returns the first day of the brand's current local month as a YYYY-MM-01 date string.
// We read year/month in `tz` via Intl, then force day 01 — no date library, and stable
// regardless of the server's own timezone.
export function monthKey(tz: string, now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit'
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-01`;
}

export type Usage = { posts_count: number; videos_count: number };

// UTC timestamp marking the first instant of the brand's current local month. We build the
// local midnight on the 1st, then read it back in UTC so the created_at (timestamptz) filter
// aligns with the brand's wall-clock month — e.g. July 1st 00:00 Europe/Rome → Jun 30 22:00Z.
export function monthStartUTC(tz: string, now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  // Construct "now" expressed in the target tz, then force day=01, 00:00:00 in that tz.
  const localMonthStart = `${p.year}-${p.month}-01T00:00:00`;
  // Interpret that wall-clock as the brand tz, then convert to a UTC ISO string.
  const utc = new Date(localMonthStart + 'Z');
  // utc is "YYYY-MM-01T00:00:00Z" (wrong tz). We need to shift by the tz offset. Compute the
  // offset (in minutes) of the brand tz at that wall-clock, then add it.
  const offsetMs = tzOffsetMinutes(tz, utc);
  return new Date(utc.getTime() - offsetMs * 60000).toISOString();
}

// Offset (minutes) of `tz` from UTC at the given instant. Positive = ahead of UTC (e.g. +120 for Rome in summer).
function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asWrittenUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asWrittenUTC - at.getTime()) / 60000);
}

// Current counts for a brand/month. Absent row → zeroed (no usage yet this month).
export async function getUsage(
  supabase: SupabaseClient,
  brandId: string,
  month: string
): Promise<Usage> {
  const { data } = await supabase
    .from('brand_usage')
    .select('posts_count, videos_count')
    .eq('brand_id', brandId)
    .eq('month', month)
    .maybeSingle();
  return {
    posts_count: data?.posts_count ?? 0,
    videos_count: data?.videos_count ?? 0
  };
}

// Increment this month's counters. Read-then-upsert: the unique(brand_id, month)
// constraint makes the upsert collapse onto the existing row, and we carry the prior
// counts forward so concurrent low-volume generations stay close to correct. (A single
// brand rarely generates in parallel, so we accept eventual consistency over a DB function.)
export async function addUsage(
  supabase: SupabaseClient,
  brandId: string,
  month: string,
  delta: { posts?: number; videos?: number }
): Promise<void> {
  const posts = delta.posts ?? 0;
  const videos = delta.videos ?? 0;
  if (posts === 0 && videos === 0) return;

  const current = await getUsage(supabase, brandId, month);
  await supabase.from('brand_usage').upsert(
    {
      brand_id: brandId,
      month,
      posts_count: current.posts_count + posts,
      videos_count: current.videos_count + videos,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'brand_id,month' }
  );
}

export type Remaining = {
  posts: number; // posts left before the hard cap (clamped at 0)
  videos: number; // internal video guardrail headroom (clamped at 0)
  postsUsed: number;
  videosUsed: number;
  postsQuota: number;
  videosCap: number;
  credits: CreditsUsage; // AI credit budget for the current billing period
};

// How much of this month's plan budget is left for a brand. Drives both the generate
// gate/clamp and the Content-page indicator. Posts are counted from the actual posts table
// (source of truth) rather than the brand_usage counter, which drifted whenever posts were
// created outside the generate/scheduler/activate paths (chat, weekly-plan, onboarding, radar).
// Videos still rely on brand_usage since they're a subset not directly queryable from posts.
// Pass `brand` (with activated_at) for accurate credit tracking; if omitted, credits fall back
// to a minimal brand shape (the billing period is read live from stripe.subscriptions anyway).
export async function remaining(
  supabase: SupabaseClient,
  brandId: string,
  plan: string | null | undefined,
  tz: string,
  brand?: CreditsBrand
): Promise<Remaining> {
  const month = monthKey(tz);
  const { billingProvider } = await import('./billing');
  const provider = await billingProvider();
  const postsQuota = await provider.quota('posts', { brandId, plan: plan ?? null });
  // Same formula plans.ts's videoCap() uses (round(postQuota * VIDEO_SHARE)) — derived from the
  // provider's posts quota so it inherits Infinity under the open provider without a second
  // 'videos' QuotaKind the contract doesn't otherwise need.
  const videosCap = Math.round(postsQuota * VIDEO_SHARE);

  // Count real posts created this month (failed posts never consumed AI generation cost
  // in the insert path, so exclude them). created_at is compared against the month start —
  // near-month-boundary posts may land in either bucket depending on tz, an acceptable
  // rounding for a monthly quota counter.
  const monthStart = monthStartUTC(tz);
  // Neither read depends on the other — run them together instead of paying two round-trips.
  const brandForCredits: CreditsBrand = brand ?? { id: brandId, plan: plan ?? null, activated_at: null, status: 'active' };
  const [videoUsage, { count }, credits] = await Promise.all([
    getUsage(supabase, brandId, month),
    supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('created_at', monthStart)
      .neq('status', 'failed'),
    getCreditsUsage(supabase, brandForCredits)
  ]);

  const postsUsed = count ?? 0;
  // Open provider: the credits usage read above is real (kept for a "how much did this cost"
  // dashboard, which stays (c) — pure accounting), but nothing should ever read as exhausted.
  const creditsForBudget: CreditsUsage =
    provider.kind === 'open' ? { ...credits, quota: Infinity, remaining: Infinity } : credits;
  return {
    posts: Math.max(0, postsQuota - postsUsed),
    videos: Math.max(0, videosCap - videoUsage.videos_count),
    postsUsed,
    videosUsed: videoUsage.videos_count,
    postsQuota,
    videosCap,
    credits: creditsForBudget
  };
}
