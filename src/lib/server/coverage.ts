/**
 * COVERAGE-GATED GRADING — the rule that keeps every score in this codebase honest.
 *
 * THE PROBLEM. Every scorer we have collapses "this failed" and "I could not look at this" into the
 * same number. `article-score.ts` marks `alt` as failed when an article has NO images — a check
 * that does not apply, costing 10 points. It marks `plagiarism` and `jsonld` as passed because we
 * never checked them — an unknown promoted to a pass, inflating the grade. `geo.ts` computes
 * `100 - penalties`, so a page it could not fetch silently scores as clean. Three different lies,
 * all from the same missing distinction.
 *
 * THE RULE. A score and the evidence behind it are TWO DIFFERENT NUMBERS and both stay visible.
 *
 *   - Four verdicts per signal, never two: pass / fail / unknown / n.a.
 *   - `unknown` counts against COVERAGE, never against the score. Converting unknowns to fails
 *     inflates urgency; converting them to passes inflates the grade. Both are lies.
 *   - `na` leaves the calculation entirely — it is not evidence missing, it is a question that does
 *     not apply to this subject.
 *   - The score is reported OVER ITS DENOMINATOR: "68/100 su 85% delle dimensioni ispezionate".
 *
 * THE GATE. Coverage decides what we are allowed to publish at all:
 *
 *   | Peso ispezionato | Output consentito                                              |
 *   |------------------|----------------------------------------------------------------|
 *   | >= 80%           | Punteggio pieno, dichiarato sul suo denominatore                |
 *   | 60-79%           | Punteggio PROVVISORIO, con le dimensioni mancanti nominate      |
 *   | < 60%            | NESSUN punteggio: solo i findings + "evidenza insufficiente"    |
 *
 * A number on 40% coverage is a guess wearing a scorecard. A stated gap is credible; a silently
 * filled one destroys the whole document.
 *
 * Pure: no clock, no I/O, no randomness. Adapted from Yuzzyuk/marketing-os (`audit-rubric.md`, MIT)
 * — see `docs/35-marketing-doctrine.md`.
 */

/** The four verdicts. Two is the bug this module exists to fix. */
export type SignalVerdict = 'pass' | 'fail' | 'unknown' | 'na';

export type CoverageSignal = {
  key: string;
  label: string;
  /** Relative importance. Units are arbitrary; only ratios matter. */
  weight: number;
  verdict: SignalVerdict;
  /**
   * Graded 0..1 credit for a `pass`/`fail` signal. Omit for a boolean check: `pass` is 1, `fail` is
   * 0. A binary index moves in whole-weight jumps and cannot see a small regression, which is why
   * anything that CAN be graded should be.
   */
  value?: number;
  note?: string;
};

export type CoverageTier = 'full' | 'provisional' | 'ungraded';

export type ScoreBand = {
  id: 'best_in_class' | 'strong' | 'functional' | 'leaking' | 'broken' | 'absent';
  min: number;
  label: string;
  meaning: string;
};

/**
 * Universal bands. Pick the band whose description is MOSTLY true, then adjust within it — landing
 * on a band first is what keeps two different scorers comparable.
 *
 * Calibration: the median real subject lands 55-70. A 100 should be rare enough that awarding one is
 * a statement. See `calibrationDrift`.
 */
export const SCORE_BANDS: ScoreBand[] = [
  { id: 'best_in_class', min: 90, label: 'Riferimento di categoria', meaning: 'Lo citeresti come esempio ad altri.' },
  { id: 'strong', min: 75, label: 'Solido', meaning: 'Esecuzione competente, lacune minori, niente di imbarazzante.' },
  { id: 'functional', min: 60, label: 'Funzionale ma generico', meaning: 'Niente di sbagliato, niente di memorabile.' },
  { id: 'leaking', min: 40, label: 'Perde valore', meaning: 'Problemi identificabili che un operatore competente sistemerebbe questa settimana.' },
  { id: 'broken', min: 20, label: 'Rotto', meaning: 'La dimensione sta lavorando contro il business.' },
  { id: 'absent', min: 0, label: 'Assente o dannoso', meaning: 'Non c’è, oppure fa danno.' }
];

