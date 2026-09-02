import type { Actions, PageServerLoad } from './$types';
import { setChatDefaultTier } from '$lib/server/settings-actions';
import { chatModelChoices } from '$lib/server/chat-models';

export const load: PageServerLoad = async () => ({
  chatModels: await chatModelChoices().catch(() => [])
});

export const actions: Actions = { setChatDefaultTier };
