import { describe, expect, it } from 'vitest';
import {
  isSeedance25Model,
  isSeedanceFamily,
  modelSupportsReferenceVideo,
  SEEDANCE_25_MODEL,
  VIDEO_ROLES,
  videoModelsForRole,
  videoModelSpec,
  videoModelForRole,
  GROK_IMAGINE_VIDEO_MODEL,
  KLING_3_VIDEO_MODEL,
  KLING_3_MOTION_MODEL
} from '$lib/video-models';

describe('video model reference capabilities', () => {
  it('Seedance family accepts reference videos on Kie', () => {
    expect(modelSupportsReferenceVideo(SEEDANCE_25_MODEL)).toBe(true);
    expect(modelSupportsReferenceVideo('bytedance/seedance-2')).toBe(true);
    expect(modelSupportsReferenceVideo('bytedance/seedance-2-fast')).toBe(true);
    expect(isSeedanceFamily(SEEDANCE_25_MODEL)).toBe(true);
    expect(isSeedance25Model(SEEDANCE_25_MODEL)).toBe(true);
  });

  it('Grok Imagine does not accept reference videos (images only)', () => {
    expect(modelSupportsReferenceVideo('grok-imagine-video-1-5-preview')).toBe(false);
    expect(isSeedanceFamily('grok-imagine-video-1-5-preview')).toBe(false);
  });
});

describe('the role registry', () => {
  it('offers a model for each of the four video jobs', () => {
    for (const role of VIDEO_ROLES) {
      expect(videoModelsForRole(role).length, role).toBeGreaterThan(0);
    }
  });

  it('never offers a model for a job it cannot do', () => {
    // Grok animates and writes from text; it has no video input at all, so it can neither
    // refine an existing clip nor take a driving video for motion control.
    const refine = videoModelsForRole('refine').map((c) => c.id);
    const motion = videoModelsForRole('motion').map((c) => c.id);
    expect(refine).not.toContain(GROK_IMAGINE_VIDEO_MODEL);
    expect(motion).not.toContain(GROK_IMAGINE_VIDEO_MODEL);
  });

  it('sends the kie id of the ROLE, not of the model', () => {
    // The same Kling row serves generation and motion control under two different kie ids;
    // sending the generation id to a motion-control job is a 400 after a full round trip.
    const kling = videoModelSpec(KLING_3_MOTION_MODEL);
    expect(kling?.kieId.motion).toBe('kling-3.0/motion-control');
  });

  it('falls back to the clip model when no image-to-video model was chosen', () => {
    // Every brand that existed before this picker had one videoModel covering both jobs.
    // Reading videoImageModel must not silently strip that choice.
    expect(videoModelForRole({ videoModel: SEEDANCE_25_MODEL }, 'image')).toBe(SEEDANCE_25_MODEL);
    expect(videoModelForRole({ videoModel: SEEDANCE_25_MODEL, videoImageModel: KLING_3_VIDEO_MODEL }, 'image'))
      .toBe(KLING_3_VIDEO_MODEL);
  });

  it('ignores a stored model that cannot do the job it is stored for', () => {
    // A brand can keep a pref across a catalogue change. A model that lost the role must not
    // reach the provider: an unknown role id is a paid round trip that returns nothing.
    expect(videoModelForRole({ videoRefineModel: GROK_IMAGINE_VIDEO_MODEL }, 'refine')).toBeUndefined();
  });
});
