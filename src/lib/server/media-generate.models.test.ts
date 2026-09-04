import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mediaModelSlot, slotAccepts, slotChoices } from '$lib/media-model-slots';

/**
 * IL CATALOGO DEI MODELLI È UNO SOLO. Un secondo elenco scritto qui divergerebbe dal primo al
 * prossimo modello aggiunto, e la metà rimasta indietro rifiuterebbe in silenzio un modello
 * valido — o, peggio, accetterebbe un modello che il renderer poi scarta. È la stessa lezione già
 * pagata su set_media_model, e questo test la tiene ferma sul percorso nuovo.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL('./media-generate.ts', import.meta.url)),
  'utf8'
);

describe('il modello per-chiamata', () => {
  it('valida contro il catalogo vero, non contro una lista sua', () => {
    expect(SOURCE).toContain("import('$lib/media-model-slots')");
    expect(SOURCE).toContain('slotAccepts');
    expect(SOURCE).toContain('slotChoices');
  });

  it('non contiene id di modelli scritti a mano', () => {
    // Un id letterale qui è l'inizio del secondo elenco. Gli id veri vivono in $lib/image-models
    // e $lib/video-models, e ci arrivano da slotChoices.
    const literals = SOURCE.match(/'(nano-banana|gemini-[\d.]+|grok-imagine|bytedance)[^']*'/g);
    expect(literals).toBeNull();
  });

  it('i due mestieri delle immagini restano due slot distinti', () => {
    // refine_image non deve finire a validare contro lo slot della generazione: sono due
    // cataloghi diversi, e confonderli accetterebbe un modello che non sa modificare.
    const draw = mediaModelSlot('imageModel');
    const refine = mediaModelSlot('imageRefineModel');
    expect(draw).toBeDefined();
    expect(refine).toBeDefined();
    expect(draw?.pref).not.toBe(refine?.pref);
  });

  it('rifiuta un modello inventato ed elenca quelli buoni', () => {
    const slot = mediaModelSlot('imageModel')!;
    expect(slotAccepts(slot, 'un-modello-che-non-esiste')).toBe(false);
    expect(slotChoices(slot).length).toBeGreaterThan(0);
    // Ogni id offerto è un id che lo slot accetta davvero: un elenco che suggerisce un modello
    // rifiutato manda l'agente in cerchio.
    for (const choice of slotChoices(slot)) {
      expect(slotAccepts(slot, choice.id)).toBe(true);
    }
  });

  it('lo slot video offre solo modelli che sanno filmare da testo', () => {
    const slot = mediaModelSlot('videoModel')!;
    for (const choice of slotChoices(slot)) {
      expect(slotAccepts(slot, choice.id)).toBe(true);
    }
    expect(slotAccepts(slot, 'nano-banana-2-lite')).toBe(false);
  });
});
