import type { PageServerLoad } from './$types';
import { loadPublishOverview } from '$lib/server/hub-overview';
import { cachedBrandPage } from '$lib/server/page-cache';

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const overview = await loadPublishOverview(supabase, brand);
    return { overview };
  });
};
