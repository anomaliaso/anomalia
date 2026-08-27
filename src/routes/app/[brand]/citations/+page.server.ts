import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Legacy path — GEO hub lives at /geo. */
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(301, `/app/${params.brand}/geo`);
};
