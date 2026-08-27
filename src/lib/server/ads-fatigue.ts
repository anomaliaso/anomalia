/**
 * CREATIVE FATIGUE DIAGNOSIS — why a paid concept is decaying, read from the metric pattern.
 *
 * THE PROBLEM THIS SOLVES. We already sync spend, impressions, clicks, reach, ctr, cpm, conversions
 * and roas per campaign, and `ads.ts` already scales budgets off engagement signals. What nothing
 * did was say WHY performance moved — so every decay looked like the same event and invited the
 * same answer, "make new creative". Prescribing new creative for an audience-size problem burns a
 * production cycle and changes nothing, and prescribing it for a broken pixel is the single most
 * wasteful thing a team can do.
 *
 * READ THE PATTERN, NEVER A SINGLE METRIC. Frequency alone diagnoses nothing. A frequency of 4 with
 * stable CTR is fine; 1.8 with falling CTR is a bad concept, not fatigue. What separates the cases
 * is how CTR, CPM, CVR and frequency moved TOGETHER.
 *
 * CONCEPT LEVEL, NOT ASSET LEVEL. The unit that fatigues is the argument an ad makes, not the file.
 * Six videos that all say "save time" are one concept with six executions, and refreshing the
 * execution of a decayed concept buys very little — what exhausted was the argument. So this module
 * takes a GROUP of series and sums them: pass one concept's ads together. Passing a single ad is
 * legal and still useful, it just answers a narrower question.
 *
 * CHECK TRACKING FIRST, ALWAYS. A pixel break looks exactly like a catastrophic creative failure and
 * is far more common than a genuine overnight collapse — which is why it is the first branch below,
 * not the last.
 *
 * Pure: no clock, no I/O, no randomness. Adapted from Yuzzyuk/marketing-os (`ads-diagnostics.md`,
 * MIT) — see `docs/35-marketing-doctrine.md`.
 */
import { assessEvidence, type EvidenceRead } from '$lib/server/evidence-quality';

/** One synced measurement window for one ad. Shapes `ad_metrics` rows without importing the DB. */
export type AdMetricPoint = {
  /** ISO date of the window's end — used only for ordering and for the learning-reset test. */
  periodEnd: string;
  spend: number;
  impressions: number;
  clicks: number;
  /** Unique people reached. Frequency is impressions/reach; without it frequency is unknown. */
  reach?: number | null;
  conversions?: number | null;
};

export type FatigueDiagnosisId =
  | 'tracking_failure'
  | 'creative_fatigue'
  | 'audience_exhaustion'
  | 'auction_pressure'
  | 'post_click'
  | 'message_match'
  | 'bad_concept'
  | 'learning_reset'
  | 'insufficient_data'
  | 'healthy';

export type MetricTrend = 'up' | 'down' | 'sharp_down' | 'flat' | 'unknown';

export type FatigueWindow = {
  points: number;
  spend: number;
  impressions: number;
  clicks: number;
  /** clicks / impressions, or null when there were no impressions. */
  ctr: number | null;
  /** spend / impressions × 1000, or null. */
  cpm: number | null;
  /** conversions / clicks, or null when conversions were never synced. */
  cvr: number | null;
  /** impressions / reach, or null when reach is absent. Meaningful ONLY as a trend against CTR. */
  frequency: number | null;
};

export type FatigueDiagnosis = {
  id: FatigueDiagnosisId;
  /** One line, in the product's language, naming the failure mode. */
  label: string;
  /** What to do — and, as often, what NOT to do. */
  action: string;
  /** What would change this read. Every diagnosis states it; none is certain. */
  wouldChangeMyMind: string;
  trends: { ctr: MetricTrend; cpm: MetricTrend; cvr: MetricTrend; frequency: MetricTrend };
  recent: FatigueWindow;
  baseline: FatigueWindow;
  evidence: EvidenceRead;
};

/**
 * Volume floors. Under these the pattern is noise and the only honest diagnosis is that there is
 * nothing to diagnose yet.
 */
export const MIN_IMPRESSIONS_PER_WINDOW = 1000;
export const MIN_CLICKS_PER_WINDOW = 20;

