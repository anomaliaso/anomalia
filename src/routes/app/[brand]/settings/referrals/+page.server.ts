import type { PageServerLoad } from './$types';
import {
  ensureReferralCode,
  referralBadgeHtml,
  referralShareUrl,
  REFERRAL_CREDITS_EACH
} from '$lib/server/referrals';
import { createAdminClient } from '$lib/server/supabase-admin';

export const load: PageServerLoad = async ({ parent, locals: { safeGetSession } }) => {
  const { brand, isOwner } = await parent();
  const { user } = await safeGetSession();
  if (!user) {
    return {
      isOwner,
      code: null,
      shareUrl: null,
      badgeHtml: null,
      creditsEach: REFERRAL_CREDITS_EACH,
      stats: { invited: 0, credited: 0, creditsEarned: 0 },
      recent: [] as Array<{
        id: string;
        status: string;
        credits_each: number;
        created_at: string;
        credited_at: string | null;
      }>
    };
  }

  const { code } = await ensureReferralCode(user.id, brand.id);
  const shareUrl = referralShareUrl(code);
  const badgeHtml = referralBadgeHtml(code);

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from('referrals')
    .select('id, status, credits_each, created_at, credited_at')
    .eq('referrer_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const recent = rows ?? [];
  const credited = recent.filter((r) => r.status === 'credited');
  const creditsEarned = credited.reduce((s, r) => s + Number(r.credits_each ?? 0), 0);

  return {
    isOwner,
    code,
    shareUrl,
    badgeHtml,
    creditsEach: REFERRAL_CREDITS_EACH,
    stats: {
      invited: recent.length,
      credited: credited.length,
      creditsEarned
    },
    recent
  };
};
