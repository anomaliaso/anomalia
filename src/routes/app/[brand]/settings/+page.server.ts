import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Default settings landing → first sidebar section (preserve ?connected / ?error). */
export const load: PageServerLoad = async ({ params, url }) => {
  const qs = url.searchParams.toString();
  throw redirect(
    303,
    `/app/${params.brand}/settings/connected-accounts${qs ? `?${qs}` : ''}`
  );
};
