import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * La home del brand era la chat, e basta: il suo corpo era il composer montato dal layout.
 * Tolta la chat, il guscio non ha più niente da mostrare qui, quindi la home È il workbench —
 * che quelle ~30 query di `loadHomeOverview` le fa già, e le fa solo quando lo si apre.
 */
export const load: PageServerLoad = () => {
  redirect(302, './workbench');
};
