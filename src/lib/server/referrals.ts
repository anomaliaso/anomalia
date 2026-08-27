import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase-admin';
import { grantCredits } from './credits';
import { env as publicEnv } from '$env/dynamic/public';

/** Credits gifted to BOTH referrer and referee on first-brand redemption. */
export const REFERRAL_CREDITS_EACH = 500;

export const REFERRAL_COOKIE = 'anomalia_ref';
export const REFERRAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const CODE_RE = /^[a-z0-9]{6,12}$/;

export function isValidReferralCode(raw: string | null | undefined): raw is string {
  return !!raw && CODE_RE.test(raw.toLowerCase());
}

/** Persist `?ref=` into a first-party cookie (call from hooks on marketing/app). */
export function captureReferralCookie(cookies: Cookies, raw: string | null | undefined): void {
  if (!isValidReferralCode(raw)) return;
  cookies.set(REFERRAL_COOKIE, raw.toLowerCase(), {
    path: '/',
    maxAge: REFERRAL_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax'
  });
}

export function clearReferralCookie(cookies: Cookies): void {
  cookies.delete(REFERRAL_COOKIE, { path: '/' });
}

function randomCode(len = 8): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

/**
 * Ensure the user has a referral code. Optionally bind/update the preferred payout brand.
 * Idempotent. Uses service role for insert (no authenticated write policy).
 */
export async function ensureReferralCode(
  userId: string,
  preferredBrandId?: string | null
): Promise<{ code: string; brandId: string | null }> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('referral_codes')
    .select('code, brand_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing?.code) {
    if (preferredBrandId && preferredBrandId !== existing.brand_id) {
      await admin
        .from('referral_codes')
        .update({ brand_id: preferredBrandId })
        .eq('user_id', userId);
      return { code: existing.code as string, brandId: preferredBrandId };
    }
    return { code: existing.code as string, brandId: (existing.brand_id as string | null) ?? null };
  }

  // Retry a few times on unique collisions (extremely rare).
  for (let i = 0; i < 6; i++) {
    const code = randomCode(8);
    const { data, error } = await admin
      .from('referral_codes')
      .insert({
        user_id: userId,
        code,
        brand_id: preferredBrandId ?? null
      })
      .select('code, brand_id')
      .single();
    if (!error && data) {
      return { code: data.code as string, brandId: (data.brand_id as string | null) ?? null };
    }
    if (error?.code !== '23505') {
      console.warn('[referral] ensureReferralCode insert failed:', error?.message);
      break;
    }
  }

  // Race: another request inserted — re-read.
  const { data: again } = await admin
    .from('referral_codes')
    .select('code, brand_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!again?.code) throw new Error('Could not create referral code');
  return { code: again.code as string, brandId: (again.brand_id as string | null) ?? null };
}

/** Public share URL for a code (homepage with ref param). */
export function referralShareUrl(code: string): string {
  const base = (publicEnv.PUBLIC_APP_URL || publicEnv.PUBLIC_FALLBACK_APP_URL || 'https://anomalia.so').replace(/\/$/, '');
  return `${base}/?ref=${encodeURIComponent(code)}`;
}

/** Embeddable HTML badge pointing at the user's referral link. */
export function referralBadgeHtml(code: string): string {
  const href = referralShareUrl(code);
  return `<a href="${href}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:1px solid #e5e5e5;background:#fff;color:#111;text-decoration:none;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:#111;color:#fff;font-size:10px;letter-spacing:-0.04em">0→1</span><span>Made with Anomalia</span></a>`;
}

