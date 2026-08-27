import type { Actions, PageServerLoad } from './$types';
import { adsChannelActions, adsChannelLoad } from '$lib/server/ads-actions';

export const load: PageServerLoad = adsChannelLoad('google') as PageServerLoad;
export const actions: Actions = adsChannelActions('google');
