import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { ensureBrandProfile, getAdsConnectUrl } from '$lib/server/zernio';
import { adsAvailable, adsFeatureEnabled } from '$lib/server/ads';

// Ads-only OAuth. Deliberately NOT the /settings/connect/[platform] route: that one enforces the
// per-plan *posting* account cap, and an ad account is not a publishing slot.
//
// Zernio's ads connect is GET /v1/connect/{platform}/ads — NOT /connect/metaads.
// Meta → path `facebook` (creates a `metaads` social account from the FB token + ads scopes).
// Google → path `googleads` (standalone Ads OAuth).
const ADS_CONNECT_PLATFORM: Record<string, 'facebook' | 'googleads'> = {
  metaads: 'facebook',
  googleads: 'googleads'
};

export const GET: RequestHandler = async ({ params, url, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session) throw redirect(303, '/login');
  if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');
  if (!adsFeatureEnabled(user?.email)) throw error(404, 'Not found');

  const zernioPlatform = ADS_CONNECT_PLATFORM[params.channel];
  if (!zernioPlatform) throw error(404, 'Unknown ads channel');

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, plan, status, zernio_profile_id')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');
  if (!adsAvailable(brand.plan, user?.email)) throw redirect(303, `/app/${params.brand}/settings/ads/accounts`);

  const profileId = await ensureBrandProfile(brand);
  // Land back in Settings → Ads accounts so connect/manage lives next to social accounts.
  // ?connected=1 triggers syncAdAccounts on that page.
  const accountsUrl = `/app/${params.brand}/settings/ads/accounts`;
  const redirectUrl = `${url.origin}${accountsUrl}?connected=1`;

  try {
    // force=1 refreshes ads scopes when FB was connected before the Ads add-on.
    const force = url.searchParams.get('force') === '1';
    const result = await getAdsConnectUrl(profileId, zernioPlatform, redirectUrl, { force });
    if ('alreadyConnected' in result) {
      throw redirect(303, `${accountsUrl}?connected=1`);
    }
    throw redirect(303, result.authUrl);
  } catch (e) {
    // SvelteKit redirects are thrown — rethrow them.
    if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status >= 300 && (e as { status: number }).status < 400) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[ads/connect]', zernioPlatform, msg);
    // Meta ads need a Facebook posting connection first (same-token). Point the user there.
    if (zernioPlatform === 'facebook' && (/404|400|no .*facebook|parent|posting|linked_account/i.test(msg))) {
      throw redirect(
        303,
        `/app/${params.brand}/settings/connect/facebook?return=${encodeURIComponent('settings/ads/accounts')}`
      );
    }
    throw error(502, `Could not start ads connect: ${msg.slice(0, 200)}`);
  }
};
