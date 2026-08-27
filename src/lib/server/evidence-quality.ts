/**
 * EVIDENCE QUALITY — the discipline that keeps every automated read of performance honest.
 *
 * WHY THIS MATTERS MORE HERE THAN IN A CONSULTANT'S DECK. Anomalia does not hand a human a chart to
 * interpret: `analytics-review-agent.ts` reads last week's numbers and then REWRITES next week's
 * editorial brief, edits pending captions and proposes GTM changes. An agent that acts on five
 * posts and calls the top one a winner has changed the brand's strategy on noise — and it will do
 * it again every week, in a different direction each time, which looks exactly like a product that
 * cannot make up its mind.
 *
 * Marketing analysis fails less from missing data than from motivated reading of the data that
 * exists. The job of this module is the boring one: say what the numbers can support, refuse to say
 * more, and name the cheapest observation that would settle it.
 *
 * Pure: no clock, no I/O, no randomness. Adapted from Yuzzyuk/marketing-os (`analytics.md`, MIT) —
 * see `docs/35-marketing-doctrine.md`.
 */

/** How a claim was arrived at, strongest to weakest. Always state which level a claim sits at. */
export type EvidenceDesign = 'experiment' | 'natural' | 'cohort' | 'trend' | 'anecdote' | 'vibes';

export const EVIDENCE_LEVELS: Array<{ design: EvidenceDesign; level: 1 | 2 | 3 | 4 | 5 | 6; label: string }> = [
  { design: 'experiment', level: 1, label: 'Esperimento controllato (split randomizzato, una variabile, metrica e campione dichiarati prima)' },
  { design: 'natural', level: 2, label: 'Esperimento naturale (un prima/dopo pulito attorno a un singolo cambiamento isolato)' },
  { design: 'cohort', level: 3, label: 'Confronto fra coorti (stessa metrica su gruppi comparabili, confondenti nominati)' },
  { design: 'trend', level: 4, label: 'Correlazione di trend (si sono mossi insieme; causa ignota)' },
  { design: 'anecdote', level: 5, label: 'Aneddoto (un cliente ha detto; un competitor ha fatto)' },
  { design: 'vibes', level: 6, label: 'Sensazione del team' }
];

export function levelOf(design: EvidenceDesign): 1 | 2 | 3 | 4 | 5 | 6 {
  return EVIDENCE_LEVELS.find((l) => l.design === design)!.level;
}

/**
 * Sample-size floors. Ten conversions is noise; fifty is directional; real confidence needs volume
 * proportional to how small the effect is. These are the honest bands, not a significance test —
 * calling them thresholds for "significance" would be the same fake precision they exist to stop.
 */
export const SAMPLE_NOISE_CEILING = 10;
export const SAMPLE_DIRECTIONAL_CEILING = 50;

export type SampleVerdict = 'insufficient' | 'directional' | 'usable';

/**
 * How many observations PER ARM are needed to detect a relative lift on a given baseline rate.
 *
 * WHY A FORMULA AND NOT A LOOKUP TABLE. The tables that circulate for this are systematically
 * OPTIMISTIC — the common one understates by 5-20% (it says 12K where the arithmetic gives 14.4K
 * on a 10% baseline at a 10% lift). A table that understates the sample makes people stop tests
 * early, which is the single mistake this whole discipline exists to prevent, so we compute it.
 *
 * The standard normal approximation for two proportions at 80% power and alpha 0.05 two-sided:
 *
 *     n ~= 16 * p(1 - p) / d^2      where d = p * relativeLift
 *
 * It is an APPROXIMATION and the report says so. It is accurate enough for the only decision it
 * feeds — "can our traffic produce this in a sane window, or must we test a bigger swing?" — and
 * being roughly right about that beats being precisely wrong about significance.
 *
 * Returns `null` for inputs that cannot produce a number (a baseline outside 0..1, a lift of 0).
 */
