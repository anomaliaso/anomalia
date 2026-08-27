import type { Actions, PageServerLoad } from './$types';
import { adsNewActions, adsNewLoad } from '$lib/server/ads-actions';

export const load: PageServerLoad = adsNewLoad as PageServerLoad;
export const actions: Actions = adsNewActions;
