import { fail, redirect } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import type { Actions, PageServerLoad } from './$types';
import { getFacebookPages, selectFacebookPage, syncBrandAccounts, type FacebookPage } from '$lib/server/zernio';
import { canConnectSocials } from '$lib/server/plans';

// Facebook headless connect — the page Zernio redirects back to after OAuth. Meta only allows
// posting to a Page (never a personal profile), so we list the Pages the user admins and let them
// pick one; picking a Page also picks its linked Instagram Business account. The callback carries a
// short-lived tempToken (query) + connect_token (sent as X-Connect-Token) + userProfile (url-encoded
// JSON). We list pages now and carry tempToken/connectToken/userProfile into the `select` action.
// Zernio passes userProfile as JSON that may be URL-encoded more than once (we've observed %257B,
// i.e. a double-encoded `{`). Peel encodings until it parses as JSON, then return clean JSON so the
// select action can JSON.parse it directly. Best-effort: returns '' if it never resolves.
const decodeUserProfile = (raw: string): string => {
  let cur = raw;
  for (let i = 0; i < 4 && cur; i++) {
    try {
      JSON.parse(cur);
      return cur;
    } catch {
      try {
        cur = decodeURIComponent(cur);
      } catch {
        break;
      }
    }
  }
  return '';
};

const resolveBrand = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  slug: string
): Promise<{ id: string; plan: string | null; status: string; zernio_profile_id: string | null } | null> => {
  const { data } = await supabase
    .from('brands')
    .select('id, plan, status, zernio_profile_id')
    .eq('slug', slug)
    .maybeSingle();
  return data ?? null;
};

export const load: PageServerLoad = async ({ params, url, parent, locals: { supabase } }) => {
  await parent(); // ensures the brand layout (auth + brand resolution) has run
  if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');

  const dest = url.searchParams.get('return') === 'activate' ? 'activate' : 'settings';
  const tempToken = url.searchParams.get('tempToken') ?? url.searchParams.get('temp_token');
  // Zernio names this connect_token; accept documented name + fallbacks.
  const connectToken =
    url.searchParams.get('connect_token') ??
    url.searchParams.get('connectToken') ??
    url.searchParams.get('X-Connect-Token');
  // userProfile arrives as JSON, sometimes double-URL-encoded; normalise to clean JSON.
  const userProfileRaw = decodeUserProfile(url.searchParams.get('userProfile') ?? '');

  // TEMP DIAGNOSTIC: the headless Facebook params were built from Zernio's docs, not tested against
  // the live API. Surface exactly what Zernio sent + the real failure so we can pin the mismatch.
  const gotParams = [...url.searchParams.keys()].join(', ') || '(none)';
  console.log('[fb-connect] callback params:', gotParams, '| query:', url.search);

  if (!tempToken || !connectToken) {
    return {
      dest,
      error: 'missing' as const,
      detail: `Missing tempToken/connect_token. Params received: ${gotParams}`,
      pages: [] as FacebookPage[],
      pending: null
    };
  }

  const brand = await resolveBrand(supabase, params.brand);
  if (!brand?.zernio_profile_id) {
    return {
      dest,
      error: 'brand' as const,
      detail: 'Brand has no zernio_profile_id',
      pages: [] as FacebookPage[],
      pending: null
    };
  }

  try {
    const pages = await getFacebookPages({ profileId: brand.zernio_profile_id, tempToken, connectToken });
    return {
      dest,
      error: null,
      detail: null,
      pages,
      // Carried back into the action; tokens are short-lived and userProfile is opaque.
      pending: { tempToken, connectToken, userProfile: userProfileRaw }
    };
  } catch (e) {
    // Tokens already consumed (e.g. page reload) or expired (~15 min), OR the endpoint shape differs.
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[fb-connect] getFacebookPages failed:', msg);
    return {
      dest,
      error: 'expired' as const,
      detail: `select-page call failed: ${msg}`,
      pages: [] as FacebookPage[],
      pending: null
    };
  }
};

export const actions: Actions = {
  // Finalise the connection to the chosen Page, then re-sync accounts (incl. the linked Instagram).
  select: async ({ request, params, url, locals: { supabase } }) => {
    const form = await request.formData();
    // Where to return after connecting. Carried as a hidden field because the form posts to
    // `?/select`, which drops the original `?return=…` query string the load saw.
    const dest = form.get('dest') === 'activate' ? 'activate' : 'settings';
    const pageId = String(form.get('pageId') ?? '');
    const tempToken = String(form.get('tempToken') ?? '');
    const connectToken = String(form.get('connectToken') ?? '');
    const userProfileRaw = String(form.get('userProfile') ?? '');
    if (!pageId) return fail(400, { error: 'bad_selection' });
    if (!tempToken || !connectToken) return fail(400, { error: 'expired' });

    const brand = await resolveBrand(supabase, params.brand);
    if (!brand?.zernio_profile_id) return fail(404, { error: 'brand' });
    if (!canConnectSocials(brand.plan, brand.status)) {
      throw redirect(303, `/app/${params.brand}/activate`);
    }

    let userProfile: unknown = null;
    try {
      userProfile = userProfileRaw ? JSON.parse(userProfileRaw) : null;
    } catch {
      // userProfile is best-effort context for Zernio; a malformed value shouldn't block the connect.
      userProfile = null;
    }

    try {
      await selectFacebookPage({
        profileId: brand.zernio_profile_id,
        pageId,
        tempToken,
        connectToken,
        userProfile,
        redirectUrl: `${url.origin}/app/${params.brand}/${dest === 'activate' ? 'activate' : 'settings/connected-accounts'}?connected=1`
      });
      await syncBrandAccounts(supabase, brand);
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'connect_failed' });
    }

    throw redirect(303, `/app/${params.brand}/${dest === 'activate' ? 'activate' : 'settings/connected-accounts'}?connected=1`);
  }
};
