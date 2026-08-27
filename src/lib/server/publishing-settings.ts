import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Publishing policy — fixed, not configurable.
 *
 * Nothing this product generates reaches a social account or a blog without a human approving
 * that specific piece. There used to be three levels (`manual`, `auto_curated`, `auto_all`) plus a
 * per-account `auto_publish` flag that between them could take an AI-written caption and an
 * AI-generated video all the way to a live post with no person in the loop. They are gone.
 *
 * The reason is legal as much as editorial. Art. 50(2) of the AI Act requires synthetic OUTPUT to
 * be machine-readable as synthetic, but exempts text that has undergone human review where a
 * person or organisation holds editorial responsibility. That exemption is the whole basis on
 * which we do not watermark captions and articles — and it only holds while approval is a real
 * human act on every item. An auto-publish switch would trade the exemption for a convenience.
 * Art. 14 / Art. 26 oversight points the same way: oversight that can be switched off is not
 * oversight.
 *
 * Legacy rows may still carry `content_prefs.publishing.mode` or `social_accounts.auto_publish`.
 * Nothing reads them; they are inert until the columns are dropped.
 *
 * Enforced by the scheduler (src/lib/server/scheduler.ts), which leaves every produced post in
 * `pending_user`, and by publishDueArticles (src/lib/server/blog-generate.ts), which only ever
 * flips articles a human moved to `approved`.
 */
export const PUBLISHING_POLICY = 'review_required' as const;
export type PublishingPolicy = typeof PUBLISHING_POLICY;

export type PublishingAccount = { id: string; platform: string };

/** Active accounts a post can be approved onto, plus the (fixed) policy that governs them. */
export async function getPublishingSettings(
  supabase: SupabaseClient,
  brandId: string
): Promise<{ policy: PublishingPolicy; accounts: PublishingAccount[] }> {
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, platform')
    .eq('brand_id', brandId)
    .eq('status', 'active');

  return {
    policy: PUBLISHING_POLICY,
    accounts: (accounts ?? []).map((a) => ({
      id: String(a.id),
      platform: String(a.platform ?? '')
    }))
  };
}
