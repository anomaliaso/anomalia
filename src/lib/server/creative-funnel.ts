/**
 * THE CREATIVE DIAGNOSTIC FUNNEL — which layer of a video is failing, read top-down.
 *
 * WHY IT EXISTS. When a clip underperforms, the reflex is to write new hooks. That reflex is right
 * about a quarter of the time and expensive the rest: fixing a post-click conversion problem with
 * new hooks is the single most common wasted motion in creative testing, and we now spend real
 * money per clip (Seedance renders, Remotion composites, review credits), so guessing wrong costs
 * a production cycle each time.
 *
 * Each metric isolates one layer, and they only mean anything IN ORDER:
 *
 *   thumbstop (3s views / impressions) → the VISUAL and the on-screen text; fix the first frame
 *   hold      (15s views / 3s views)   → the SPOKEN line and the on-ramp; fix the premise, not the hook
 *   CTR       (given healthy hold)     → the ARGUMENT and CTA clarity; fix the offer as stated
 *   CVR       (given healthy CTR)      → POST-CLICK; fix the landing page, stop editing the ad
 *
 * FIX THE FIRST BROKEN STAGE ONLY. A clip can be broken at several layers at once, but the lower
 * numbers are conditional on the higher ones: nobody's CTR means anything if the thumbstop is 2%.
 *
 * THE ON-RAMP COROLLARY. Seconds 3-15 must EXTEND the hook's premise, not start the pitch. So every
 * hook test is also an on-ramp test, and a "the hook failed" verdict is unreliable when the on-ramp
 * changed too. `holdBroken` says so explicitly rather than blaming the opening.
 *
 * UNKNOWN IS NOT ZERO. Organic syncs rarely carry 3s/15s view counts. A missing rate makes its
 * stage unreadable and the diagnosis moves DOWN with that stated, instead of silently treating an
 * absent number as a failure.
 *
 * Pure: no clock, no I/O, no randomness. Adapted from Yuzzyuk/marketing-os (`hooks.md`, MIT) — see
 * `docs/35-marketing-doctrine.md`.
 */

export type FunnelStageId = 'thumbstop' | 'hold' | 'ctr' | 'cvr' | 'healthy' | 'unreadable';

export type FunnelRates = {
  /** 3-second views ÷ impressions. */
  thumbstop?: number | null;
  /** 15-second views ÷ 3-second views. */
  hold?: number | null;
  /** clicks ÷ impressions. */
  ctr?: number | null;
  /** conversions ÷ clicks. */
  cvr?: number | null;
};

/**
 * Floors below which a stage counts as broken.
 *
 * These are working defaults for short-form paid social, not laws — pass `benchmarks` with the
 * account's own medians whenever they exist, because a category's normal thumbstop varies by more
 * than these numbers do.
 */
export const DEFAULT_FUNNEL_FLOORS: Required<FunnelRates> = {
  thumbstop: 0.2,
  hold: 0.25,
  ctr: 0.008,
  cvr: 0.01
};

export type FunnelDiagnosis = {
  stage: FunnelStageId;
  /** Which hook component or asset to change. Names the thing, never "improve the creative". */
  fix: string;
  /** What NOT to do — the wasted motion this stage's diagnosis exists to prevent. */
  doNot: string;
  /** Stages that could not be read because the rate was missing. */
  unreadable: FunnelStageId[];
  /** The rates actually used, after applying the floors. */
  rates: FunnelRates;
};

const known = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Diagnose top-down and stop at the first broken stage.
 *
 * `floors` overrides the defaults per stage; anything omitted keeps the default.
 */
export function diagnoseCreativeFunnel(rates: FunnelRates, floors: Partial<FunnelRates> = {}): FunnelDiagnosis {
  const f = { ...DEFAULT_FUNNEL_FLOORS, ...Object.fromEntries(Object.entries(floors).filter(([, v]) => known(v))) };
  const unreadable: FunnelStageId[] = [];

  if (!known(rates.thumbstop)) unreadable.push('thumbstop');
  else if (rates.thumbstop < (f.thumbstop as number)) {
    return {
      stage: 'thumbstop',
      fix: "L'AZIONE VISIVA del primo secondo e il testo a schermo. Cambia cosa succede nel frame, non cosa viene detto: la voce non è ancora stata ascoltata da nessuno.",
      doNot: 'Non riscrivere la battuta parlata né la CTA: nessuno è arrivato lì.',
      unreadable,
      rates
    };
  }

  if (!known(rates.hold)) unreadable.push('hold');
  else if (rates.hold < (f.hold as number)) {
    return {
      stage: 'hold',
      fix: "La RAMPA D'INGRESSO (secondi 3-15): deve ESTENDERE la premessa dell'hook, non iniziare il pitch. Chi si è fermato su una promessa resta per il perché di quella promessa, non per un giro di funzionalità.",
      doNot:
        "Non dare la colpa all'apertura: il thumbstop regge, quindi l'apertura ha funzionato. E se in questo test è cambiata anche la rampa, il verdetto sull'hook non è affidabile — ogni test dell'hook è anche un test della rampa.",
      unreadable,
      rates
    };
  }

  if (!known(rates.ctr)) unreadable.push('ctr');
  else if (rates.ctr < (f.ctr as number)) {
    return {
      stage: 'ctr',
      fix: "L'ARGOMENTO e la chiarezza della CTA — cioè l'OFFERTA come viene enunciata nel video. Guardano fino in fondo e non cliccano: hanno capito, e non è abbastanza.",
      doNot: 'Non produrre altri hook: la gente guarda già. Il problema è cosa gli stai chiedendo di fare e perché dovrebbero.',
      unreadable,
      rates
    };
  }

  if (!known(rates.cvr)) unreadable.push('cvr');
  else if (rates.cvr < (f.cvr as number)) {
    return {
      stage: 'cvr',
      fix: 'La PAGINA DI DESTINAZIONE, a partire dal message-match: la prima schermata deve mantenere la promessa esatta del video, con le stesse parole.',
      doNot:
        "Non toccare l'annuncio. Sistemare un problema di conversione post-click con nuovi hook è lo spreco più comune del creative testing: brucia una produzione e non muove niente.",
      unreadable,
      rates
    };
  }

  // Everything readable passed. If nothing was readable at all, say that instead of "healthy".
  if (unreadable.length === 4) {
    return {
      stage: 'unreadable',
      fix: 'Nessun tasso disponibile: non c’è niente da diagnosticare. Servono almeno impression e visualizzazioni a 3 secondi.',
      doNot: "Non dedurre un problema creativo dall'assenza di dati.",
      unreadable,
      rates
    };
  }

  return {
    stage: 'healthy',
    fix: 'Nessuno stadio leggibile è sotto la soglia. Se serve un miglioramento, scala la spesa qui e produci il prossimo concetto adesso.',
    doNot: 'Non rifare una creatività che sta funzionando per il gusto di rifarla.',
    unreadable,
    rates
  };
}

/** The printable read, with the unreadable stages named rather than quietly skipped. */
export function funnelBrief(d: FunnelDiagnosis): string {
  const lines = [`FUNNEL: ${d.stage === 'healthy' ? 'nessuno stadio rotto' : `primo stadio rotto = ${d.stage}`}`, `Da cambiare: ${d.fix}`, `Da NON fare: ${d.doNot}`];
  if (d.unreadable.length) {
    lines.push(
      `Stadi non leggibili (tasso assente, contano come evidenza mancante e non come fallimento): ${d.unreadable.join(', ')}.`
    );
  }
  return lines.join('\n');
}
