import { describe, expect, it, vi } from 'vitest';

// `$lib/server/video` legge l'env per il modello di ripiego: fuori dal runtime SvelteKit non
// esiste, e senza questo mock il modulo non si carica nemmeno.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import { chooseMediaModel } from './media-model-prefs';
import { mediaModelSlot } from '$lib/media-model-slots';
import { GPT_IMAGE_2_MODEL } from '$lib/image-models';
import { ALEPH_REFINE_MODEL, GROK_IMAGINE_VIDEO_MODEL, SEEDANCE_25_MODEL } from '$lib/video-models';

const slot = (id: string) => mediaModelSlot(id)!;

describe('la scelta di un modello per un mestiere', () => {
  it('salva il modello sotto la chiave di quel mestiere', () => {
    const { prefs } = chooseMediaModel({}, slot('imageModel'), GPT_IMAGE_2_MODEL);
    expect(prefs).toEqual({ imageModel: GPT_IMAGE_2_MODEL });
  });

  it('rifiuta un modello che quel mestiere non sa fare, e dice quali erano ammessi', () => {
    const refused = chooseMediaModel({}, slot('videoRefineModel'), GROK_IMAGINE_VIDEO_MODEL);
    expect(refused.prefs).toBeUndefined();
    expect(refused.allowed).toContain(ALEPH_REFINE_MODEL);
    expect(refused.allowed).not.toContain(GROK_IMAGINE_VIDEO_MODEL);
  });

  it('svuotare uno slot toglie la chiave invece di salvare una stringa vuota', () => {
    const { prefs } = chooseMediaModel({ imageModel: GPT_IMAGE_2_MODEL, language: 'it' }, slot('imageModel'), null);
    expect(prefs).toEqual({ language: 'it' });
  });

  it('non tocca le altre preferenze del brand', () => {
    const { prefs } = chooseMediaModel(
      { videoInstructions: 'parla piano', imageModel: 'x' },
      slot('videoModel'),
      SEEDANCE_25_MODEL
    );
    expect(prefs).toEqual({
      videoInstructions: 'parla piano',
      imageModel: 'x',
      videoModel: SEEDANCE_25_MODEL
    });
  });

  it('riporta la durata dentro il tetto del nuovo modello, invece di lasciarla insalvabile', () => {
    // 30s vive solo su Seedance 2.5; scegliendo Grok il tetto scende a 15 e una durata salvata
    // che il modello non regge farebbe fallire il render, non il salvataggio.
    const { prefs } = chooseMediaModel(
      { videoModel: SEEDANCE_25_MODEL, videoDuration: 30 },
      slot('videoModel'),
      GROK_IMAGINE_VIDEO_MODEL
    );
    expect(prefs?.videoDuration).toBeLessThanOrEqual(15);
  });

  it('non ritocca la durata quando a cambiare è un altro mestiere', () => {
    const { prefs } = chooseMediaModel(
      { videoModel: SEEDANCE_25_MODEL, videoDuration: 30 },
      slot('imageModel'),
      GPT_IMAGE_2_MODEL
    );
    expect(prefs?.videoDuration).toBe(30);
  });
});
