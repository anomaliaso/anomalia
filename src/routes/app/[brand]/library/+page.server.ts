import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Legacy Web-hub path → Settings. */
export const load: PageServerLoad = async ({ params }) => {
	throw redirect(303, `/app/${params.brand}/settings/library`);
};
