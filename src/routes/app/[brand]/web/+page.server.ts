import type { PageServerLoad } from './$types';
import { loadWebOverview } from '$lib/server/hub-overview';
import { createAdminClient } from '$lib/server/supabase-admin';
import { firstSteps } from '$lib/server/web-activation';
import { cachedBrandPage } from '$lib/server/page-cache';

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    const [overview, activationSteps] = await Promise.all([
      loadWebOverview(supabase, brand),
      firstSteps(createAdminClient(), brand.id)
    ]);
    return { overview, activationSteps };
  });
};
