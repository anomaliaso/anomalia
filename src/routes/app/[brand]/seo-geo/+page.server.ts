import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Legacy URL — SEO hub lives at /seo */
export const load: PageServerLoad = async ({ params }) => {
	throw redirect(301, `/app/${params.brand}/seo`);
};
