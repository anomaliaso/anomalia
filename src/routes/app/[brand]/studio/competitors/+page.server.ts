import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Studio → Settings → Social hub. */
export const load: PageServerLoad = async ({ params, url }) => {
	const qs = url.searchParams.toString();
	throw redirect(308, `/app/${params.brand}/competitors${qs ? `?${qs}` : ''}`);
};
