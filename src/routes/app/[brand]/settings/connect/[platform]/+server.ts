import { redirect, error } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import type { RequestHandler } from './$types';
import { ensureBrandProfile, getConnectUrl } from '$lib/server/zernio';
import { accountLimit, canConnectSocials } from '$lib/server/plans';

// Ensures the brand's own Zernio profile exists, then redirects to the platform OAuth.
// Enforces paid-plan + per-plan connected-account cap before connecting.
export const GET: RequestHandler = async ({ params, url, locals: { supabase, safeGetSession } }) => {
  const { session } = await safeGetSession();
  if (!session) throw redirect(303, '/login');

  if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, plan, status, zernio_profile_id')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  // Free / trial / canceled / paused: Zernio slots are paid+active only — send them to activate.
  if (!canConnectSocials(brand.plan, brand.status)) {
    throw redirect(303, `/app/${params.brand}/activate`);
  }

  // Plan cap: block if the brand is already at its connected-account limit.
  const { count } = await supabase
    .from('social_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brand.id)
    .eq('status', 'active');
  if ((count ?? 0) >= accountLimit(brand.plan)) {
    throw redirect(303, `/app/${params.brand}/settings/connected-accounts?error=limit`);
  }

  const profileId = await ensureBrandProfile(supabase, brand);
  // After authorising on Zernio, come back INTO our app (not stranded on Zernio). ?connected=1
  // triggers an immediate account sync. The onboarding setup flow returns to /activate so it can
  // resume at the connect step; everywhere else returns to Settings.
  const dest = url.searchParams.get('return') === 'activate' ? 'activate' : 'settings';

  // LinkedIn uses the headless flow: Zernio redirects back to our own selection page with a
  // pendingDataToken so the user can pick their personal profile OR a Company Page they admin.
  // Every other platform keeps the standard hosted flow (lands straight back with ?connected=1).
  if (params.platform === 'linkedin') {
    const redirectUrl = `${url.origin}/app/${params.brand}/settings/linkedin?return=${dest}`;
    const authUrl = await getConnectUrl(profileId, 'linkedin', redirectUrl, { headless: true });
    throw redirect(303, authUrl);
  }

  // Facebook uses the same headless idea but Meta only allows posting to a Page (no personal
  // profile), so our selector lists the user's Pages. Picking a Page also picks its linked
  // Instagram Business account, which is how a user with several IGs chooses the right one.
  if (params.platform === 'facebook') {
    const redirectUrl = `${url.origin}/app/${params.brand}/settings/facebook?return=${dest}`;
    const authUrl = await getConnectUrl(profileId, 'facebook', redirectUrl, { headless: true });
    throw redirect(303, authUrl);
  }

  const redirectUrl = `${url.origin}/app/${params.brand}/${dest === 'activate' ? 'activate' : 'settings/connected-accounts'}?connected=1`;
  const authUrl = await getConnectUrl(profileId, params.platform, redirectUrl);
  throw redirect(303, authUrl);
};