/** A move smaller than this is flat. Ad platforms wobble; 10% is not a trend. */
const MOVE_THRESHOLD = 0.15;
/** A collapse this large in BOTH click-through and conversion is a measurement event, not taste. */
const COLLAPSE_THRESHOLD = 0.5;

function emptyWindow(): FatigueWindow {
  return { points: 0, spend: 0, impressions: 0, clicks: 0, ctr: null, cpm: null, cvr: null, frequency: null };
}

/** Sum a set of points into one window. Rates are computed on the TOTALS, never averaged. */
export function summarizeWindow(points: AdMetricPoint[]): FatigueWindow {
  if (!points.length) return emptyWindow();
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let reach = 0;
  let conversions = 0;
  let hasReach = false;
  let hasConversions = false;
  for (const p of points) {
    spend += Number(p.spend) || 0;
    impressions += Number(p.impressions) || 0;
    clicks += Number(p.clicks) || 0;
    if (p.reach != null && Number.isFinite(Number(p.reach))) {
      reach += Number(p.reach) || 0;
      hasReach = true;
    }
    if (p.conversions != null && Number.isFinite(Number(p.conversions))) {
      conversions += Number(p.conversions) || 0;
      hasConversions = true;
    }
  }
  return {
    points: points.length,
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    // Averaging a rate over conversions we never received would invent a zero. No data → null.
    cvr: hasConversions && clicks > 0 ? conversions / clicks : null,
    frequency: hasReach && reach > 0 ? impressions / reach : null
  };
}

/**
 * Direction of travel between two windows. `unknown` when either side is missing — which is a
 * different thing from `flat`, and the decision table below has to be able to tell them apart.
 */
export function trendOf(baseline: number | null, recent: number | null, invert = false): MetricTrend {
  if (baseline == null || recent == null || baseline === 0) return 'unknown';
  const change = (recent - baseline) / Math.abs(baseline);
  const signed = invert ? -change : change;
  if (signed <= -COLLAPSE_THRESHOLD) return 'sharp_down';
  if (signed <= -MOVE_THRESHOLD) return 'down';
  if (signed >= MOVE_THRESHOLD) return 'up';
  return 'flat';
}

const isDown = (t: MetricTrend): boolean => t === 'down' || t === 'sharp_down';
const isFlatOrUnknown = (t: MetricTrend): boolean => t === 'flat' || t === 'unknown';

export type DiagnoseOpts = {
  /**
   * When the concept's creative, budget or targeting was last meaningfully edited. A significant
   * edit throws the ad set back into learning: volatile costs, unstable delivery. Judging
   * performance during a reset judges nothing, so this is checked before any creative conclusion.
   */
  lastEditedAt?: string | null;
  /** How many of the most recent points form the "now" window. The rest are the baseline. */
  recentPoints?: number;
};

/**
 * Diagnose one concept from its metric history.
 *
 * `points` must be ordered oldest → newest. Pass every ad in the concept; they are summed.
 */
