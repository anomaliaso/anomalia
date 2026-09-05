/**
 * THE HOOK TACTIC TAXONOMY — eighteen named ways to open, and the coverage map they unlock.
 *
 * WHY EIGHTEEN AND NOT SEVEN. The video reviewer (gone on 29/8/2026) labelled hooks with seven
 * loose strings and `visual-meta.ts` labels them with five shape buckets (question / stat / howto /
 * myth / claim). Both are
 * usable as labels and useless as a map: with seven buckets a brand looks "covered" after a month,
 * so the planner keeps rewriting the same three openings and calls it variety.
 *
 * The value is not the label. It is that eighteen labelled cells make it possible to ask WHAT WE
 * HAVE NEVER TRIED — and empty cells next to a working concept are the highest-expected-value tests
 * available, because the argument is already validated and only the delivery is new.
 *
 * THE DISAMBIGUATION IS THE HARD PART. Half these tactics get confused with a neighbour, which is
 * how a taxonomy quietly collapses back into three buckets. Each entry therefore carries what it is
 * NOT and how it fails, and both travel into the prompt that asks a model to apply them.
 *
 * DETECTION IS HONEST ABOUT ITS LIMITS. `classifyHookTactic` reads the opening line and is
 * deliberately unable to assign three of the eighteen: pattern interrupt is a property of the
 * FRAME, story cold-open and implied answer need to know where the piece goes. Those can only come
 * from a model or a human, and the classifier returns `null` rather than guessing — an unclassified
 * hook counts against coverage, never as a tactic we have tried.
 *
 * Pure: no clock, no I/O, no randomness. Adapted from Yuzzyuk/marketing-os (`hooks.md`, MIT) — see
 * `docs/35-marketing-doctrine.md`.
 */

export const HOOK_TACTIC_IDS = [
  'callout',
  'question',
  'contrarian',
  'contrast',
  'demonstration',
  'pattern_interrupt',
  'stat_lead',
  'fear_loss',
  'outcome',
  'social_witness',
  'authority',
  'social_proof',
  'story_cold_open',
  'implied_answer',
  'borrowed_enemy',
  'trojan_horse',
  'curiosity_gap',
  'identity'
] as const;

export type HookTacticId = (typeof HOOK_TACTIC_IDS)[number];

export type HookTactic = {
  id: HookTacticId;
  label: string;
  /** What the tactic is, in one line. */
  what: string;
  /** The neighbour it is most often confused with, and the distinction that separates them. */
  notToConfuseWith: string;
  /** The failure mode. A tactic used where it fails is worse than not using it. */
  failsWhen: string;
  /**
   * Whether the opening TEXT alone can identify it. Three cannot: they are properties of the frame
   * or of where the piece goes. Marked so the coverage map never counts a guess as evidence.
   */
  textuallyDetectable: boolean;
};

