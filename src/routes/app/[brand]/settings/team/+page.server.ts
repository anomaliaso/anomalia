import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { invite, revokeInvite } from '$lib/server/settings-actions';
import { hasManyTenants } from '$lib/server/tenancy';

// Invitare qualcuno su un brand ha senso quando i brand sono più di uno e appartengono a persone
// diverse. Con un tenant solo la pagina non è vuota: non esiste.
export const load: PageServerLoad = async () => {
  if (!hasManyTenants()) throw error(404, 'Not found');
  return {};
};

export const actions: Actions = { invite, revokeInvite };
