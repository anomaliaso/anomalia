import type { Actions } from './$types';
import { studioActions } from '$lib/server/studio-actions';

export const actions: Actions = {
  updateVoiceExamples: studioActions.updateVoiceExamples,
};