export function diagnoseFatigue(points: AdMetricPoint[], opts: DiagnoseOpts = {}): FatigueDiagnosis {
  const ordered = [...points].sort((a, b) => String(a.periodEnd).localeCompare(String(b.periodEnd)));
  const half = Math.max(1, opts.recentPoints ?? Math.floor(ordered.length / 2));
  const recentPoints = ordered.slice(-half);
  const baselinePoints = ordered.slice(0, Math.max(0, ordered.length - half));

  const recent = summarizeWindow(recentPoints);
  const baseline = summarizeWindow(baselinePoints);

  const trends = {
    ctr: trendOf(baseline.ctr, recent.ctr),
    // A rising CPM is a WORSE outcome, so it is inverted: "down" always means "got worse".
    cpm: trendOf(baseline.cpm, recent.cpm, true),
    cvr: trendOf(baseline.cvr, recent.cvr),
    frequency: trendOf(baseline.frequency, recent.frequency, true)
  };

  // `cpm` and `frequency` are inverted above, so read them back in plain language here.
  const cpmRising = trends.cpm === 'down' || trends.cpm === 'sharp_down';
  const cpmStable = isFlatOrUnknown(trends.cpm);
  const frequencyRising = trends.frequency === 'down' || trends.frequency === 'sharp_down';

  // Conversions are the unit any CVR-based call rests on; clicks carry the CTR-based ones.
  const conversionSample = recent.cvr != null ? Math.round(recent.cvr * recent.clicks) : 0;
  const evidence = assessEvidence({
    design: 'trend',
    sample: recent.cvr != null ? conversionSample : recent.clicks,
    unit: recent.cvr != null ? 'conversioni nella finestra recente' : 'click nella finestra recente',
    window: baselinePoints.length
      ? `${baselinePoints.length} finestre di riferimento vs ${recentPoints.length} recenti`
      : `${recentPoints.length} finestre, nessun riferimento precedente`,
    survivorsOnly: true,
    reversible: true
  });

  const out = (
    id: FatigueDiagnosisId,
    label: string,
    action: string,
    wouldChangeMyMind: string
  ): FatigueDiagnosis => ({ id, label, action, wouldChangeMyMind, trends, recent, baseline, evidence });

  // ── Gate 1: is there anything to read at all? ───────────────────────────────────────────────
  if (
    !baselinePoints.length ||
    recent.impressions < MIN_IMPRESSIONS_PER_WINDOW ||
    recent.clicks < MIN_CLICKS_PER_WINDOW
  ) {
    return out(
      'insufficient_data',
      'Dati insufficienti per una diagnosi',
      `Aspettare. Servono almeno ${MIN_IMPRESSIONS_PER_WINDOW} impression e ${MIN_CLICKS_PER_WINDOW} click nella finestra recente, più una finestra precedente con cui confrontarla.`,
      'Accumulare volume, oppure allargare la finestra se le sincronizzazioni sono rade.'
    );
  }

  // ── Gate 2: did we edit the thing we are judging? ───────────────────────────────────────────
  const editedAt = opts.lastEditedAt?.trim();
  const windowStart = recentPoints[0]?.periodEnd;
  if (editedAt && windowStart && editedAt >= windowStart) {
    return out(
      'learning_reset',
      'Fase di apprendimento: la creatività o il budget sono cambiati dentro la finestra',
      'Non concludere niente da questi numeri. Una modifica significativa rimanda l’ad set in learning: costi volatili e delivery instabile. Giudicare durante un reset non giudica nulla.',
      'Rileggere quando la finestra recente è interamente successiva alla modifica.'
    );
  }

  // ── Gate 3: TRACKING BEFORE CREATIVE. ──────────────────────────────────────────────────────
  // A pixel break looks exactly like a catastrophic creative failure, and rewriting ads to fix a
  // broken pixel is the most wasteful thing possible here. So it is tested first, not last.
  if (trends.ctr === 'sharp_down' && trends.cvr === 'sharp_down' && cpmStable) {
    return out(
      'tracking_failure',
      'Sospetto guasto di tracciamento, non un problema creativo',
      'Verificare il pixel / la Conversions API PRIMA di toccare qualunque creatività. Click e conversioni sono crollati insieme mentre il costo dell’asta non si è mosso: è la firma di una misurazione rotta, non di un pubblico che smette di rispondere.',
      'Se il pixel risulta sano e il crollo regge su una seconda finestra, allora è davvero la creatività.'
    );
  }

  // Conversions dropping with click behaviour unchanged is post-click, whatever the creative does.
  if (isFlatOrUnknown(trends.ctr) && isDown(trends.cvr)) {
    return out(
      'post_click',
      'Problema post-click: la landing, l’offerta o il checkout',
      'Smettere di riscrivere gli annunci. Il click c’è ancora; è dopo il click che si perde. Guardare pagina di destinazione, offerta e checkout.',
      'Se la conversione risale senza aver toccato la pagina, era rumore o stagionalità.'
    );
  }

  // Both falling with a stable cost and a stable frequency: the ad promises what the page does not.
  if (isDown(trends.ctr) && isDown(trends.cvr) && cpmStable && !frequencyRising) {
    return out(
      'message_match',
      'Rottura di message-match fra annuncio e pagina',
      'L’annuncio promette qualcosa che la pagina non mantiene. Allineare la promessa: stessa frase, stessa offerta, stesso soggetto nei primi pixel della landing.',
      'Se la pagina è cambiata di recente, è quella la causa; se non è cambiata, è cambiato l’annuncio.'
    );
  }

  // Rising cost with click-through intact is the auction, not the work.
  if (isFlatOrUnknown(trends.ctr) && cpmRising) {
    return out(
      'auction_pressure',
      'Pressione d’asta: stagionale o competitiva, non creativa',
      'Non è un problema di creatività — il CTR non si è mosso. Controllare il calendario (saldi, festività, un competitor che è entrato) e decidere se pagare il premio o ridurre la spesa in questa finestra.',
      'Se il CPM rientra da solo alla fine del periodo, era stagionalità.'
    );
  }

  // Everything decaying together with a rising cost and a rising frequency: the pool is too small.
  if (isDown(trends.ctr) && cpmRising && frequencyRising) {
    return out(
      'audience_exhaustion',
      'Pubblico esaurito, non creatività stanca',
      'Allargare il pool. Creatività nuova NON risolve un pubblico troppo piccolo: la stessa gente la vedrà con la stessa frequenza, e avremo speso una produzione per scoprirlo.',
      'Se allargando il pubblico il CPM rientra e il CTR risale, era il pool. Se non succede, era la creatività.'
    );
  }

  // The textbook case: attention decaying against rising exposure, at stable cost and conversion.
  if (isDown(trends.ctr) && cpmStable && frequencyRising) {
    return out(
      'creative_fatigue',
      'Stanchezza creativa vera, a livello di CONCETTO',
      'Servono CONCETTI nuovi, non nuove esecuzioni dello stesso. Ciò che si è esaurito è l’argomento: rigirare le stesse cose con footage diverso si stanca in fretta. Un angolo già validato in un formato non ancora testato batte un angolo nuovo in un formato collaudato.',
      'Se un nuovo concetto riparte forte, era stanchezza. Se parte piatto anche lui, il problema è l’offerta.'
    );
  }

  // Flat and poor since launch, with nobody having seen it twice, was never fatigue.
  if (isDown(trends.ctr) && !frequencyRising && cpmStable && baseline.ctr != null && recent.ctr != null && recent.ctr < baseline.ctr) {
    return out(
      'bad_concept',
      'Concetto che non ha mai funzionato',
      'Non è fatigue: la frequenza non è salita, quindi quasi nessuno l’ha visto due volte. Chiudere e passare a un altro argomento invece di rinfrescare l’esecuzione di questo.',
      'Se l’audience era minuscola, il concetto potrebbe non aver mai avuto una vera prova: rileggere con più volume.'
    );
  }

  return out(
    'healthy',
    'Nessun segnale di decadimento in questa finestra',
    'Lasciare correre. Se si vuole scalare, scalare qui — e produrre il prossimo concetto adesso, mentre questo funziona ancora.',
    'Un calo del CTR contro una frequenza in salita nella prossima finestra sarebbe l’inizio della stanchezza.'
  );
}

/**
 * The printable read. Deliberately states the frequency caveat inline: circulated thresholds
 * ("above 3 is fatigue") are not rules, and quoting one here would undo the whole module.
 */
export function fatigueBrief(d: FatigueDiagnosis): string {
  const pct = (a: number | null, b: number | null): string =>
    a == null || b == null || a === 0 ? 'n/d' : `${b >= a ? '+' : ''}${Math.round(((b - a) / Math.abs(a)) * 100)}%`;
  return [
    `DIAGNOSI: ${d.label}`,
    `Azione: ${d.action}`,
    `Movimenti (riferimento → recente): CTR ${pct(d.baseline.ctr, d.recent.ctr)} · CPM ${pct(d.baseline.cpm, d.recent.cpm)} · CVR ${pct(d.baseline.cvr, d.recent.cvr)} · frequenza ${pct(d.baseline.frequency, d.recent.frequency)}`,
    'La frequenza ha senso SOLO come trend contro il CTR: 4 con CTR stabile va bene, 1.8 con CTR in calo è un concetto sbagliato. Nessuna soglia assoluta.',
    `Cosa mi farebbe cambiare idea: ${d.wouldChangeMyMind}`
  ].join('\n');
}
