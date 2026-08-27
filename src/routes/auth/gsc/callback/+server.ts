import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import {
  exchangeGscCode,
  saveGscConnection,
  gscConfigured,
  gscOAuthRedirectUri
} from '$lib/server/gsc';

const COOKIE = 'gsc_oauth_nonce';

/**
 * Fixed Google OAuth callback (one Authorized redirect URI for all brands).
 * Brand slug + CSRF nonce travel in `state`; after token exchange we redirect
 * to `/app/{brand}/settings/search-console`.
 */
export const GET: RequestHandler = async ({ url, cookies, locals: { safeGetSession, supabase } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/login');
  if (!gscConfigured()) throw error(503, 'GSC OAuth not configured');

  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  let state: { brand?: string; n?: string } = {};
  if (stateRaw) {
    try {
      state = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')) as {
        brand?: string;
        n?: string;
      };
    } catch {
      state = {};
    }
  }

  const brandSlug = state.brand?.trim() || '';
  const settingsUrl = brandSlug
    ? `/app/${brandSlug}/settings/search-console`
    : '/app';

  if (err) throw redirect(303, `${settingsUrl}?error=${encodeURIComponent(err)}`);
  if (!code || !stateRaw) throw redirect(303, `${settingsUrl}?error=missing_code`);
  if (!brandSlug) throw redirect(303, `${settingsUrl}?error=missing_brand`);

  const cookieNonce = cookies.get(COOKIE);
  cookies.delete(COOKIE, { path: '/' });
  if (!state.n || !cookieNonce || state.n !== cookieNonce) {
    throw redirect(303, `${settingsUrl}?error=state_mismatch`);
  }

  // Ownership via RLS — never attach GSC to a brand the user cannot read.
  const { data: brand } = await supabase
    .from('brands')
    .select('id, slug')
    .eq('slug', brandSlug)
    .maybeSingle();
  if (!brand) throw redirect(303, `${settingsUrl}?error=brand_not_found`);

  const redirectUri = gscOAuthRedirectUri(url.origin);
  try {
    const tokens = await exchangeGscCode(code, redirectUri);
    await saveGscConnection(createAdminClient(), brand.id, tokens);
    throw redirect(303, `/app/${brand.slug}/settings/search-console?connected=1`);
  } catch (e) {
    if (
      e &&
      typeof e === 'object' &&
      'status' in e &&
      (e as { status: number }).status >= 300 &&
      (e as { status: number }).status < 400
    ) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw redirect(
      303,
      `/app/${brand.slug}/settings/search-console?error=${encodeURIComponent(msg.slice(0, 180))}`
    );
  }
};
