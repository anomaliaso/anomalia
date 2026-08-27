import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { brand } = await parent();
  return { brand };
};
