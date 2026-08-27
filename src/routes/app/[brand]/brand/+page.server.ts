import type { PageServerLoad } from './$types';
import { loadBrandOverview } from '$lib/server/hub-overview';
import { cachedBrandPage } from '$lib/server/page-cache';

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const overview = await loadBrandOverview(supabase, brand);
    return { overview };
  });
};