export function requiredSamplePerArm(baselineRate: number, relativeLift: number): number | null {
  if (!Number.isFinite(baselineRate) || baselineRate <= 0 || baselineRate >= 1) return null;
  if (!Number.isFinite(relativeLift) || relativeLift <= 0) return null;
  const delta = baselineRate * relativeLift;
  const n = (16 * baselineRate * (1 - baselineRate)) / (delta * delta);
  if (!Number.isFinite(n)) return null;
  // Two significant figures: the inputs are estimates, so a sample size to the unit is theatre.
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.ceil(n / magnitude) * magnitude;
}

export function sampleVerdict(n: number): SampleVerdict {
  if (!Number.isFinite(n) || n < SAMPLE_NOISE_CEILING) return 'insufficient';
  if (n < SAMPLE_DIRECTIONAL_CEILING) return 'directional';
  return 'usable';
}

/**
 * Can `items` options be ranked against each other on `n` total observations?
 *
 * Ranking is far more demanding than judging one number: each option carries only n/items of the
 * evidence, and the differences being read are between the options, not against zero. Five posts
 * ranked 1-5 on a week of data is a sort of random noise presented as a leaderboard.
 */
export function rankingIsSafe(n: number, items: number): boolean {
  if (items < 2) return true;
  return n / items >= SAMPLE_DIRECTIONAL_CEILING;
}

export type EvidenceTrapId =
  | 'small_sample'
  | 'ranking_on_noise'
  | 'peeking'
  | 'survivorship'
  | 'regression_to_mean'
  | 'simpsons_paradox'
  | 'attribution_window'
  | 'seasonality'
  | 'vanity_metric'
  | 'goodhart';

export type EvidenceTrap = { id: EvidenceTrapId; note: string };

export type EvidenceInput = {
  /** How the read was arrived at. When unsure, it is a trend, not an experiment. */
  design: EvidenceDesign;
  /** Observations behind the claim, in whatever unit actually matters (posts, conversions, clicks). */
  sample: number;
  /** What one observation is: 'post pubblicati', 'conversioni', … Used verbatim in the block. */
  unit: string;
  /** The period and, for paid media, the attribution setting. Stated on every claim. */
  window?: string | null;
  /** How many options the read is being asked to rank. 1 or 0 = not a ranking. */
  rankedItems?: number;
  /** True when the analysis stopped at the first favourable-looking check. */
  peeked?: boolean;
  /** True when only the items that survived selection are being compared. */
  survivorsOnly?: boolean;
  /** True when the thing being judged was the previous period's best performer. */
  wasPreviousBest?: boolean;
  /** True when the aggregate view and the per-segment view disagree. */
  segmentsDisagree?: boolean;
  /** True when the attribution window or platform measurement changed inside the period. */
  measurementChanged?: boolean;
  /** True when the periods being compared are not seasonally comparable. */
  unlikePeriods?: boolean;
  /** True when the headline metric is impressions/opens — the algorithm's mood, not value. */
  vanityMetric?: boolean;
  /** True when a KPI improbably improved right after it became a target. */
  improbableImprovement?: boolean;
  /** Is the decision this feeds cheap to revert? Ships directional winners; blocks the rest. */
  reversible?: boolean;
  /**
   * The current conversion rate the read is about, 0..1. With `minDetectableLift` this turns the
   * "cheapest next observation" from generic advice into an actual number — which is what turns
   * "we need more data" into "our traffic cannot produce this, test a bigger swing".
   */
  baselineRate?: number | null;
  /** The smallest RELATIVE improvement worth detecting, e.g. 0.2 for +20%. */
  minDetectableLift?: number | null;
};

export type EvidenceRead = {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  levelLabel: string;
  sample: number;
  unit: string;
  window: string;
  sampleVerdict: SampleVerdict;
  traps: EvidenceTrap[];
  /** The defensible claim at this level and sample. */
  canSupport: string;
  /** The claim the reader probably wants and cannot have. */
  cannotSupport: string;
  /** The test or data that would most change the decision, for the least money. */
  cheapestNextObservation: string;
  /** True when a change may be shipped on this read: reversible, or evidence strong enough. */
  safeToAct: boolean;
};

