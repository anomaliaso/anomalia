import { slotAccepts, slotChoices, type MediaModelSlot } from '$lib/media-model-slots';
import { clampVideoDuration, isKnownVideoModel, videoDurationOptions } from '$lib/server/video';

type Prefs = Record<string, unknown>;

export type MediaModelChoice =
  | { prefs: Prefs; allowed?: undefined }
  | { prefs?: undefined; allowed: string[] };

/**
 * Le preferenze del brand dopo aver messo QUESTO modello in QUESTO mestiere.
 *
 * Sta qui e non dentro l'azione del form perche' i chiamanti sono due — il browser e i tool
 * dell'API — e la regola e' una: un modello e' salvabile solo se sa fare il lavoro in cui viene
 * salvato, e una durata che il nuovo modello non regge va riportata dentro il suo tetto. Scritta
 * due volte divergerebbe al primo cambio, e la meta' non aggiornata salverebbe una preferenza che
 * il renderer poi scarta: il modo piu' silenzioso di non funzionare.
 */
export function chooseMediaModel(
  current: Prefs | null | undefined,
  slot: MediaModelSlot,
  model: string | null
): MediaModelChoice {
  const prefs: Prefs = { ...(current ?? {}) };

  if (model === null) {
    delete prefs[slot.pref];
    return { prefs };
  }

  if (!slotAccepts(slot, model)) {
    return { allowed: slotChoices(slot).map((c) => c.id) };
  }

  prefs[slot.pref] = model;

  if (slot.pref === 'videoModel' && typeof prefs.videoDuration === 'number') {
    prefs.videoDuration = nearestAllowedDuration(prefs.videoDuration, model);
  }

  return { prefs };
}

/**
 * Il tetto di un modello puo' essere piu' basso di quello del modello precedente (30s su Seedance
 * 2.5 contro i 15s di Grok): senza questo passaggio la durata salvata resterebbe una scelta che
 * nessun render riesce piu' a onorare, e Settings mostrerebbe un valore che non si puo' salvare.
 */
function nearestAllowedDuration(seconds: number, model: string): number {
  const known = isKnownVideoModel(model) ? model : null;
  const clamped = clampVideoDuration(seconds, known);
  const allowed = videoDurationOptions(known);
  if (!allowed.length || allowed.includes(clamped)) return clamped;

  return allowed.reduce((best, s) => (Math.abs(s - clamped) < Math.abs(best - clamped) ? s : best));
}
