import type { PageServerLoad } from './$types';
import { loadAutomationsOverview } from '$lib/server/hub-overview';
import { cachedBrandPage } from '$lib/server/page-cache';
import { createAdminClient } from '$lib/server/supabase-admin';
import { brandRoster } from '$lib/server/job-roster';

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const { brand } = await event.parent();

  return cachedBrandPage(event, brand.slug, async () => {
    // La card "agenti" conta TUTTA la squadra: quelli che il cliente si è scritto e quelli
    // inclusi nel prodotto. Sulla pagina sono una cosa sola, quindi anche il conteggio lo è.
    const [overview, jobs] = await Promise.all([
      loadAutomationsOverview(supabase, brand),
      brandRoster(createAdminClient(), brand.id)
    ]);
    return { overview, jobs: { total: jobs.length, enabled: jobs.filter((j) => j.enabled).length } };
  });
};
