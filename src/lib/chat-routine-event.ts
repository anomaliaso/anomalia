/**
 * L'EVENTO DI CICLO DI VITA DI UNA ROUTINE, come lo legge la chat.
 *
 * Quando in una conversazione nasce, cambia, si spegne o sparisce un incarico ricorrente, il
 * fatto non deve vivere solo nella prosa del modello: una frase scorre via, e domani nessuno sa
 * più quando quella routine è stata creata né com'era prima. Quindi ogni tool del ciclo di vita
 * (`create_scheduled_agent`, `update_scheduled_agent`, `set_scheduled_agent_enabled`) restituisce
 * ANCHE questo oggetto, e la chat ci disegna una riga di sistema centrata — `Nuova routine "…"` —
 * che al click apre i dettagli.
 *
 * Client-safe e con UN normalizzatore, per la stessa ragione di chat-team.ts / chat-connect.ts:
 * lo leggono tre posti — la persistenza (che arricchisce la tool-call part perché la compattazione
 * dei turni lunghi butta gli output), la ChatColumn e la chat a pagina piena — e due copie della
 * regola "cosa è renderizzabile" divergono al primo cambio.
 *
 * Le ETICHETTE non viaggiano qui: nomi dei giorni, verbi, titoli li mette la riga dai cataloghi
 * i18n, così un turno salvato mesi fa si rilegge nella lingua di chi guarda.
 */

export type RoutineEventKind = 'created' | 'updated' | 'paused' | 'resumed' | 'deleted';

/**
 * I tool che emettono l'evento. Sta qui e non nelle superfici perché lo leggono in tre — la
 * persistenza e le due chat — e un elenco copiato tre volte si scolla al quarto tool.
 */
export const ROUTINE_EVENT_TOOLS: readonly string[] = [
  'create_scheduled_agent',
  'update_scheduled_agent',
  'set_scheduled_agent_enabled'
];

/** Cosa è cambiato in una modifica: solo i campi che una persona riconosce a colpo d'occhio. */
export type RoutineChange = {
  field: 'name' | 'prompt' | 'schedule' | 'agent';
  from: string;
  to: string;
};

export type ChatRoutineEvent = {
  kind: RoutineEventKind;
  id: string;
  name: string;
  /**
   * La colonna `agent` così com'è nel DB: `team:<id>` / `custom:<uuid>` quando la routine ha un
   * proprietario, altrimenti l'hub che la esegue (`content`, `auto`, …). Serve alla riga per
   * pescare faccia e colore dal catalogo avatar, esattamente come fa ChatAgentProposalCard.
   */
  agent: string | null;
  /** Nome del proprietario, vuoto quando la routine non è di nessuno. */
  ownerName: string;
  /**
   * true = il proprietario è chi parla in questo thread. La riga tace il "per X" solo in questo
   * caso: è la differenza fra "mi sono dato una routine" e "ho dato una routine al Web Specialist",
   * ed è il caso "per gli altri" per cui questa riga esiste.
   */
  self: boolean;
  /** Chi l'ha fatto: l'agente che parlava nel thread quando il tool è stato chiamato. */
  by: string;
  days: number[];
  times: string[];
  /** Il brief integrale — anche per un delete, perché è l'ultima copia che resta a schermo. */
  prompt: string;
  /** ISO del prossimo giro, quando lo sappiamo (null se spenta o non calcolabile). */
  nextRun: string | null;
  /** Solo per 'updated'. Vuoto quando il prima non era ricavabile. */
  changes: RoutineChange[];
};

const KINDS: readonly RoutineEventKind[] = ['created', 'updated', 'paused', 'resumed', 'deleted'];
const FIELDS: readonly RoutineChange['field'][] = ['name', 'prompt', 'schedule', 'agent'];

const str = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function change(raw: unknown): RoutineChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const field = FIELDS.find((f) => f === c.field);
  if (!field) return null;
  // 600: abbastanza per riconoscere un brief riscritto, non tanto da rifare il brief due volte —
  // quello integrale sta già in `prompt`.
  const from = str(c.from, 600);
  const to = str(c.to, 600);
  // Un "cambiamento" in cui prima e dopo coincidono non è una notizia: non si mostra.
  if (from === to) return null;
  return { field, from, to };
}

/** Accetta sia la part arricchita dalla persistenza sia l'output grezzo del turno live. */
export function normalizeRoutineEvent(raw: unknown): ChatRoutineEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const e = (src.routine_event && typeof src.routine_event === 'object' ? src.routine_event : src) as Record<
    string,
    unknown
  >;

  const kind = KINDS.find((k) => k === e.kind);
  const name = str(e.name, 80);
  // Senza verbo o senza nome non c'è una riga da scrivere: meglio niente che "Nuova routine """.
  if (!kind || !name) return null;

  return {
    kind,
    id: str(e.id, 64),
    name,
    agent: typeof e.agent === 'string' && e.agent ? e.agent.slice(0, 48) : null,
    ownerName: str(e.owner_name ?? e.ownerName, 80),
    self: e.self === true,
    by: str(e.by, 80),
    days: Array.isArray(e.days)
      ? [...new Set(e.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [],
    times: Array.isArray(e.times) ? e.times.map((t) => str(t, 5)).filter(Boolean).slice(0, 12) : [],
    prompt: String(e.prompt ?? '').trim().slice(0, 8000),
    nextRun: typeof e.next_run === 'string' && e.next_run ? e.next_run : null,
    changes: Array.isArray(e.changes) ? e.changes.map(change).filter((c): c is RoutineChange => !!c).slice(0, 4) : []
  };
}