export const HOOK_TACTICS: HookTactic[] = [
  {
    id: 'callout',
    label: 'Callout',
    what: "Nomina il pubblico nella prima riga ('Se gestisci ads Meta per un e-commerce…').",
    notToConfuseWith: "Identity, che rispecchia l'immagine di sé; il callout nomina un RUOLO o una situazione.",
    failsWhen: 'Il callout è più largo del targeting: chiama gente che non stiamo comprando.',
    textuallyDetectable: true
  },
  {
    id: 'question',
    label: 'Domanda',
    what: 'Apre un loop che lo spettatore deve chiudere.',
    notToConfuseWith: 'Curiosity gap, che TRATTIENE il meccanismo; la domanda invece invita.',
    failsWhen: 'Si può rispondere "no" e scrollare.',
    textuallyDetectable: true
  },
  {
    id: 'contrarian',
    label: 'Contrarian',
    what: 'Attacca una convinzione che il pubblico ha davvero.',
    notToConfuseWith: 'Contrast, che MOSTRA due stati; il contrarian ARGOMENTA contro uno.',
    failsWhen: 'La convinzione attaccata è un fantoccio che nessuno sostiene.',
    textuallyDetectable: true
  },
  {
    id: 'contrast',
    label: 'Contrasto',
    what: 'Prima/dopo, o noi-contro-loro, affiancati.',
    notToConfuseWith: 'Contrarian.',
    failsWhen: 'Il "prima" non è riconoscibile come il presente di chi guarda.',
    textuallyDetectable: true
  },
  {
    id: 'demonstration',
    label: 'Dimostrazione',
    what: 'Il prodotto che fa la cosa impossibile, a freddo, senza preamboli.',
    notToConfuseWith: 'Outcome, che mostra il RISULTATO; la dimostrazione mostra il PROCESSO.',
    failsWhen: 'La demo ha bisogno di contesto per sembrare impressionante.',
    textuallyDetectable: true
  },
  {
    id: 'pattern_interrupt',
    label: 'Pattern interrupt',
    what: 'Qualcosa di visivamente sbagliato per il feed: rompe la grammatica dello scroll.',
    notToConfuseWith: 'Dimostrazione.',
    failsWhen: "L'interruzione non c'entra nulla col messaggio: è clickbait, e decade in fretta.",
    textuallyDetectable: false
  },
  {
    id: 'stat_lead',
    label: 'Numero in apertura',
    what: 'Un solo numero che riformula il problema.',
    notToConfuseWith: 'Social proof: qui il numero parla del MONDO, non del brand.',
    failsWhen: 'Il numero è tondo, senza fonte, o incredibile.',
    textuallyDetectable: true
  },
  {
    id: 'fear_loss',
    label: 'Costo dello status quo',
    what: 'Quanto sta costando adesso continuare così.',
    notToConfuseWith: "L'agitazione del problema nel corpo del testo: qui sta nei primi secondi.",
    failsWhen: 'Il pubblico non è ancora consapevole del problema: suona come terrorismo.',
    textuallyDetectable: true
  },
  {
    id: 'outcome',
    label: 'Risultato',
    what: "Lo stato finale, specifico e sensoriale.",
    notToConfuseWith: 'Dimostrazione.',
    failsWhen: 'Il risultato è generico ("risparmia tempo e denaro").',
    textuallyDetectable: true
  },
  {
    id: 'social_witness',
    label: 'Testimone in presa diretta',
    what: 'Una persona vera dentro il momento, grammatica UGC: sorpreso, non recitato.',
    notToConfuseWith: 'Testimonianza: il testimone in presa diretta è NEL momento.',
    failsWhen: 'La qualità di produzione rompe la lettura "persona vera".',
    textuallyDetectable: true
  },
  {
    id: 'authority',
    label: 'Autorità',
    what: "Parlano prima le credenziali ('Ho analizzato 400 account pubblicitari').",
    notToConfuseWith: 'Social proof: autorità è PROFONDITÀ, prova sociale è VOLUME.',
    failsWhen: 'La credenziale non c’entra con ciò che si afferma.',
    textuallyDetectable: true
  },
  {
    id: 'social_proof',
    label: 'Prova sociale',
    what: "Volume e consenso ('12.000 team hanno cambiato').",
    notToConfuseWith: 'Autorità.',
    failsWhen: 'Il numero non è dimostrabile — e non si inventa mai.',
    textuallyDetectable: true
  },
  {
    id: 'story_cold_open',
    label: 'Apertura a freddo',
    what: 'In medias res, dentro il conflitto, senza preamboli.',
    notToConfuseWith: 'Testimone in presa diretta.',
    failsWhen: "Il pagamento della promessa non arriva dentro la rampa d'ingresso.",
    textuallyDetectable: false
  },
  {
    id: 'implied_answer',
    label: 'Risposta implicita',
    what: 'La premessa è posta così che sia lo spettatore a completare il pensiero.',
    notToConfuseWith: 'Domanda: la risposta implicita non chiede mai.',
    failsWhen: "L'inferenza richiesta è un salto troppo grande.",
    textuallyDetectable: false
  },
  {
    id: 'borrowed_enemy',
    label: 'Nemico condiviso',
    what: 'Allearsi con chi guarda contro un nemico comune: il vecchio modo, l’incumbent, la piattaforma.',
    notToConfuseWith: 'Contrarian.',
    failsWhen: 'Il nemico è una scelta passata di chi guarda: lo si sta insultando.',
    textuallyDetectable: true
  },
  {
    id: 'trojan_horse',
    label: 'Cavallo di Troia',
    what: 'Prende in prestito un formato nativo — screenshot di note, thread di messaggi, risposta a un commento — così da leggersi come contenuto.',
    notToConfuseWith: 'Pattern interrupt.',
    failsWhen: 'La rivelazione sembra un tradimento invece che una strizzata d’occhio.',
    textuallyDetectable: true
  },
  {
    id: 'curiosity_gap',
    label: 'Gap di curiosità',
    what: 'Trattiene il meccanismo, promette la rivelazione.',
    notToConfuseWith: 'Domanda.',
    failsWhen: "La rivelazione non regge la promessa: brucia la fiducia dell'intero account, non solo del post.",
    textuallyDetectable: true
  },
  {
    id: 'identity',
    label: 'Identità',
    what: "Rispecchia l'immagine di sé ('per i fondatori che si scrivono ancora le copy da soli').",
    notToConfuseWith: 'Callout: ruolo contro immagine di sé.',
    failsWhen: "L'identità lusinga invece di riconoscere.",
    textuallyDetectable: true
  }
];

