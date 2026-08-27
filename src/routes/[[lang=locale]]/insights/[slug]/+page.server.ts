import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getInsight } from '$lib/data/insights';

export const load: PageServerLoad = async ({ params }) => {
  const article = getInsight(params.slug);
  if (!article) error(404, 'Insight not found');
  return { article };
};
