import { redirect, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { gscConfigured, buildGscAuthUrl, gscOAuthRedirectUri } from '$lib/server/gsc';

const COOKIE = 'gsc_oauth_nonce';

/** Start GSC OAuth — redirect_uri is fixed; brand is in `state`. */
export const GET: RequestHandler = async ({ params, url, cookies, locals: { safeGetSession, supabase } }) => {
  const { session } = await safeGetSession();
  if (!session) throw redirect(303, '/login');
  if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');
  if (!gscConfigured()) throw error(503, 'GSC OAuth not configured');

  // RLS client — only brands the signed-in user can access.
  const { data: brand } = await supabase
    .from('brands')
    .select('id, slug')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  const nonce = crypto.randomUUID();
  cookies.set(COOKIE, nonce, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: 600
  });

  const redirectUri = gscOAuthRedirectUri(url.origin);
  const state = Buffer.from(JSON.stringify({ brand: brand.slug, n: nonce })).toString('base64url');
  throw redirect(303, buildGscAuthUrl(redirectUri, state));
};
