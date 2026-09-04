import { describe, expect, it } from 'vitest';
import {
  GET_MEDIA_MODELS,
  MEDIA_MODEL_JOBS,
  MEDIA_MODEL_SLOT_IDS,
  SET_MEDIA_MODEL
} from './media-models';
import { BRAND_ENDPOINTS, statusForFailure } from './index';

describe('i modelli media come contratto', () => {
  it('stanno nel registry, o nessun agente li vede', () => {
    for (const endpoint of [GET_MEDIA_MODELS, SET_MEDIA_MODEL]) {
      expect(BRAND_ENDPOINTS, endpoint.tool).toContain(endpoint);
    }
  });

  it('ogni mestiere si spiega da solo, senza aprire il browser', () => {
    for (const slot of MEDIA_MODEL_SLOT_IDS) {
      expect(MEDIA_MODEL_JOBS[slot].length, slot).toBeGreaterThan(20);
    }
  });

  it('la scrittura accetta i sei mestieri e nessun altro nome', () => {
    expect(SET_MEDIA_MODEL.input.safeParse({ slot: 'imageModel', model: 'x' }).success).toBe(true);
    expect(SET_MEDIA_MODEL.input.safeParse({ slot: 'imageMdoel', model: 'x' }).success).toBe(false);
  });

  it('svuotare uno slot è dire null, non una stringa vuota che sembra una scelta', () => {
    expect(SET_MEDIA_MODEL.input.safeParse({ slot: 'imageModel', model: null }).success).toBe(true);
    expect(SET_MEDIA_MODEL.input.safeParse({ slot: 'imageModel', model: '' }).success).toBe(false);
  });

  it('un modello che quel mestiere non sa fare è colpa di chi chiama: 400, non 500', () => {
    expect(statusForFailure(SET_MEDIA_MODEL, 'model_not_for_slot')).toBe(400);
  });

  it('la lettura porta, per ogni mestiere, le scelte valide da cui pescare', () => {
    const parsed = GET_MEDIA_MODELS.output.safeParse({
      brand: 'demo',
      slots: [
        {
          slot: 'imageModel',
          job: MEDIA_MODEL_JOBS.imageModel,
          model: null,
          choices: [{ id: 'nano-banana-pro', label: 'Nano Banana Pro' }]
        }
      ]
    });
    expect(parsed.success).toBe(true);
  });

  it('non promette un modello dove non c è scelta: null è un valore, non un buco', () => {
    const withModel = GET_MEDIA_MODELS.output.safeParse({
      brand: 'demo',
      slots: [{ slot: 'imageModel', job: 'x', model: 'nano-banana-pro', choices: [] }]
    });
    expect(withModel.success).toBe(true);
    const missing = GET_MEDIA_MODELS.output.safeParse({
      brand: 'demo',
      slots: [{ slot: 'imageModel', job: 'x', choices: [] }]
    });
    expect(missing.success).toBe(false);
  });
});
