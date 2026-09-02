/**
 * I sei mestieri che un brand puo' affidare a modelli diversi, in un elenco solo.
 *
 * Erano un form per mestiere, ciascuno con la sua azione, la sua chiave i18n e la sua validazione
 * copiata: due mestieri esistevano e la ripetizione si notava appena. A sei, ogni regola nuova —
 * "un modello che non sa fare il lavoro non si salva" — andrebbe scritta sei volte e divergerebbe
 * al primo cambio, in silenzio. Qui e' una riga per mestiere e una validazione sola.
 *
 * `pref` e' la chiave su `content_prefs`. `role` esiste solo per i video: dice quali modelli il
 * selettore puo' offrire, ed e' la stessa cosa che il renderer legge per scegliere l'id kie — cosi'
 * il selettore non puo' offrire un modello che il renderer poi rifiuta.
 */
import { IMAGE_MODEL_CHOICES, isKnownImageModelId } from '$lib/image-models';
import { videoModelsForRole, videoModelSpec, type VideoRole } from '$lib/video-models';

export type MediaModelSlot = {
  /** Il nome nel form e nell'azione. */
  id: string;
  /** La chiave su `content_prefs`. */
  pref: string;
  /** I video scelgono per ruolo; le immagini pescano dall'unico catalogo. */
  role: VideoRole | null;
  /** Il suffisso delle chiavi i18n: `app.settings.video.slots.<i18n>` e `…Desc`. */
  i18n: string;
};

export const MEDIA_MODEL_SLOTS: MediaModelSlot[] = [
  { id: 'imageModel', pref: 'imageModel', role: null, i18n: 'imageGenerate' },
  { id: 'imageRefineModel', pref: 'imageRefineModel', role: null, i18n: 'imageRefine' },
  { id: 'videoModel', pref: 'videoModel', role: 'text', i18n: 'videoGenerate' },
  { id: 'videoImageModel', pref: 'videoImageModel', role: 'image', i18n: 'videoAnimate' },
  { id: 'videoRefineModel', pref: 'videoRefineModel', role: 'refine', i18n: 'videoRefine' },
  { id: 'videoMotionModel', pref: 'videoMotionModel', role: 'motion', i18n: 'videoMotion' }
];

export function mediaModelSlot(id: unknown): MediaModelSlot | undefined {
  const v = String(id ?? '').trim();
  return MEDIA_MODEL_SLOTS.find((s) => s.id === v);
}

/** I modelli che questo mestiere puo' davvero usare. */
export function slotChoices(slot: MediaModelSlot): { id: string; label: string }[] {
  if (!slot.role) return IMAGE_MODEL_CHOICES.map((c) => ({ id: c.id, label: c.label }));
  return videoModelsForRole(slot.role);
}

/**
 * Un modello e' salvabile in uno slot solo se sa fare QUEL mestiere. Senza questo controllo il
 * form accetterebbe un modello che il renderer poi scarta, e la preferenza esisterebbe senza fare
 * nulla — il modo piu' silenzioso di non funzionare.
 */
export function slotAccepts(slot: MediaModelSlot, model: string): boolean {
  if (!slot.role) return isKnownImageModelId(model);
  return videoModelSpec(model)?.roles.includes(slot.role) ?? false;
}
