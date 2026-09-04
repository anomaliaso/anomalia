import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Questo file esiste perché la rotta esista. SvelteKit costruisce il manifest dai file: senza una
 * pagina qui, `/app/<slug>` non è una rotta e il 404 nasce in `resolve()` prima che parta un solo
 * `load` — quindi il rimando in cima al layout non viene mai raggiunto. Cancellarlo ha già tolto
 * la home del brand a tutti (#269), e il sintomo — «Not found» — non somiglia alla causa.
 *
 * A rimandare per davvero è il layout, che nell'ordine dei nodi viene prima di questa pagina.
 * Questo `load` è la rete: se un domani quella guardia non scattasse, la home rimanda comunque.
 * Assoluto e non `./workbench`, che si risolve contro un URL senza barra finale e atterra su
 * `/app/workbench` — la rotta di nessuno.
 */
export const load: PageServerLoad = ({ params }) => {
  redirect(302, `/app/${encodeURIComponent(params.brand)}/workbench`);
};
