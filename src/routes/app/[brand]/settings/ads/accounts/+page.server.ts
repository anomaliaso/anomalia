import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { adsAvailable, adsFeatureEnabled, syncAdAccounts } from '$lib/server/ads';

export const load: PageServerLoad = async ({ parent, locals: { supabase, safeGetSession }, url }) => {
  const { brand } = await parent();
  const { user } = await safeGetSession();
  if (!adsFeatureEnabled(user?.email)) throw error(404, 'Not found');
  const adsEnabled = adsAvailable(brand.plan, user?.email);

  const readAccounts = async () =>
    adsEnabled
      ? (
          await supabase
            .from('zernio_ad_accounts')
            .select('id, platform, name, currency, status, unusable_reason, zernio_ad_account_id, connected_at')
            .eq('brand_id', brand.id)
            .order('connected_at', { ascending: false })
        ).data
      : [];

  let adAccounts = await readAccounts();

  const { data: socials } = await supabase
    .from('social_accounts')
    .select('id, platform, username, status')
    .eq('brand_id', brand.id)
    .eq('status', 'active');

  // After OAuth, Zernio has a fresh token — sync so Meta/Google ad accounts land in the DB. Also
  // sync when we have nothing stored: the page whose job is listing ad accounts should not show an
  // empty state that the user has to press a button to disprove.
  let autoSynced: number | null = null;
  if (adsEnabled && (url.searchParams.get('connected') === '1' || !adAccounts?.length)) {
    try {
      autoSynced = await syncAdAccounts(supabase, brand);
      if (autoSynced) adAccounts = await readAccounts();
    } catch {
      autoSynced = null;
    }
  }

  return {
    adsEnabled,
    adAccounts: adAccounts ?? [],
    socials: socials ?? [],
    hasFacebook: (socials ?? []).some((s) => s.platform === 'facebook'),
    autoSynced
  };
};

export const actions: Actions = {
  sync: async ({ locals: { supabase, safeGetSession }, params }) => {
    const { user } = await safeGetSession();
    const { data: brand } = await supabase
      .from('brands')
      .select('id, plan, zernio_profile_id, ads_settings')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    if (!adsAvailable(brand.plan, user?.email)) return fail(403, { error: 'Ads requires Pro' });
    try {
      const n = await syncAdAccounts(supabase, brand);
      return { synced: n };
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : String(e) });
    }
  }
};
