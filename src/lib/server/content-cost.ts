/**
 * Quanto costa PRODURRE un post, in crediti (100 crediti = $1, la stessa unità di credits.ts).
 *
 * PERCHÉ ESISTE: il mix di formati di una settimana era deciso da numeri scritti a mano nei punti
 * di chiamata — `maxVideos: 1` in cinque file, `maxCarousels` da una variabile d'ambiente — e
 * l'agente non ha mai saputo cosa costasse quello che sceglieva. Un tetto fisso non è una scelta
 * editoriale: è l'assenza di una scelta. Con un listino e un budget la domanda diventa quella
 * giusta — questa settimana un fumetto da otto riquadri o due video? — e la può fare l'agente.
 *
 * I NUMERI SONO MISURATI, NON STIMATI. Mediane di `ai_calls` in produzione al 2026-08-31:
 *
 *   renderPostImage   n=994   $0.069     una immagine renderizzata
 *   critiqueImage     n=831   $0.008     il critico che la rilegge (gira su ogni render)
 *   video.render      n= 97   $1.181     una clip (media: il flat cost del provider non ha mediana utile)
 *   planStrategy      n=369   $0.033  ┐
 *   executePlan       n=410   $0.038  ├ il testo di un batch, indipendente da quanti post contiene
 *   reviewSeeds       n=354   $0.024  ┘
 *
 * Il commento in weekly-planner.ts diceva che una clip costa ~25 volte un'immagine. Misurato, sono
 * ~16. Un rapporto sbagliato nel prompt fa scegliere male all'agente proprio sulla decisione più
 * cara che prende, ed è il motivo per cui questo file esiste invece di un numero in un commento.
 *
 * NON duplica una tariffa: il costo del video è il flat cost che il provider ci fattura e che
 * `video.ts` registra già in `ai_calls`. Qui vive la MEDIA misurata, che è un'altra cosa da una
 * tariffa copiata — e va rimisurata quando cambia il modello di default.
 */
import type { ContentFormat } from '$lib/content-formats';

const CREDITS_PER_USD = 100;
const credits = (usd: number): number => Math.round(usd * CREDITS_PER_USD);

/** Un'immagine pubblicabile: il render più il critico che la rilegge e la fa ritentare. */
export const IMAGE_CREDITS = credits(0.069 + 0.008);

/** Una clip. La copertina si conta a parte: è un render come gli altri. */
export const VIDEO_CREDITS = credits(1.181);

/** Il testo di un batch — piano, produzione, revisione — che non cresce col numero di post. */
export const BATCH_TEXT_CREDITS = credits(0.033 + 0.038 + 0.024);

/** Quante slide vale un carosello di cui nessuno ha ancora detto la lunghezza. */
const DEFAULT_SLIDES = 5;

export type PlannedPost = { format: ContentFormat; slideCount?: number };

export function creditsForPost(post: PlannedPost): number {
  switch (post.format) {
    case 'text_post':
    case 'link_post':
      // Niente da renderizzare: il testo è già contato nel costo fisso del batch.
      return 0;
    case 'carousel':
      return Math.max(1, Math.round(post.slideCount ?? DEFAULT_SLIDES)) * IMAGE_CREDITS;
    case 'video':
      return VIDEO_CREDITS + IMAGE_CREDITS;
    default:
      return IMAGE_CREDITS;
  }
}

export function creditsForBatch(posts: PlannedPost[]): number {
  return BATCH_TEXT_CREDITS + posts.reduce((sum, p) => sum + creditsForPost(p), 0);
}

/**
 * Il listino come lo legge chi pianifica. Vuoto quando il budget non si sa: un brief che inventa
 * un numero fa prendere decisioni su un vincolo che non esiste.
 */
export function budgetBrief(remainingCredits: number | null | undefined): string {
  if (remainingCredits == null || !Number.isFinite(remainingCredits)) return '';
  const carousel = (n: number) => n * IMAGE_CREDITS;
  return `PRODUCTION BUDGET — you decide the mix, and it has a price. This batch has ${Math.max(0, Math.round(remainingCredits))} credits left, and producing it costs:
- single_image: ${IMAGE_CREDITS} credits
- carousel: ${IMAGE_CREDITS} per slide (${carousel(4)} for four, ${carousel(6)} for six, ${carousel(8)} for eight)
- video: ${VIDEO_CREDITS + IMAGE_CREDITS} credits — the clip plus its cover, about ${Math.round((VIDEO_CREDITS + IMAGE_CREDITS) / IMAGE_CREDITS)} single images
- text_post / link_post: free to produce
- planning this batch at all: ${BATCH_TEXT_CREDITS} credits
Spend it the way the week deserves rather than spreading it evenly: one video costs a whole illustrated story, and a story that needs eight panels is worth more than eight posts that need one each. Stay inside the budget — a batch that cannot be produced is worse than a smaller one that can.`;
}
