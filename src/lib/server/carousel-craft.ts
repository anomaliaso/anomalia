/**
 * IL MESTIERE DEL CAROSELLO, in un posto solo.
 *
 * Viveva dentro il prompt del batch in `caption-quality.ts` e serve anche al tool `generate_carousel`.
 * Riscriverlo li' avrebbe prodotto due copie che divergono alla prima correzione; riassumerlo
 * avrebbe perso le parti che lo fanno funzionare — «ripeti gli STESSI 2-3 gettoni ALLA LETTERA» non
 * sopravvive a «mantieni uno stile coerente», e nessun test se ne accorgerebbe.
 *
 * Il pezzo che decide se esce un carosello o N immagini scollegate sono i GETTONI DI CONTINUITA':
 * le stesse 2-3 parole, ripetute verbatim in ogni prompt di slide.
 */
export const CAROUSEL_CRAFT =
  "CAROUSEL CRAFT (hard): the COVER must read at THUMBNAIL size — one subject, large simple shapes, high contrast, at most 4 quoted words of text; each later slide carries exactly ONE idea (a slide that needs two sentences to describe is two slides); and repeat the SAME 2-3 continuity tokens (palette words, recurring motif, lighting phrase) verbatim in EVERY slide prompt so the rendered series reads as one object, not N unrelated images.";

/** Quante slide puo' avere: il minimo perche' sia una serie, il massimo della piattaforma. */
export { CAROUSEL_MIN_SLIDES, carouselMaxSlides } from './content-preview/seed-model';
