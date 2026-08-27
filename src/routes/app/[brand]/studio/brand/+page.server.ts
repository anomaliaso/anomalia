import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Studio moved into Settings — keep /studio/brand as a soft redirect. */
export const load: PageServerLoad = async ({ params, url }) => {
  const qs = url.searchParams.toString();
  throw redirect(308, `/app/${params.brand}/settings/brand${qs ? `?${qs}` : ''}`);
};
