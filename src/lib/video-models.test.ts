import { describe, expect, it } from 'vitest';
import {
  isSeedance25Model,
  isSeedanceFamily,
  modelSupportsReferenceVideo,
  SEEDANCE_25_MODEL
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
