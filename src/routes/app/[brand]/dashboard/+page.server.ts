import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Legacy path used in older Monday recap emails — home is `/app/[brand]`. */
export const load: PageServerLoad = async ({ params, url }) => {
  const qs = url.searchParams.toString();
  throw redirect(308, `/app/${params.brand}${qs ? `?${qs}` : ''}`);
};