function detectTraps(input: EvidenceInput): EvidenceTrap[] {
  const traps: EvidenceTrap[] = [];
  const verdict = sampleVerdict(input.sample);

  if (verdict === 'insufficient') {
    traps.push({
      id: 'small_sample',
      note: `${input.sample} ${input.unit}: rumore. Sotto ${SAMPLE_NOISE_CEILING} osservazioni non c'è niente da leggere.`
    });
  } else if (verdict === 'directional') {
    traps.push({
      id: 'small_sample',
      note: `${input.sample} ${input.unit}: direzionale, non conclusivo. Servono ~${SAMPLE_DIRECTIONAL_CEILING} osservazioni per una lettura solida.`
    });
  }

  const items = input.rankedItems ?? 0;
  if (items >= 2 && !rankingIsSafe(input.sample, items)) {
    traps.push({
      id: 'ranking_on_noise',
      note: `Classificare ${items} opzioni su ${input.sample} ${input.unit} vuol dire ~${Math.floor(input.sample / items)} osservazioni per opzione: la classifica è un ordinamento del rumore. Dire "non c'è segnale per ordinarle" è una risposta legittima e spesso quella giusta.`
    });
  }

  if (input.peeked) {
    traps.push({
      id: 'peeking',
      note: "Risultato guardato in corsa e fermato al primo giorno che sembrava significativo: le 'significatività' precoci si ribaltano di routine. Il risultato è compromesso, non inutile — trattalo come direzionale."
    });
  }

  if (input.survivorsOnly) {
    traps.push({
      id: 'survivorship',
      note: 'Stiamo confrontando solo ciò che è sopravvissuto alla selezione. Il confronto non dice nulla su ciò che è stato ucciso: o si chiede lo storico completo, o si dichiara che la lettura è condizionata alla sopravvivenza.'
    });
  }

  if (input.wasPreviousBest) {
    traps.push({
      id: 'regression_to_mean',
      note: "Il soggetto era il migliore del periodo precedente: parte del suo calo è aritmetica, non stanchezza creativa. Non diagnosticare fatigue da 'il nostro vincitore è sceso'."
    });
  }

  if (input.segmentsDisagree) {
    traps.push({
      id: 'simpsons_paradox',
      note: "L'aggregato e i segmenti dicono cose diverse. Quando succede, il segmento è quasi sempre la lettura vera: controlla il mix prima di concludere."
    });
  }

  if (input.measurementChanged) {
    traps.push({
      id: 'attribution_window',
      note: 'La finestra di attribuzione o la misurazione è cambiata dentro il periodo. Un confronto attraverso quel cambio può invertire completamente la classifica: va dichiarato, non attraversato in silenzio.'
    });
  }

  if (input.unlikePeriods) {
    traps.push({
      id: 'seasonality',
      note: 'I periodi confrontati non sono comparabili. Il Q4 non è il Q1, il lunedì non è il sabato, e nessuna conclusione creativa è visibile attraverso quel rumore.'
    });
  }

  if (input.vanityMetric) {
    traps.push({
      id: 'vanity_metric',
      note: "Impression e aperture misurano l'umore dell'algoritmo, non il valore del contenuto. Giudica su risposte, salvataggi, visite al profilo, DM: un post da 50k impression che non produce nulla è decorazione."
    });
  }

  if (input.improbableImprovement) {
    traps.push({
      id: 'goodhart',
      note: 'Una metrica è migliorata in modo improbabile subito dopo essere diventata un obiettivo. Prima di crederci, chiedi cosa è cambiato nel modo in cui viene misurata o perseguita.'
    });
  }

  return traps;
}

/**
 * Turn what we know about a read into an explicit statement of what it can and cannot support.
 *
 * Refusing every conclusion below level 2 is its own failure mode — businesses decide weekly. So
 * this labels the confidence instead of withholding the read, and distinguishes reversible
 * decisions (ship the directional winner) from irreversible ones (pricing, positioning, brand),
 * where real evidence is required.
 */
