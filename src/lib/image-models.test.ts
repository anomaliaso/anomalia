import { describe, it, expect } from 'vitest';
import {
  IMAGE_MODEL_CHOICES,
  NANO_BANANA_PRO_MODEL,
  isKnownImageModelId,
  imageModelFor
} from './image-models';

describe('image models', () => {
  it('ogni scelta offerta è riconosciuta', () => {
    for (const choice of IMAGE_MODEL_CHOICES) {
      expect(isKnownImageModelId(choice.id)).toBe(true);
    }
  });

  it('un id sconosciuto non passa', () => {
    expect(isKnownImageModelId('gpt-image-2')).toBe(false);
    expect(isKnownImageModelId('')).toBe(false);
    expect(isKnownImageModelId(undefined)).toBe(false);
  });

  it('la preferenza del brand vince quando è nota', () => {
    expect(imageModelFor({ imageModel: NANO_BANANA_PRO_MODEL })).toBe(NANO_BANANA_PRO_MODEL);
  });

  it('senza preferenza il renderer resta libero di scegliere', () => {
    expect(imageModelFor({})).toBeUndefined();
    expect(imageModelFor(null)).toBeUndefined();
    expect(imageModelFor({ imageModel: 'un-modello-che-non-esiste' })).toBeUndefined();
  });
});
