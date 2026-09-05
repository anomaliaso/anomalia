import type { Actions } from './$types';
import { studioActions } from '$lib/server/studio-actions';
import { setTimezone } from '$lib/server/settings-actions';

/**
 * Le impostazioni del brand sono UNA pagina, e queste sono le azioni delle quattro che erano
 * quattro rotte. La forma è quella di `get_brand_settings` / `set_brand_settings`
 * (packages/api-contracts): fuso, piattaforme, hashtag, esempi di voce. Se le due superfici non
 * descrivono la stessa struttura, citare il contratto è una coincidenza, non una fonte comune.
 */
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
  updateTargetPlatforms: studioActions.updateTargetPlatforms,
  updatePlatformHashtags: studioActions.updatePlatformHashtags,
  updateVoiceExamples: studioActions.updateVoiceExamples,
  setTimezone
};
