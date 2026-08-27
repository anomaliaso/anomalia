import type { Actions } from './$types';
import { studioActions } from '$lib/server/studio-actions';

export const actions: Actions = {
  updateBrandKit: studioActions.updateBrandKit,
  updateColors: studioActions.updateColors,
  updateLogo: studioActions.updateLogo,
  updateVisualStyle: studioActions.updateVisualStyle,
  updateGraphicStyle: studioActions.updateGraphicStyle,
  proposeGraphicStyle: studioActions.proposeGraphicStyle,
  regenerateVisualStyle: studioActions.regenerateVisualStyle,
  uploadImage: studioActions.uploadImage,
  addMoodFromHistory: studioActions.addMoodFromHistory,
  addMoodFromUrls: studioActions.addMoodFromUrls,
  deleteSource: studioActions.deleteSource,
};
