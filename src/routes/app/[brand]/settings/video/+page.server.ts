import type { Actions, PageServerLoad } from './$types';
import { studioActions } from '$lib/server/studio-actions';
import {
  VIDEO_MODEL_CHOICES,
  videoDurationOptions,
  isKnownVideoModel
} from '$lib/server/video';

export const load: PageServerLoad = async ({ parent }) => {
  const { brand } = await parent();
  const prefs = (brand?.content_prefs ?? {}) as Record<string, unknown>;
  const videoModel = isKnownVideoModel(prefs.videoModel) ? String(prefs.videoModel) : null;
  return {
    videoModels: VIDEO_MODEL_CHOICES.map((c) => ({ id: c.id, label: c.label })),
    videoModel,
    durationOptions: videoDurationOptions(videoModel)
  };
};

export const actions: Actions = {
  updateVideoDuration: studioActions.updateVideoDuration,
  updateVideoResolution: studioActions.updateVideoResolution,
  updateVideoInstructions: studioActions.updateVideoInstructions,
  updateVideoModel: studioActions.updateVideoModel
};
