import type { Actions, PageServerLoad } from './$types';
import { setChatDefaultTier } from '$lib/server/settings-actions';
import { chatModelChoices } from '$lib/server/chat-models';
import { defaultChatModelId } from '$lib/server/chat-model-catalog';

export const load: PageServerLoad = async () => {
  const chatModels = await chatModelChoices().catch(() => []);
  return { chatModels, defaultChatModel: defaultChatModelId() };
};

export const actions: Actions = { setChatDefaultTier };