export function hookTacticById(id: string): HookTactic | null {
  return HOOK_TACTICS.find((t) => t.id === id) ?? null;
}

/** The tactics no amount of text analysis can assign — they need a model or a human. */
export const NON_TEXTUAL_TACTICS: HookTacticId[] = HOOK_TACTICS.filter((t) => !t.textuallyDetectable).map((t) => t.id);

// ── Deterministic classification ──────────────────────────────────────────────────────────────
//
// Best-effort, from the opening line only. Ordered by SPECIFICITY: the narrow patterns are tested
// before the broad ones, because "starts with a number" would otherwise swallow half the taxonomy.
// Anything that does not match a rule returns null — an unclassified hook is missing evidence, and
// the coverage map treats it as such rather than dropping it into a catch-all bucket.

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The opening line — what a scroller actually reads before deciding. */
export function openingLine(text: string): string {
  const firstLine = String(text ?? '')
    .split(/\r?\n/)
    .find((l) => l.trim().length > 0);
  const line = (firstLine ?? '').trim();
  if (line.length <= 200) return line;
  const cut = line.search(/[.!?…]\s/);
  return cut > 0 && cut < 200 ? line.slice(0, cut + 1) : line.slice(0, 200);
}

type Rule = { id: HookTacticId; test: (raw: string, norm: string) => boolean };

const RULES: Rule[] = [
  // Narrow, unmistakable shapes first.
  {
    id: 'trojan_horse',
    test: (_raw, n) => /^(nota|appunti|note to self|screenshot|rispondo a|replying to|dm:|messaggio ricevuto|inbox:)/.test(n)
  },
  {
    id: 'social_witness',
    test: (_raw, n) =>
      /^(ho appena|non ci credo|non riesco a credere|sto guardando|guardate cosa|i just|i can t believe|i m watching)/.test(n)
  },
  {
    id: 'authority',
    test: (_raw, n) =>
      // `\d+` and not `\d`: with a single digit the trailing word boundary falls INSIDE "400" and
      // the whole alternative silently never matches.
      /\b(ho (analizzato|gestito|rifatto|visto)\s+\d+|in \d+ anni (di|che)|dopo \d+ (anni|campagne|progetti)|i ve (audited|run|built|managed)\s+\d+|after \d+ years)\b/.test(n)
  },
  {
    id: 'social_proof',
    test: (_raw, n) =>
      /\b\d[\d.,]*\s?(mila|k|milioni|m)?\s*(clienti|aziende|team|persone|utenti|studi|brand|customers|companies|teams|people|users)\b/.test(n)
  },
  {
    id: 'identity',
    test: (_raw, n) => /\b(per (chi|quelli che|quelle che|i \w+ che|le \w+ che|gli \w+ che)|for (those|people|founders|marketers) who)\b/.test(n)
  },
  {
    id: 'callout',
    test: (_raw, n) =>
      /^(se (sei|hai|fai|lavori|gestisci|vendi|apri)|if you (run|are|have|manage|sell))\b/.test(n) ||
      /^(a tutti (i|gli|le)|attenzione (a|ai|alle))\b/.test(n)
  },
  {
    id: 'borrowed_enemy',
    test: (_raw, n) => /\b(il vecchio modo|the old way|le agenzie (ti|vi|non)|agencies (won t|don t)|quello che (ti|vi) vendono)\b/.test(n)
  },
  {
    id: 'contrarian',
    test: (_raw, n) =>
      /\b(tutti (dicono|pensano|credono|fanno)|everyone (says|thinks|does)|ti hanno (detto|insegnato)|you ve been told|smetti di|stop (doing|using)|e sbagliato|is wrong)\b/.test(n)
  },
  {
    id: 'fear_loss',
    test: (_raw, n) =>
      /\b(stai perdendo|state perdendo|ti sta costando|vi sta costando|ogni (giorno|settimana|mese) che|you re losing|it s costing you|every (day|week) you)\b/.test(n)
  },
  {
    id: 'curiosity_gap',
    test: (_raw, n) =>
      /\b(nessuno (ti|vi) dice|nobody tells you|il (vero )?motivo per cui|the real reason|il segreto|the secret|quello che non (ti|vi) dicono)\b/.test(n)
  },
  {
    id: 'contrast',
    test: (_raw, n) => /\b(prima .*\b(adesso|ora|dopo)\b|before .*\bafter\b|invece di|instead of|contro|vs\b)/.test(n)
  },
  {
    id: 'outcome',
    test: (_raw, n) =>
      /\b(da \d[\d.,]*\s*\S* a \d|from \d[\d.,]*\s*\S* to \d|in (soli |appena )?\d+ (secondi|minuti|ore|giorni|settimane|seconds|minutes|hours|days|weeks))\b/.test(n)
  },
  {
    id: 'demonstration',
    test: (_raw, n) => /^(guarda|guardate|ecco come|ecco cosa succede|watch|here s (what|how)|look what)\b/.test(n)
  },
  // Broad shapes last: a question mark and a leading number match almost anything.
  { id: 'question', test: (raw) => /\?/.test(raw) },
  { id: 'stat_lead', test: (_raw, n) => /^(il |lo |la |l )?\d[\d.,]*\s*(%|per cento|percent|su \d)/.test(n) || /^\d[\d.,]*\s/.test(n) }
];

