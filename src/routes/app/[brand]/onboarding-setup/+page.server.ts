import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Legacy post-payment wizard — removed. Old emails/bookmarks land on the thank-you page.
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(303, `/app/${params.brand}/success`);
};
