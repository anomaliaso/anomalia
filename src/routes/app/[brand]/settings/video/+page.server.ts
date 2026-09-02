import type { Actions, PageServerLoad } from './$types';
import { studioActions } from '$lib/server/studio-actions';
import { videoDurationOptions, isKnownVideoModel } from '$lib/server/video';
import { MEDIA_MODEL_SLOTS, slotAccepts, slotChoices } from '$lib/media-model-slots';

export const load: PageServerLoad = async ({ parent }) => {
  const { brand } = await parent();
  const prefs = (brand?.content_prefs ?? {}) as Record<string, unknown>;
  const videoModel = isKnownVideoModel(prefs.videoModel) ? String(prefs.videoModel) : null;
  return {
    // Uno slot stantio non torna selezionato: mostrare un modello che il salvataggio poi rifiuta
    // e' peggio che mostrare "Platform default", perche' sembra una scelta gia' fatta.
    modelSlots: MEDIA_MODEL_SLOTS.map((slot) => {
      const stored = String(prefs[slot.pref] ?? '').trim();
      return {
        id: slot.id,
        i18n: slot.i18n,
        choices: slotChoices(slot),
        current: stored && slotAccepts(slot, stored) ? stored : ''
      };
    }),
    durationOptions: videoDurationOptions(videoModel)
  };
};

export const actions: Actions = {
  updateVideoDuration: studioActions.updateVideoDuration,
  updateVideoResolution: studioActions.updateVideoResolution,
  updateVideoInstructions: studioActions.updateVideoInstructions,
  updateMediaModel: studioActions.updateMediaModel
};