export function bandOf(score: number): ScoreBand {
  return SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

/** Coverage thresholds. Exported so a report can explain the gate it just hit. */
export const COVERAGE_FULL = 80;
export const COVERAGE_PROVISIONAL = 60;

export type GradedScore = {
  /** 0-100 over the INSPECTED weight, or `null` when coverage is too thin to grade at all. */
  score: number | null;
  tier: CoverageTier;
  /** Share of applicable weight actually inspected, 0-100. The second number, always shown. */
  coverage: number;
  inspectedWeight: number;
  /** Total weight minus everything ruled not-applicable. */
  applicableWeight: number;
  /** Labels of the signals that could not be inspected. Named, never summarised away. */
  unknown: string[];
  notApplicable: string[];
  band: ScoreBand | null;
  /** One line, ready to print: the score, its denominator, and what is missing. */
  label: string;
};

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * Grade a set of signals under the coverage gate.
 *
 * The score is the pass-weight over the INSPECTED weight — never over the total. Reporting 60/100
 * when a third of the checks never ran is the silent fill this whole module exists to prevent.
 */
export function gradeWithCoverage(signals: CoverageSignal[]): GradedScore {
  const applicable = signals.filter((s) => s.verdict !== 'na');
  const inspected = applicable.filter((s) => s.verdict === 'pass' || s.verdict === 'fail');

  const applicableWeight = applicable.reduce((s, x) => s + x.weight, 0);
  const inspectedWeight = inspected.reduce((s, x) => s + x.weight, 0);
  const earned = inspected.reduce((s, x) => {
    const value = typeof x.value === 'number' ? Math.min(1, Math.max(0, x.value)) : x.verdict === 'pass' ? 1 : 0;
    return s + value * x.weight;
  }, 0);

  const unknown = applicable.filter((s) => s.verdict === 'unknown').map((s) => s.label);
  const notApplicable = signals.filter((s) => s.verdict === 'na').map((s) => s.label);

  // Nothing applicable at all: not a zero, an ungraded. A subject none of the questions fit has not
  // failed them.
  if (applicableWeight <= 0 || inspectedWeight <= 0) {
    return {
      score: null,
      tier: 'ungraded',
      coverage: 0,
      inspectedWeight: 0,
      applicableWeight,
      unknown,
      notApplicable,
      band: null,
      label: 'Evidenza insufficiente per un voto: nessuna dimensione ispezionabile.'
    };
  }

  const coverage = round((inspectedWeight / applicableWeight) * 100);
  const raw = round((earned / inspectedWeight) * 100);

  if (coverage < COVERAGE_PROVISIONAL) {
    return {
      score: null,
      tier: 'ungraded',
      coverage,
      inspectedWeight,
      applicableWeight,
      unknown,
      notApplicable,
      band: null,
      label: `Evidenza insufficiente per un voto (${coverage}% delle dimensioni ispezionate). Non ispezionate: ${unknown.join(', ') || 'n/d'}.`
    };
  }

  const tier: CoverageTier = coverage >= COVERAGE_FULL ? 'full' : 'provisional';
  const suffix = unknown.length ? ` Non ispezionate: ${unknown.join(', ')}.` : '';
  return {
    score: raw,
    tier,
    coverage,
    inspectedWeight,
    applicableWeight,
    unknown,
    notApplicable,
    band: bandOf(raw),
    label:
      tier === 'full'
        ? `${raw}/100 su ${coverage}% delle dimensioni.${suffix}`
        : `${raw}/100 — PROVVISORIO, su ${coverage}% delle dimensioni.${suffix}`
  };
}

/**
 * Calibration drift: if most subjects score above 80, the bands have drifted and the number has
 * stopped meaning anything. The median real subject lands 55-70 — that is the whole point of having
 * bands rather than vibes.
 *
 * Returns `null` when the sample is too small to say (under 8), so this never fires on noise.
 */
export function calibrationDrift(scores: number[]): { median: number; drifted: boolean; note: string } | null {
  const values = scores.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (values.length < 8) return null;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  const drifted = median > 80;
  return {
    median: round(median),
    drifted,
    note: drifted
      ? `Mediana ${round(median)}: le bande sono derivate verso l'alto. Il soggetto mediano reale sta fra 55 e 70 — a questi livelli il punteggio ha smesso di discriminare.`
      : `Mediana ${round(median)}: calibrazione nella banda attesa.`
  };
}

/**
 * The gaps section every report ends with. An explicit "what I couldn't determine" is credible; the
 * same report without it reads as complete when it is not.
 *
 * Returns `null` only when there is genuinely nothing to declare — and a caller that gets `null`
 * should still print the heading with "niente", never omit it.
 */
export function gapsSection(graded: GradedScore, extra: string[] = []): string {
  const items = [
    ...graded.unknown.map((u) => `${u}: non ispezionabile in questo run`),
    ...graded.notApplicable.map((n) => `${n}: non applicabile a questo soggetto`),
    ...extra.filter((e) => e && e.trim())
  ];
  if (!items.length) return 'Cosa non sono riuscito a determinare: niente — tutte le dimensioni sono state ispezionate.';
  return `Cosa non sono riuscito a determinare:\n${items.map((i) => `- ${i}`).join('\n')}`;
}