export function assessEvidence(input: EvidenceInput): EvidenceRead {
  const level = levelOf(input.design);
  const levelLabel = EVIDENCE_LEVELS.find((l) => l.design === input.design)!.label;
  const verdict = sampleVerdict(input.sample);
  const traps = detectTraps(input);
  const reversible = input.reversible !== false;

  const canSupport =
    verdict === 'insufficient'
      ? `Nessuna classifica e nessun vincitore. Al massimo: "ecco cosa abbiamo pubblicato e cosa è successo", senza attribuire causa.`
      : verdict === 'directional'
        ? `Una lettura DIREZIONALE (livello ${level}): una direzione plausibile, con l'etichetta di confidenza attaccata. Va bene per una decisione reversibile.`
        : `Una lettura di livello ${level} su ${input.sample} ${input.unit}: una differenza reale fra opzioni, se l'effetto non è piccolo.`;

  const cannotSupport =
    level >= 4
      ? `Una relazione causale. Si sono mossi insieme; perché, non lo sappiamo. E non può sostenere una decisione irreversibile (prezzo, posizionamento, brand).`
      : verdict === 'usable'
        ? 'Effetti piccoli. Una differenza sotto la manciata di punti percentuali resta indistinguibile dal rumore a questo volume.'
        : 'Un vincitore dichiarato. Il campione non regge la parola "vince".';

  // When the caller knows the baseline and the lift worth catching, say the actual number instead of
  // "accumulate more": a team that can see it needs 13.000 observations per arm stops arguing about
  // the test and starts testing something bigger.
  const needed =
    input.baselineRate != null && input.minDetectableLift != null
      ? requiredSamplePerArm(input.baselineRate, input.minDetectableLift)
      : null;
  const powered = needed
    ? ` Per rilevare un +${Math.round((input.minDetectableLift as number) * 100)}% su un tasso base del ${(
        (input.baselineRate as number) * 100
      ).toFixed(1)}% servono circa ${needed.toLocaleString('it-IT')} ${input.unit} PER VARIANTE (approssimazione, potenza 80%, alpha 0.05). Se il traffico non li produce in una finestra sensata la risposta non e' aspettare: e' testare uno scarto piu' grande.`
    : '';

  const cheapestNextObservation =
    verdict === 'insufficient'
      ? `Accumulare fino a ~${SAMPLE_DIRECTIONAL_CEILING} ${input.unit} prima di rileggere, oppure testare uno scarto grande (offerta, angolo, pagina) invece di una differenza fine: gli effetti piccoli richiedono volumi che non abbiamo.${powered}`
      : level >= 3
        ? `Una settimana di traffico correttamente diviso su UNA variabile — oppure cinque conversazioni con clienti, che a questi volumi dicono più di un altro mese di dati osservazionali.${powered}`
        : `Portare il test al campione dichiarato prima di leggerlo di nuovo.${powered}`;

  // A directional read may ship a reversible change; an irreversible one needs real evidence, and
  // nothing ships on noise.
  const safeToAct = verdict === 'insufficient' ? false : reversible ? true : verdict === 'usable' && level <= 3;

  return {
    level,
    levelLabel,
    sample: input.sample,
    unit: input.unit,
    window: input.window?.trim() || 'finestra non dichiarata',
    sampleVerdict: verdict,
    traps,
    canSupport,
    cannotSupport,
    cheapestNextObservation,
    safeToAct
  };
}

/**
 * The block every analysis this module touches ends with, filled honestly. Printed into agent
 * prompts and into the weekly recap, so the same discipline reaches the model and the human.
 */
export function evidenceBlock(read: EvidenceRead): string {
  const lines = [
    'QUALITÀ DELL’EVIDENZA',
    `Livello: ${read.level}/6 — ${read.levelLabel}`,
    `Campione: ${read.sample} ${read.unit} · Finestra: ${read.window}`,
    `Cosa PUÒ sostenere: ${read.canSupport}`,
    `Cosa NON PUÒ sostenere: ${read.cannotSupport}`,
    `Osservazione più economica che alzerebbe il livello: ${read.cheapestNextObservation}`
  ];
  if (read.traps.length) {
    lines.push('Trappole attive in questa lettura:');
    for (const t of read.traps) lines.push(`- ${t.note}`);
  }
  return lines.join('\n');
}

/**
 * One line for a caller that only has room for a label — a chart caption, an email subline.
 */
export function confidenceLabel(read: EvidenceRead): string {
  if (read.sampleVerdict === 'insufficient') return 'segnale insufficiente';
  if (read.sampleVerdict === 'directional') return 'direzionale';
  return `livello ${read.level}`;
}