async function resolveReferrerBrandId(
  admin: SupabaseClient,
  referrerUserId: string,
  preferredBrandId: string | null
): Promise<string | null> {
  if (preferredBrandId) {
    const { data } = await admin
      .from('brands')
      .select('id')
      .eq('id', preferredBrandId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  // Prefer a brand created by the referrer.
  const { data: owned } = await admin
    .from('brands')
    .select('id')
    .eq('created_by', referrerUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (owned?.id) return owned.id as string;

  // Fall back to any brand in an org they own.
  const { data: orgs } = await admin
    .from('organizations')
    .select('id')
    .eq('owner_id', referrerUserId)
    .limit(1);
  const orgId = orgs?.[0]?.id as string | undefined;
  if (!orgId) return null;
  const { data: viaOrg } = await admin
    .from('brands')
    .select('id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (viaOrg?.id as string | undefined) ?? null;
}

export type RedeemResult =
  | { ok: true; creditsEach: number }
  | { ok: false; reason: string };

/**
 * Redeem a referral when a user creates their first brand.
 * Gifts REFERRAL_CREDITS_EACH to both sides via credit_grants. Idempotent / safe to call always.
 */
export async function tryRedeemReferral(opts: {
  cookies: Cookies;
  refereeUserId: string;
  refereeBrandId: string;
}): Promise<RedeemResult> {
  const raw = opts.cookies.get(REFERRAL_COOKIE);
  if (!isValidReferralCode(raw)) return { ok: false, reason: 'no_cookie' };
  const code = raw.toLowerCase();

  const admin = createAdminClient();

  // Already rewarded as referee?
  const { data: prior } = await admin
    .from('referrals')
    .select('id')
    .eq('referee_user_id', opts.refereeUserId)
    .maybeSingle();
  if (prior) {
    clearReferralCookie(opts.cookies);
    return { ok: false, reason: 'already_referred' };
  }

  // Only the referee's first brand earns the gift (avoid farming via brand spam).
  const { count } = await admin
    .from('brands')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', opts.refereeUserId);
  if ((count ?? 0) > 1) {
    clearReferralCookie(opts.cookies);
    return { ok: false, reason: 'not_first_brand' };
  }

  const { data: row } = await admin
    .from('referral_codes')
    .select('user_id, brand_id, code')
    .eq('code', code)
    .maybeSingle();
  if (!row?.user_id) {
    clearReferralCookie(opts.cookies);
    return { ok: false, reason: 'invalid_code' };
  }

  const referrerUserId = row.user_id as string;
  if (referrerUserId === opts.refereeUserId) {
    clearReferralCookie(opts.cookies);
    return { ok: false, reason: 'self_referral' };
  }

  const referrerBrandId = await resolveReferrerBrandId(
    admin,
    referrerUserId,
    (row.brand_id as string | null) ?? null
  );
  if (!referrerBrandId) {
    // Referrer has no brand yet — keep cookie so a later attempt could work if they create one,
    // but don't leave the referee hanging forever: still grant referee-only? Spec says both.
    // Skip until referrer has a brand; keep cookie.
    return { ok: false, reason: 'referrer_no_brand' };
  }

  const creditsEach = REFERRAL_CREDITS_EACH;
  const note = `referral:${code}`;

  try {
    await grantCredits(admin, {
      brandId: referrerBrandId,
      amount: creditsEach,
      note: `${note}:referrer`,
      createdBy: referrerUserId
    });
    await grantCredits(admin, {
      brandId: opts.refereeBrandId,
      amount: creditsEach,
      note: `${note}:referee`,
      createdBy: opts.refereeUserId
    });

    const { error } = await admin.from('referrals').insert({
      referrer_user_id: referrerUserId,
      referee_user_id: opts.refereeUserId,
      code,
      referrer_brand_id: referrerBrandId,
      referee_brand_id: opts.refereeBrandId,
      status: 'credited',
      credits_each: creditsEach,
      credited_at: new Date().toISOString()
    });
    if (error) {
      // Unique race on referee_user_id — treat as already done.
      console.warn('[referral] insert failed:', error.message);
      clearReferralCookie(opts.cookies);
      return { ok: false, reason: 'insert_failed' };
    }

    clearReferralCookie(opts.cookies);
    return { ok: true, creditsEach };
  } catch (e) {
    console.warn('[referral] redeem failed:', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'grant_failed' };
  }
}

/** Look up the referral code for a brand (owner's code), for public blog badge links. */
export async function referralCodeForBrand(brandId: string): Promise<string | null> {
  const admin = createAdminClient();
  // Prefer code bound to this brand; else org owner's / creator's code.
  const { data: bound } = await admin
    .from('referral_codes')
    .select('code')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (bound?.code) return bound.code as string;

  const { data: brand } = await admin
    .from('brands')
    .select('created_by, org_id')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand) return null;

  let ownerId = (brand.created_by as string | null) ?? null;
  if (!ownerId && brand.org_id) {
    const { data: org } = await admin
      .from('organizations')
      .select('owner_id')
      .eq('id', brand.org_id)
      .maybeSingle();
    ownerId = (org?.owner_id as string | null) ?? null;
  }
  if (!ownerId) return null;

  try {
    const ensured = await ensureReferralCode(ownerId, brandId);
    return ensured.code;
  } catch {
    return null;
  }
}