export type HookClassification = {
  tactic: HookTacticId;
  /** `low` when the match came from one of the broad trailing rules. */
  confidence: 'high' | 'low';
};

/**
 * Classify the opening of a caption or script. Returns `null` when no rule fires — which is a real
 * answer, not a failure: three tactics are not textually detectable at all, and a catch-all bucket
 * would report coverage we do not have.
 */
export function classifyHookTactic(text: string | null | undefined): HookClassification | null {
  const line = openingLine(String(text ?? ''));
  if (!line) return null;
  const norm = normalize(line);
  if (!norm) return null;
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    if (rule.test(line, norm)) {
      // The last two rules are shape-only matches; everything before them is a phrase pattern.
      return { tactic: rule.id, confidence: i >= RULES.length - 2 ? 'low' : 'high' };
    }
  }
  return null;
}

// ── Coverage map ──────────────────────────────────────────────────────────────────────────────

export type HookUsage = {
  /**
   * `null` when the opening could not be labelled. Passed explicitly rather than dropped, because an
   * unlabelled hook is missing evidence and has to show up in the coverage denominator.
   */
  tactic: HookTacticId | null;
  /** The production format it ran in ('carousel', 'reel', 'text_post', …). Free-form on purpose. */
  format?: string | null;
  /** Whether this execution performed above the brand's own average. Unknown when absent. */
  wonAgainstAverage?: boolean | null;
};

export type CoverageGap = {
  tactic: HookTacticId;
  label: string;
  /** Why this gap is worth filling next, in one line the planner can act on. */
  why: string;
  /** Higher runs first. */
  priority: number;
  /** Set when the recommendation is a proven ARGUMENT in a format we have not tried. */
  format?: string | null;
};

export type HookCoverage = {
  /** Tactics with at least one classified execution. */
  used: HookTacticId[];
  /**
   * Tactics that have beaten the brand's own average at least once. Empty when the caller withheld
   * the winner flag because the sample could not support it — which is a different thing from
   * "nothing has won", and both correctly produce no proven angles.
   */
  proven: HookTacticId[];
  /** Tactics never seen. Ordered by the gap ranking below. */
  untested: HookTacticId[];
  /** Executions the classifier could not label — counted against coverage, never as a tactic. */
  unclassified: number;
  /** Share of the eighteen cells with at least one execution, 0-100. */
  coverage: number;
  /** Ranked next tests. The top of this list is the planner's highest-expected-value work. */
  gaps: CoverageGap[];
  /** One line ready to paste into a prompt. */
  brief: string;
};

/**
 * Which openings this brand has and has not tried, and what to try next.
 *
 * THE RANKING RULE. A proven angle in an untested FORMAT outranks a brand-new angle in a proven
 * format: it carries a validated argument into fresh territory, so the bet is cheaper and the
 * result is interpretable either way. New tactics come after that, and the three non-textual
 * tactics come last — not because they are weak, but because we cannot verify from text whether we
 * have already used them, and recommending work we may have just done is how a planner loses trust.
 */
