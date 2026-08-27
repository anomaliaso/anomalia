import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Legacy per-brand OAuth callback (removed).
 * Google must redirect to the fixed `/auth/gsc/callback` only.
 */
export const GET: RequestHandler = async ({ params }) => {
  const msg = encodeURIComponent(
    'Update Google Cloud Authorized redirect URI to /auth/gsc/callback (one URI for all brands), then connect again.'
  );
  throw redirect(303, `/app/${params.brand}/settings/search-console?error=${msg}`);
};
