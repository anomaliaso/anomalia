import { describe, expect, it } from 'vitest';
import {
  MEDIA_MODEL_SLOTS,
  mediaModelSlot,
  slotAccepts,
  slotChoices
} from '$lib/media-model-slots';
import { GPT_IMAGE_2_MODEL } from '$lib/image-models';
import {
  ALEPH_REFINE_MODEL,
  GROK_IMAGINE_VIDEO_MODEL,
  KLING_3_VIDEO_MODEL,
  KLING_TURBO_I2V_MODEL
} from '$lib/video-models';

describe('media model slots', () => {
  it('offers at least one model in every slot', () => {
    for (const slot of MEDIA_MODEL_SLOTS) {
      expect(slotChoices(slot).length, slot.id).toBeGreaterThan(0);
    }
  });

  it('refuses a model that cannot do the slot it is saved into', () => {
    // The whole point of a slot: a select that accepted a model the renderer then drops would
    // store a preference that does nothing, which is the quietest way to not work.
    const refine = mediaModelSlot('videoRefineModel')!;
    expect(slotAccepts(refine, ALEPH_REFINE_MODEL)).toBe(true);
    expect(slotAccepts(refine, GROK_IMAGINE_VIDEO_MODEL)).toBe(false);
    expect(slotAccepts(refine, GPT_IMAGE_2_MODEL)).toBe(false);
  });

  it('keeps an image model out of a video slot and the reverse', () => {
    expect(slotAccepts(mediaModelSlot('imageModel')!, KLING_3_VIDEO_MODEL)).toBe(false);
    expect(slotAccepts(mediaModelSlot('videoModel')!, GPT_IMAGE_2_MODEL)).toBe(false);
  });

  it('only offers image-to-video models where a still is being animated', () => {
    const animate = slotChoices(mediaModelSlot('videoImageModel')!).map((c) => c.id);
    const fromText = slotChoices(mediaModelSlot('videoModel')!).map((c) => c.id);
    // Turbo has nothing to animate without an image, so it belongs to one list and not the other.
    expect(animate).toContain(KLING_TURBO_I2V_MODEL);
    expect(fromText).not.toContain(KLING_TURBO_I2V_MODEL);
  });

  it('does not answer for a slot that does not exist', () => {
    expect(mediaModelSlot('videoVibesModel')).toBeUndefined();
    expect(mediaModelSlot('')).toBeUndefined();
  });
});