export function hookCoverage(
  usages: HookUsage[],
  opts: { knownFormats?: string[] } = {}
): HookCoverage {
  const used = new Set<HookTacticId>();
  const formatsByTactic = new Map<HookTacticId, Set<string>>();
  const winners = new Set<HookTacticId>();
  let unclassified = 0;

  for (const u of usages) {
    if (!u || u.tactic === null || !HOOK_TACTIC_IDS.includes(u.tactic)) {
      unclassified++;
      continue;
    }
    used.add(u.tactic);
    const fmt = String(u.format ?? '').trim();
    if (fmt) {
      const set = formatsByTactic.get(u.tactic) ?? new Set<string>();
      set.add(fmt);
      formatsByTactic.set(u.tactic, set);
    }
    if (u.wonAgainstAverage === true) winners.add(u.tactic);
  }

  const knownFormats = (opts.knownFormats ?? []).map((f) => f.trim()).filter(Boolean);
  const gaps: CoverageGap[] = [];

  // 1. Proven argument, untested format — the cheapest interpretable bet we have.
  for (const tactic of winners) {
    const tried = formatsByTactic.get(tactic) ?? new Set<string>();
    for (const format of knownFormats) {
      if (tried.has(format)) continue;
      gaps.push({
        tactic,
        label: hookTacticById(tactic)!.label,
        format,
        why: `Angolo già validato su questo brand, formato mai provato (${format}). Porta un argomento che funziona in territorio nuovo: costa poco e il risultato è leggibile in entrambe le direzioni.`,
        priority: 100
      });
    }
  }

  // 2. Tactics never tried, detectable ones first.
  const untested = HOOK_TACTIC_IDS.filter((id) => !used.has(id));
  for (const id of untested) {
    const t = hookTacticById(id)!;
    gaps.push({
      tactic: id,
      label: t.label,
      why: t.textuallyDetectable
        ? `Mai usata. ${t.what} Attenzione: ${t.failsWhen.toLowerCase()}`
        : `Mai rilevata — ma non è rilevabile dal testo, quindi potremmo averla già usata. ${t.what}`,
      priority: t.textuallyDetectable ? 50 : 10
    });
  }

  gaps.sort((a, b) => b.priority - a.priority);

  const coverage = Math.round((used.size / HOOK_TACTIC_IDS.length) * 1000) / 10;
  const topGaps = gaps.slice(0, 5);
  const brief = [
    `COPERTURA DEGLI HOOK: ${used.size}/${HOOK_TACTIC_IDS.length} tattiche usate (${coverage}%)${unclassified ? `, ${unclassified} aperture non classificabili dal testo` : ''}.`,
    used.size ? `Già usate: ${[...used].map((id) => hookTacticById(id)!.label).join(', ')}.` : 'Nessuna tattica ancora classificata.',
    topGaps.length
      ? `Prossimi test a maggior valore atteso:\n${topGaps
          .map((g) => `- ${g.label}${g.format ? ` in formato ${g.format}` : ''}: ${g.why}`)
          .join('\n')}`
      : 'Nessun buco: ruotare fra le tattiche già validate.',
    'USA questa mappa scegliendo le aperture del prossimo batch: almeno una tattica mai provata per batch. Dovendo scegliere fra un angolo nuovo e un angolo già validato in un formato mai provato, scegli il secondo — porta un argomento che funziona in territorio nuovo, quindi il risultato è leggibile in entrambe le direzioni. Non è un divieto di riusare ciò che funziona: è il modo di non collassare su tre aperture.'
  ].join('\n');

  return { used: [...used], proven: [...winners], untested, unclassified, coverage, gaps, brief };
}

/**
 * The taxonomy as a prompt block, for the models that LABEL hooks (the video judge) and the ones
 * that WRITE them (seed generation). The disambiguation travels with it: without "don't confuse
 * with", a model collapses eighteen tactics back into question / claim / stat within a week.
 */
export function hookTaxonomyBrief(opts: { includeFailures?: boolean } = {}): string {
  const lines = HOOK_TACTICS.map((t) => {
    const parts = [`- ${t.id} (${t.label}): ${t.what} NON confondere con: ${t.notToConfuseWith}`];
    if (opts.includeFailures !== false) parts.push(`Fallisce quando: ${t.failsWhen}`);
    return parts.join(' ');
  });
  return `HOOK TACTICS — le diciotto aperture. Usa SEMPRE uno di questi id.\n${lines.join('\n')}`;
}
