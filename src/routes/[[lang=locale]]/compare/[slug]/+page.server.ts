import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getComparison } from '$lib/data/comparisons';

export const load: PageServerLoad = ({ params }) => {
	const comparison = getComparison(params.slug);
	if (!comparison) error(404, 'Comparison not found');
	return { comparison };
};
