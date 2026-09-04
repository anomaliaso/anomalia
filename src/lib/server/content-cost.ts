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
 *   video.render               una clip — NON un numero solo: v. videoCredits(), cambia di 17× col modello
 *   planStrategy      n=369   $0.033  ┐
 *   executePlan       n=410   $0.038  ├ il testo di un batch, indipendente da quanti post contiene
 *   reviewSeeds       n=354   $0.024  ┘
 *
 * Il repo aveva già DUE prezzi per un video, diversi fra loro e nessuno dei due misurato: ~25× un
 * immagine in un commento di weekly-planner.ts, e $0.41 in UNIT_COST_USD di plans.ts, su cui sono
 * dimensionate le quote dei piani. La misura dice che dipende dal modello e cambia di 17 volte, il
 * che rende sbagliato ogni numero unico — incluso quello che questo file conteneva prima.
 *
 * NON duplica una tariffa: il costo del video è il flat cost che il provider ci fattura e che
 * `video.ts` registra già in `ai_calls`. Qui vive la MEDIA misurata, che è un'altra cosa da una
 * tariffa copiata — e va rimisurata quando cambia il modello di default.
 */
import type { ContentFormat } from '$lib/content-formats';
import { videoModel } from '$lib/server/model-routing';

const CREDITS_PER_USD = 100;
const credits = (usd: number): number => Math.round(usd * CREDITS_PER_USD);

/**
 * Un'immagine pubblicabile: UN render, e basta.
 *
 * Prima era `0.069 + 0.008`, il render più il critico che la rileggeva. Il critico non c'è più —
 * e con lui i due candidati paralleli e i ritentativi, che questo numero non ha mai contato: la
 * misura diceva ~4 render pagati per ogni immagine consegnata, 1.058 render per ~250 artefatti in
 * 30 giorni. Adesso il prezzo dichiarato e quello addebitato sono la stessa cosa.
 */
export const IMAGE_CREDITS = credits(0.069);

/**
 * Una clip, al prezzo del modello che la renderizzerà davvero. La copertina si conta a parte: è un
 * render come gli altri.
 *
 * NON è un numero solo, e questo è il punto: fra i due modelli il prezzo cambia di 17 volte.
 * Mediane misurate su `ai_calls` al 2026-08-31 —
 *
 *   grok-imagine-video-1-5   n=30   $0.12    il DEFAULT (model-routing: i2v/t2v)
 *   bytedance/seedance-2-5   n=63   $2.10    22s con audio, i creativi degli ads
 *
 * Una media fra i due ($1.18) sbaglia su entrambi, e nel prompt diventa il consiglio sbagliato
 * sulla decisione più cara che chi pianifica prende: col default un video vale ~2 immagini, non
 * un'intera storia illustrata. Un modello che non conosciamo si prezza al più caro — sovrastimare
 * fa pianificare meno del possibile, sottostimare fa partire lavori che non finiscono.
 */
const VIDEO_USD: Array<[test: RegExp, usd: number]> = [
  [/^bytedance\/seedance/, 2.1],
  [/^grok-imagine/, 0.12]
];
const VIDEO_USD_UNKNOWN = 2.1;

export function videoCredits(model = videoModel('i2v')): number {
  const hit = VIDEO_USD.find(([test]) => test.test(model));
  return credits(hit ? hit[1] : VIDEO_USD_UNKNOWN);
}

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
      return videoCredits() + IMAGE_CREDITS;
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
  const video = videoCredits() + IMAGE_CREDITS;
  return `PRODUCTION BUDGET — you decide the mix, and it has a price. This batch has ${Math.max(0, Math.round(remainingCredits))} credits left, and producing it costs:
- single_image: ${IMAGE_CREDITS} credits
- carousel: ${IMAGE_CREDITS} per slide (${carousel(4)} for four, ${carousel(6)} for six, ${carousel(8)} for eight)
- video: ${video} credits — the clip plus its cover, about ${Math.round(video / IMAGE_CREDITS)} single images
- text_post / link_post: free to produce
- planning this batch at all: ${BATCH_TEXT_CREDITS} credits
Spend it the way the week deserves rather than spreading it evenly, and read the numbers above rather than assuming: what a clip costs against a carousel changes with the model in use, so the trade-off this week may not be the one you would guess. Stay inside the budget — a batch that cannot be produced is worse than a smaller one that can.`;
}
