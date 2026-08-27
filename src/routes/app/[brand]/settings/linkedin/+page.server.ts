import { fail, redirect } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import type { Actions, PageServerLoad } from './$types';
import {
  getPendingOAuthData,
  selectLinkedInOrganization,
  syncBrandAccounts,
  type LinkedInOrg
} from '$lib/server/zernio';
import { canConnectSocials } from '$lib/server/plans';

// LinkedIn headless connect — the page Zernio redirects back to after OAuth. It carries a one-time
// pendingDataToken; we exchange it for the OAuth payload (consuming it) and let the user pick their
// personal profile or one of the Company Pages they admin. The chosen tempToken/userProfile are
// carried into the `select` action via the form, since the token can't be fetched twice.
export const load: PageServerLoad = async ({ params, url, parent, locals: { supabase } }) => {
  await parent(); // ensures the brand layout (auth + brand resolution) has run
  if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');

  const dest = url.searchParams.get('return') === 'activate' ? 'activate' : 'settings';
  // Zernio appends the one-time token to our redirect URL; accept the documented name and fallbacks.
  const token =
    url.searchParams.get('pendingDataToken') ??
    url.searchParams.get('pendingToken') ??
    url.searchParams.get('token');

  if (!token) {
    return { dest, error: 'missing' as const, personal: null, organizations: [] as LinkedInOrg[], pending: null };
  }

  try {
    const data = await getPendingOAuthData(token);
    return {
      dest,
      error: null,
      // A display name for the personal-profile option, best-effort from the OAuth profile.
      personal:
        (data.userProfile?.name as string) ??
        (data.userProfile?.localizedName as string) ??
        'Personal profile',
      organizations: data.organizations,
      // Carried back into the action; tempToken is short-lived and userProfile is opaque.
      pending: {
        tempToken: data.tempToken,
        userProfile: data.userProfile
      }
    };
  } catch {
    // One-time token already used (e.g. page reload) or expired → ask the user to reconnect.
    return { dest, error: 'expired' as const, personal: null, organizations: [] as LinkedInOrg[], pending: null };
  }
};

export const actions: Actions = {
  // Finalise the connection as the personal profile or a selected Company Page, then sync accounts.
  select: async ({ request, params, locals: { supabase } }) => {
    const form = await request.formData();
    const accountType = form.get('accountType') === 'organization' ? 'organization' : 'personal';
    // Where to return after connecting. Carried as a hidden field because the form posts to
    // `?/select`, which drops the original `?return=…` query string the load saw.
    const dest = form.get('dest') === 'activate' ? 'activate' : 'settings';
    const tempToken = String(form.get('tempToken') ?? '');
    const userProfileRaw = String(form.get('userProfile') ?? '');
    const orgRaw = String(form.get('organization') ?? '');
    if (!tempToken) return fail(400, { error: 'expired' });

    const { data: brand } = await supabase
      .from('brands')
      .select('id, plan, status, zernio_profile_id')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand?.zernio_profile_id) return fail(404, { error: 'brand' });
    if (!canConnectSocials(brand.plan, brand.status)) {
      throw redirect(303, `/app/${params.brand}/activate`);
    }

    let userProfile: unknown = null;
    let selectedOrganization: LinkedInOrg | undefined;
    try {
      userProfile = userProfileRaw ? JSON.parse(userProfileRaw) : null;
      if (accountType === 'organization') selectedOrganization = JSON.parse(orgRaw) as LinkedInOrg;
    } catch {
      return fail(400, { error: 'bad_selection' });
    }
    if (accountType === 'organization' && !selectedOrganization?.urn) {
      return fail(400, { error: 'bad_selection' });
    }

    try {
      await selectLinkedInOrganization({
        profileId: brand.zernio_profile_id,
        tempToken,
        userProfile,
        accountType,
        selectedOrganization
      });
      await syncBrandAccounts(supabase, brand);
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'connect_failed' });
    }

    throw redirect(303, `/app/${params.brand}/${dest === 'activate' ? 'activate' : 'settings/connected-accounts'}?connected=1`);
  }
};
