/**
 * La riga di chiusura del turno con obiettivo (`goalTurnNotice`, server) trasformata in dati.
 *
 * Il server la appende come testo semplice — `_Goal not reached yet — 4/6 done, still open: …_`
 * — perché quel testo vive anche nel transcript del modello e nella CLI. Qui, lato renderer, la
 * si riconosce e la si smonta in una card: così i thread vecchi (che hanno solo il testo) e i
 * nuovi passano dallo stesso identico parser, e gli underscore grezzi non arrivano mai a schermo.
 *
 * I template sono i quattro di `goalTurnNotice` (en/it). Un paragrafo che sembra un notice ma non
 * combacia con nessun template viene comunque ripulito (via `*…*`, che renderMd sa rendere in
 * corsivo) invece di mostrare `_…_` crudo.
 */

export type GoalStatus = {
  state: 'met' | 'resuming' | 'waiting' | 'stopped';
  done: number;
  total: number;
  /** met: lo statement dell'obiettivo; stopped: il perché (prosa del server, en/it). */
  detail: string | null;
  /** I criteri ancora aperti, con le loro parole. */
  open: string[];
  /**
   * I criteri chiusi in QUEL turno, quando l'avviso li nomina: `[]` sugli avvisi vecchi (che
   * portavano solo la frazione) e su quelli che ne hanno chiusi troppi per nominarli.
   */
  closed: string[];
};

const MET =
  /^(?:Goal reached|Obiettivo raggiunto) — (\d+)\/(\d+): ([\s\S]+)$/;
/**
 * «(just closed: x; y)» / «(appena chius[oi]: x; y)» — OPZIONALE, e non per eleganza: ogni avviso
 * già scritto nei thread è nel formato di prima, e un obiettivo di ieri non deve diventare
 * illeggibile perché il server oggi dice una parola in più. Senza il gruppo, `closed` resta `[]`.
 */
const JUST_CLOSED = `(?: \\((?:just closed|appena chius[oi]): ([\\s\\S]+?)\\))?`;
const CONTINUING = new RegExp(
  `^(?:Goal not reached yet|Obiettivo non ancora raggiunto) — (\\d+)\\/(\\d+) (?:done|fatti)${JUST_CLOSED}(?:, still open|, restano): ([\\s\\S]+?)\\. (I am picking it back up in the background|Riprendo in background|It stays open and I carry on with your next message|Resta aperto e riprendo al tuo prossimo messaggio)\\.$`
);
const STOPPED = new RegExp(
  `^(?:Goal stopped at|Obiettivo fermo a) (\\d+)\\/(\\d+)${JUST_CLOSED} — ([\\s\\S]+?)\\. (?:Still open|Restano): ([\\s\\S]+?)\\. (?:Tell me how you want to go on|Dimmi come vuoi procedere)\\.$`
);

/** L'ultimo paragrafo `_Goal …_` / `_Obiettivo …_` di un blocco di testo. */
const NOTICE_AT_END = /(?:^|\n)\s*_((?:Goal|Obiettivo)[\s\S]*)_\s*$/;

const splitList = (s: string) =>
  s
    .split(/;\s*/)
    .map((t) => t.trim())
    .filter(Boolean);

function parseNotice(inner: string): GoalStatus | null {
  let m = MET.exec(inner);
  if (m) {
    return { state: 'met', done: +m[1]!, total: +m[2]!, detail: m[3]!.trim(), open: [], closed: [] };
  }
  m = CONTINUING.exec(inner);
  if (m) {
    const resuming = /picking it back up|Riprendo in background/.test(m[5]!);
    return {
      state: resuming ? 'resuming' : 'waiting',
      done: +m[1]!,
      total: +m[2]!,
      detail: null,
      open: splitList(m[4]!),
      closed: splitList(m[3] ?? '')
    };
  }
  m = STOPPED.exec(inner);
  if (m) {
    return {
      state: 'stopped',
      done: +m[1]!,
      total: +m[2]!,
      detail: m[4]!.trim(),
      open: splitList(m[5]!),
      closed: splitList(m[3] ?? '')
    };
  }
  return null;
}

/**
 * Stacca il goal notice dalla coda di un blocco di testo.
 * - notice riconosciuto → `{ text: <senza il notice>, status }`
 * - paragrafo goal-simile ma non combaciante → underscore convertiti in `*…*` (corsivo), niente card
 * - nessun notice → testo com'era.
 */
export function splitGoalStatus(text: string): { text: string; status: GoalStatus | null } {
  const m = NOTICE_AT_END.exec(text);
  if (!m) return { text, status: null };
  const status = parseNotice(m[1]!.trim());
  if (!status) {
    // Mai più underscore crudi: il paragrafo resta testo, ma in corsivo vero.
    return {
      text: text.slice(0, m.index) + m[0]!.replace(/^([\s\S]*?)_([\s\S]*)_(\s*)$/, '$1*$2*$3'),
      status: null
    };
  }
  return { text: text.slice(0, m.index).replace(/\s+$/, ''), status };
}
