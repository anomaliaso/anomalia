/**
 * Il modello con cui si disegna quando il brand non ha scelto.
 *
 * Non è una costante: LEGGE la rotta dello slot. Prima erano due decisioni separate — la famiglia
 * su cui instradare e l'id da mettere nella richiesta — e potevano dire cose diverse. Il trasporto
 * però si sceglie sull'id, quindi una rotta `gpt-image@openrouter` con un id Gemini dentro sarebbe
 * finita sul trasporto di Gemini: la rotta si legge come rispettata senza esserlo, che è il guasto
 * che il registro esiste per impedire.
 *
 * Una riga per famiglia, e la riga è l'unica cosa da aggiungere il giorno che ne arriva un'altra.
 */
import { GPT_IMAGE_25_SUNBURST_MODEL } from '$lib/image-models';
import { NANO_BANANA_2_LITE } from '$lib/server/google-models';
import { route, type ModelFamily } from '$lib/server/model-routing';

const DEFAULT_BY_FAMILY: Partial<Record<ModelFamily, string>> = {
  // Sunburst e non Flare: stesso prezzo, 15,0s contro 10,5s, ma è il taglio di precisione — e qui
  // dentro le immagini portano testo, che sbagliato si rifà.
  'gpt-image': GPT_IMAGE_25_SUNBURST_MODEL
};

export function defaultImageModel(): string {
  return DEFAULT_BY_FAMILY[route('image').family] ?? NANO_BANANA_2_LITE;
}
