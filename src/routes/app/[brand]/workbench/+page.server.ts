import type { PageServerLoad } from './$types';
import { loadHomeOverview } from '$lib/server/hub-overview';
import { cachedBrandPage } from '$lib/server/page-cache';

/**
 * Il workbench non è più la metà bassa della Panoramica: è una pagina sua, che la modal
 * ospita come tutte le altre (`BRAND_MODAL_ROUTES` in workbench-paths.ts).
 *
 * Il guadagno vero è qui: le ~30 query di `loadHomeOverview` partivano ad OGNI atterraggio
 * sulla home, che ora è solo la chat e non ne mostra nemmeno una. Adesso partono quando
 * qualcuno apre davvero il workbench.
 *
 * `overview` resta restituita NON attesa: la modal dipinge il guscio subito e la pagina
 * mostra il proprio shimmer finché le card non arrivano.
 */
export const load: PageServerLoad = async (event) => {
  const { parent, locals } = event;
  const { brand } = await parent();
  return cachedBrandPage(event, brand.slug, async () => ({
    overview: loadHomeOverview(locals.supabase, brand)
  }));
};
