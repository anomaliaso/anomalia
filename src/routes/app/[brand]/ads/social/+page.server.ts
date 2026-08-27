import type { Actions, PageServerLoad } from './$types';
import { adsChannelActions, adsChannelLoad } from '$lib/server/ads-actions';

export const load: PageServerLoad = adsChannelLoad('social') as PageServerLoad;
export const actions: Actions = adsChannelActions('social');
