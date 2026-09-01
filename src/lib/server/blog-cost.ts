/**
 * Pre-flight cost estimate for a month of blog generation, in CREDITS (100 credits = $1, the same
 * unit credits.ts bills in).
 *
 * WHY IT EXISTS: gateCredits() is a *reactive* breaker — it stops a flow once the quota is already
 * gone, which for a month job means aborting halfway and leaving 14 finished articles and 16 empty
 * placeholders. This lets the button refuse up front instead, with a number the user can act on.
 *
 * Every figure below is derived from MEASURED token volumes (ai_calls, 14 days to 2026-08-04) priced
 * through computeCostUsd(). Measured averages per call:
 *
 *   return_blog_article   in 1407  out 2879     (× VARIANTS, bestVariant generates then picks)
 *   pick_best             in  629  out  155
 *   humanize_article      in 3212  out 2807
 *   blog_optimize         in 4545  out 5056
 *   renderPostImage       in 1777  out 1347     (out is dominated by the flat image-token charge)
 *
 * PREZZI DA UN POSTO SOLO. Qui c'erano le tariffe DeepSeek ($0.14/$0.28 per 1M) scritte a mano.
 * Quando il lavoro di sfondo è tornato su Gemini Flash ($1.50/$7.50) questi numeri sono rimasti
 * indietro e il preventivo è diventato ~10-27× troppo basso: il gate che esiste apposta per non far
 * partire un mese che non può finire dava il via libera a mesi che sarebbero morti a metà. Ora il
 * prezzo lo calcola computeCostUsd() con la stessa tabella con cui i crediti vengono davvero
 * addebitati — una tariffa copiata in un secondo posto è esattamente il difetto di prima.
 *
 * Resta un limite SUPERIORE: assume il caso peggiore per la ricerca grounded, prezza l'output
 * immagine alla più alta delle due cifre che Google pubblica, e ignora i prefix-cache hit.
 * Sovrastimare è sicuro; sottostimare fa partire un lavoro che non può finire.
 */
import { computeCostUsd } from '$lib/server/ai-log';
import { geminiFlash } from '$lib/server/gemini';

// Nano Banana 2 — lo stesso id che content-preview.ts usa per le immagini degli articoli
// (BLOG_IMAGE_MODEL). Importato come stringa e non dal modulo: content-preview si porta dietro
// mezza pipeline di rendering, e qui serve solo una chiave della tabella prezzi.
const BLOG_IMAGE_MODEL = 'gemini-3.1-flash-image';

const CREDITS_PER_USD = 100;

/** USD of one call at the measured volumes, priced exactly as ai_calls will bill it. */
const usd = (model: string, inTok: number, outTok: number, imageOut = 0): number =>
  computeCostUsd({
    label: 'estimate',
    provider: 'gemini',
    model,
    ms: 0,
    ok: true,
    inputTokens: inTok,
    outputTokens: outTok,
    imageOutputTokens: imageOut
  }) ?? 0;

/** One background text call — Gemini Flash, the model that actually writes the articles. */
const text = (inTok: number, outTok: number) => usd(geminiFlash(), inTok, outTok);

/** One Nano Banana 2 image. Batch mode is billed at 50% of interactive. */
const image = (batch: boolean) => usd(BLOG_IMAGE_MODEL, 1777, 1347, 1347) * (batch ? 0.5 : 1);

// La ricerca grounded (fonti esterne per il passaggio di optimize) passa da groundedText, che ora
// parte da Google grounding: ~$0.07 fra i $14/1k query e i token Gemini, e solo se quello fallisce
// scende su DeepSeek/Exa/Tavily, che costano una frazione. Il vecchio $0.004 era il prezzo del
// PRIMO RIPIEGO scambiato per il prezzo del passaggio — 17× sotto il caso peggiore. Stesso numero
// e stesso motivo di ESTIMATED_SEARCH_USD in strategy-agent.ts.
const GROUNDED_USD = 0.07;

// bestVariant generates this many candidates and then picks one.
const ARTICLE_VARIANTS = 3;

// Cover + in-article images per article (generateArticleImages caps in-article at 2).
const IMAGES_PER_ARTICLE = 3;

/** Text-only cost of one article: variants + pick + humanize + optimize + grounded research. */
function articleTextUsd(): number {
  return (
    ARTICLE_VARIANTS * text(1407, 2879) +
    text(629, 155) +
    text(3212, 2807) +
    text(4545, 5056) +
    GROUNDED_USD
  );
}

/**
 * A translation re-writes the finished body into another language and REUSES the images, so it is
 * one text pass at roughly the humanize volume — which is why translations are cheap next to the
 * image bill, and why they can be a plan perk rather than a metered add-on.
 */
function translationUsd(): number {
  return text(3212, 2807);
}

export type BlogMonthEstimate = {
  articles: number;
  translations: number;
  /** Whole credits, rounded up — never quote a number the job can undercut. */
  credits: number;
  usd: number;
  breakdown: { text: number; images: number; translations: number };
};

/**
 * Estimate a whole month's generation.
 * `mode: 'fast'` skips the image batch (rendered inline at full price); 'batch' gets the 50% discount.
 * `translationsPerArticle` is the plan's extra-language count (0 below the top tier).
 */
export function estimateBlogMonth(opts: {
  articles: number;
  mode?: 'batch' | 'fast';
  translationsPerArticle?: number;
}): BlogMonthEstimate {
  const articles = Math.max(0, Math.floor(opts.articles));
  const perArticleTranslations = Math.max(0, Math.floor(opts.translationsPerArticle ?? 0));
  const batch = opts.mode !== 'fast';

  const textUsd = articles * articleTextUsd();
  const imagesUsd = articles * IMAGES_PER_ARTICLE * image(batch);
  const translations = articles * perArticleTranslations;
  const translationsUsd = translations * translationUsd();
  const usd = textUsd + imagesUsd + translationsUsd;

  return {
    articles,
    translations,
    credits: Math.ceil(usd * CREDITS_PER_USD),
    usd,
    breakdown: {
      text: Math.ceil(textUsd * CREDITS_PER_USD),
      images: Math.ceil(imagesUsd * CREDITS_PER_USD),
      translations: Math.ceil(translationsUsd * CREDITS_PER_USD)
    }
  };
}

/**
 * Quanti articoli il brand può PERMETTERSI, dato quanti ne vuole e quanti crediti gli restano.
 *
 * Il preventivo qui sopra esisteva già per non far partire un mese che non può finire, ma era
 * collegato al solo bottone manuale: `planBlogMonth` — il percorso che gira da solo, autopilot e
 * scheduler — pianificava per quota e ignorava il costo. Cioè proprio il guasto descritto in cima
 * a questo file, lasciato aperto sul percorso dove nessuno guarda.
 *
 * Budget sconosciuto → non taglia niente: un vincolo inventato è peggio di un vincolo assente.
 */
export function articlesAffordable(
  wanted: number,
  remainingCredits: number | null | undefined,
  opts: { mode?: 'batch' | 'fast'; translationsPerArticle?: number } = {}
): number {
  const want = Math.max(0, Math.floor(wanted));
  if (remainingCredits == null || !Number.isFinite(remainingCredits)) return want;
  const perArticle = estimateBlogMonth({ articles: 1, ...opts }).credits;
  if (perArticle <= 0) return want;
  return Math.max(0, Math.min(want, Math.floor(remainingCredits / perArticle)));
}
