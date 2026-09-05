import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';

// Anti-abuse / cost guard: a user may keep at most this many NON-PAYING slots at once — counting
// both in-progress onboarding drafts and brands that aren't actively subscribed (trial / paused /
// canceled). Paying ('active') brands don't count and are unlimited. Each non-paying slot can run
// generations on our dime, so we cap how many a single account can hold without subscribing.
export const NON_PAYING_SLOT_LIMIT = 2;

// Internal accounts (founder + Marco) are exempt from the non-paying cap entirely — they can keep
// unlimited brands/drafts for demos and testing. Compared case-insensitively. Keep this list tiny
// and explicit: it's a deliberate per-account override, not a plan tier.
// Da env, per chiamata (igiene open source — vedi internal-users.ts).
const unlimitedSlotEmails = () =>
  new Set(
    (env.UNLIMITED_SLOT_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );

export function hasUnlimitedSlots(email: string | null | undefined): boolean {
  return !!email && unlimitedSlotEmails().has(email.toLowerCase());
}

// Count the user's non-paying slots = onboarding drafts + non-'active' brands. The brands query is
// scoped to the user's org by RLS (same as everywhere else). `excludeDraftId` drops one draft from
// the tally — used at onboarding completion, where the draft being turned into a (trial) brand is a
// net-zero move and must not be double-counted against the cap.
export async function nonPayingSlotCount(
  supabase: SupabaseClient,
  userId: string,
  opts: { excludeDraftId?: string } = {}
): Promise<number> {
  let draftQuery = supabase
    .from('onboarding_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (opts.excludeDraftId) draftQuery = draftQuery.neq('id', opts.excludeDraftId);

  const [{ count: draftCount }, { count: brandCount }] = await Promise.all([
    draftQuery,
    supabase.from('brands').select('id', { count: 'exact', head: true }).neq('status', 'active')
  ]);
  return (draftCount ?? 0) + (brandCount ?? 0);
}

// Whether the user still has room to start a NEW non-paying slot (new draft / new brand).
export async function canStartNewSlot(
  supabase: SupabaseClient,
  userId: string,
  opts: { excludeDraftId?: string; email?: string | null } = {}
): Promise<boolean> {
  // Exempt accounts skip the cap (and the count query) altogether.
  if (hasUnlimitedSlots(opts.email)) return true;
  return (await nonPayingSlotCount(supabase, userId, opts)) < NON_PAYING_SLOT_LIMIT;
}

// ── Pre-payment generation gate ──────────────────────────────────────────────────────────────
// The new onboarding runs the (expensive, image-heavy) generation BEFORE checkout, so a bot that
// creates an account and pastes a URL would burn our money. NON_PAYING_SLOT_LIMIT caps concurrent
// slots; this caps total generations per rolling 24h and requires a verified email — together they
// close the create→generate→delete→repeat loop. Wired at the generation kick (not at slot start).
export const DAILY_ONBOARDING_GEN_LIMIT = 3;

export type OnboardingGate = { ok: true } | { ok: false; reason: 'email_unverified' | 'daily_limit' };

// Pure decision — exported for tests. Exempt accounts always pass; everyone else needs a confirmed
// email and must stay under the daily cap.
export function onboardingGateDecision(input: {
  email?: string | null;
  emailConfirmedAt?: string | null;
  generationsToday: number;
}): OnboardingGate {
  if (hasUnlimitedSlots(input.email)) return { ok: true };
  if (!input.emailConfirmedAt) return { ok: false, reason: 'email_unverified' };
  if (input.generationsToday >= DAILY_ONBOARDING_GEN_LIMIT) return { ok: false, reason: 'daily_limit' };
  return { ok: true };
}

// Brands this user created in the last 24h — daily onboarding cost proxy (replaces counting
// legacy onboarding_jobs rows, which are no longer enqueued).
export async function onboardingGenerationsToday(supabase: SupabaseClient, userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('brands')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', userId)
    .gte('created_at', since);
  return count ?? 0;
}

