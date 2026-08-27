import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Knowledge moved to brand hub `/knowledge` (docs/23). Keep this path as a soft redirect. */
export const load: PageServerLoad = async ({ params, url }) => {
  const qs = url.searchParams.toString();
  throw redirect(303, `/app/${params.brand}/knowledge${qs ? `?${qs}` : ''}`);
};
