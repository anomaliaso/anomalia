/**
 * OBIETTIVO: la differenza fra "il turno è finito" e "il lavoro è fatto".
 *
 * Un turno finisce quando il modello smette di chiamare tool, non quando il compito è completo, e
 * tutta la distanza fra i due è «ho sistemato gli articoli» dopo averne sistemati sei su dieci. Il
 * rimedio non è chiedere al modello di essere più coscienzioso: è dargli un posto dove scrivere
 * PRIMA cosa dovrà essere vero alla fine, e far decidere a un pezzo di codice se quel momento è
 * arrivato.
 *
 * 1. Se lo dà da solo: `set_goal` (goal-tools.ts), su richiesta del prompt.
 * 2. Vive più a lungo del turno: sta sul thread e rientra nel prompt a ogni giro (`goalBriefing`).
 * 3. Chiude il codice: `close_goal` con esito "raggiunto" è rifiutato finché resta un criterio
 *    aperto, e a fine turno `decideGoalContinuation` decide se rimettere il lavoro in coda.
 *
 * Il contrappeso, perché una ripresa costa crediti veri: la catena si ferma da sola se un giro non
 * chiude niente (`no_progress`), dopo `GOAL_MAX_LAPS`, appena il loop-guard segnala che l'agente
 * gira a vuoto, e mai contro un turno fermato dall'utente.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { trackGoalEvent } from '$lib/server/chat/goal-log';

export type GoalCriterionStatus = 'open' | 'done' | 'dropped';

export type GoalCriterion = {
  /** Breve e stabile (`c1`, `c2`…): è così che il modello ne spunta uno senza ricopiarne il testo. */
  id: string;
  text: string;
  status: GoalCriterionStatus;
  /** Cosa è stato fatto davvero, o perché il criterio è caduto. Una riga. */
  note?: string | null;
};

export type ChatGoalStatus = 'open' | 'met' | 'handed_back' | 'abandoned';

export type ChatGoal = {
  id: string;
  /** Serve solo al diario: un evento senza brand non è interrogabile da nessuna parte. */
  brand_id: string;
  thread_id: string;
  statement: string;
  criteria: GoalCriterion[];
  status: ChatGoalStatus;
  laps: number;
  source: 'agent' | 'user';
  closing_note: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Oltre otto non è un obiettivo, è un piano di progetto — e un piano di progetto dentro un turno di
 * chat è il modo in cui un agente si perde. Chi ne ha bisogno di più apre un secondo obiettivo.
 */
export const MAX_GOAL_CRITERIA = 8;

/** Un criterio è una frase verificabile, non un capitolo. */
export const MAX_CRITERION_CHARS = 200;

/**
 * Quante riprese automatiche può consumare UN obiettivo. Distinto da `CHAT_MAX_CONTINUATIONS`, che
 * è un limite fisico: questo è economico. Un lavoro che dopo quattro giri pieni non ha chiuso i suoi
 * criteri non ha bisogno di un quinto giro, ha bisogno di una persona.
 */
export const GOAL_MAX_LAPS = 4;

/**
 * Quanti giri A VUOTO (zero criteri chiusi) prima di tornare alla persona. Uno, e non zero: il turno
 * che riparte sa PERCHÉ il precedente non ha chiuso niente e se lo sente dire in cima al prompt
 * (`goalContinuationPrompt`, ramo `emptyLap`), quindi non è una ripetizione.
 *
 * Ma è uno, perché il tetto vero è il conto dell'utente: se anche il giro informato non chiude
 * niente, nessun terzo giro lo risolve. Un giro di chat costa da $0.06 a ~$1 con un render dentro.
 */
export const GOAL_MAX_EMPTY_LAPS = 1;

/**
 * Quanti criteri l'avviso di fine turno nomina come «appena chiusi»; oltre, nessuno. La soglia è
 * binaria per onestà: un elenco troncato letto come completo sarebbe una bugia. Chiudere più di tre
 * criteri in un turno solo è per di più il comportamento che il prompt vieta.
 */
export const NOTICE_MAX_NAMED_CLOSED = 3;

/** Un obiettivo è aperto finché resta un criterio da chiudere. */
export function openCriteria(criteria: GoalCriterion[]): GoalCriterion[] {
  return criteria.filter((c) => c.status === 'open');
}

export function goalProgress(criteria: GoalCriterion[]): { done: number; open: number; total: number } {
  const total = criteria.filter((c) => c.status !== 'dropped').length;
  const done = criteria.filter((c) => c.status === 'done').length;
  return { done, open: openCriteria(criteria).length, total };
}

/** Nessun criterio aperto = obiettivo raggiunto. Un obiettivo senza criteri non è raggiungibile. */
export function goalIsMet(criteria: GoalCriterion[]): boolean {
  return criteria.length > 0 && openCriteria(criteria).length === 0;
}

/** `c1`, `c2`… il primo id libero, così un criterio aggiunto dopo non ne riusa uno già speso. */
export function nextCriterionId(existing: GoalCriterion[]): string {
  let max = 0;
  for (const c of existing) {
    const n = /^c(\d+)$/.exec(c.id)?.[1];
    if (n) max = Math.max(max, Number(n));
  }
  return `c${max + 1}`;
}

/**
 * Da lista di frasi a criteri veri: ripulisce, tronca, toglie i doppioni e taglia al tetto.
 *
 * ponytail: NON si filtra per provenienza, ed è dichiarato. Un criterio nato da una riga di mestiere
 * del system prompt («lascia sempre un'idea nuova nel banco») diventa un task che l'utente non ha
 * chiesto — ma un criterio è testo libero e ogni regola automatica taglia anche quelli buoni, e i due
 * errori non costano uguale: un criterio di troppo si legge e si butta (`update_goal(drop=…)`), uno
 * legittimo scartato in silenzio restringe l'obiettivo, che poi si chiude RAGGIUNTO col lavoro non
 * fatto. La guardia sta nel prompt. Se un giorno servisse in codice, l'unico segnale non ambiguo è la
 * RIPETIZIONE parola per parola su thread e brand diversi.
 *
 * Il de-dup è per testo normalizzato e non per id: il modello che riapre lo stesso obiettivo riscrive
 * gli stessi criteri con le stesse parole, e la lista raddoppierebbe a ogni giro.
 */
export function normalizeGoalCriteria(
  texts: string[],
  existing: GoalCriterion[] = []
): GoalCriterion[] {
  const out = [...existing];
  const seen = new Set(existing.map((c) => c.text.trim().toLowerCase()));
  for (const raw of texts) {
    if (out.length >= MAX_GOAL_CRITERIA) break;
    const text = String(raw ?? '').trim().slice(0, MAX_CRITERION_CHARS);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: nextCriterionId(out), text, status: 'open', note: null });
  }
  return out;
}

/** Trova un criterio per id (`c2`) o per testo esatto: il modello usa l'uno o l'altro. */
export function findCriterion(criteria: GoalCriterion[], ref: string): GoalCriterion | undefined {
  const needle = String(ref ?? '').trim().toLowerCase();
  if (!needle) return undefined;
  return (
    criteria.find((c) => c.id.toLowerCase() === needle) ??
    criteria.find((c) => c.text.trim().toLowerCase() === needle)
  );
}

/**
 * RACCONTARE NON È FARE — i criteri che il TESTO del turno dà per chiusi mentre il lavoro è stato
 * fatto davvero: un agente che ha capito «chiuso» come un'etichetta da scrivere invece che come una
 * chiamata da fare. Stessa forma di `production-claim.ts`, trattamento opposto: là si corregge una
 * consegna inventata, qui si REGISTRA una consegna vera che nessuno ha scritto nel registro.
 *
 * Fidarsi della frase non apre un buco nuovo — `update_goal(done=[…])` non verifica niente neanche
 * lui — e qui il rituale è più severo: senza almeno un tool non-goal RIUSCITO la frase non vale.
 */
const CLOSURE_MARK =
  /\bc(\d+)\b[\s:\-–—)*_.]{0,4}(?:è\s+)?(?:chius[oi]|fatt[oi]|complet(?:o|i|at[oi]|e)|done|closed|completed|ok)\b/gi;

/** Gli id dei criteri ANCORA APERTI che il testo di questo turno dichiara chiusi. */
export function declaredClosures(
  text: string | null | undefined,
  criteria: GoalCriterion[]
): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '')
    .slice(0, 8000)
    .matchAll(CLOSURE_MARK)) {
    const id = `c${m[1]}`;
    if (findCriterion(criteria, id)?.status === 'open' && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * La nota che marca una chiusura arrivata dal TESTO del turno invece che da una chiamata. In un posto
 * solo perché la scrive `settleGoalForTurn` e la RILEGGE `proseClosedCount`: due copie divergono e il
 * conteggio torna zero senza che nessuno se ne accorga. ponytail: uguaglianza della nota invece di
 * una colonna nuova — una migration qui il deploy non la applica.
 */
export const PROSE_CLOSE_NOTE = {
  en: 'Closed from the turn that described it as done without calling update_goal.',
  it: 'Chiuso dal turno che lo dava per fatto senza chiamare update_goal.'
} as const;

/** Quanti criteri sono stati spuntati dal testo del turno e non da uno strumento. */
export function proseClosedCount(criteria: GoalCriterion[]): number {
  const marks: string[] = Object.values(PROSE_CLOSE_NOTE);
  return criteria.filter((c) => !!c.note && marks.includes(c.note)).length;
}

/**
 * UN TOOL CHIAMATO NON È UN TOOL RIUSCITO: con la sola prova «un tool non-goal chiamato nel turno»,
 * due `create_motion_video`/`write_motion_source` tornati entrambi `error` chiudevano il criterio, e
 * sulla riga restava scritto che era fatto. La prova è il RISULTATO.
 */
type StepPart = {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
};
export type TurnStep = {
  toolCalls?: Array<{ toolName?: string; toolCallId?: string }>;
  toolResults?: StepPart[];
  content?: StepPart[];
};

/** `{type:'json',value:{…}}` è come l'SDK incarta un output; sotto c'è l'oggetto vero. */
function outputSaysError(raw: unknown): boolean {
  const o = raw as Record<string, unknown> | null | undefined;
  const out = o && typeof o === 'object' && 'value' in o && 'type' in o ? o.value : raw;
  const o2 = out as Record<string, unknown> | null | undefined;
  // `retry` è un rifiuto ripetibile (es. storyboard_first): non è una consegna. Vedi output-tools.ts.
  return !!(o2 && typeof o2 === 'object' && (o2.error || o2.retry));
}

/** I nomi dei tool che in QUESTO turno hanno restituito qualcosa che non è un errore. */
export function succeededToolNames(
  steps: TurnStep[] | undefined,
  exclude: readonly string[] = []
): string[] {
  const skip = new Set(exclude);
  const out = new Set<string>();
  for (const st of steps ?? []) {
    const nameById = new Map<string, string>();
    for (const tc of st.toolCalls ?? []) {
      if (tc.toolCallId && tc.toolName) nameById.set(tc.toolCallId, tc.toolName);
    }
    for (const p of st.content ?? []) {
      if (p?.type === 'tool-call' && p.toolCallId && p.toolName) nameById.set(p.toolCallId, p.toolName);
    }
    const consider = (name: string | undefined, payload: unknown) => {
      if (!name || skip.has(name)) return;
      if (outputSaysError(payload)) return;
      out.add(name);
    };
    for (const r of st.toolResults ?? []) {
      consider(r.toolName ?? (r.toolCallId ? nameById.get(r.toolCallId) : undefined), r.output ?? r.result);
    }
    for (const p of st.content ?? []) {
      if (p?.type === 'tool-result') {
        consider(p.toolName ?? (p.toolCallId ? nameById.get(p.toolCallId) : undefined), p.output ?? p.result);
      } else if (p?.type === 'tool-call' && p.output !== undefined) {
        consider(p.toolName, p.output);
      }
    }
  }
  return [...out];
}

/**
 * LEGGERE NON È LAVORARE. La scorciatoia della prosa vuole un lavoro che LASCIA UNA TRACCIA: un turno
 * che chiama solo `read_motion_source` e scrive «c2 closed, MP4 attached» chiudeva l'obiettivo su un
 * `preview_url` NULL. `unprovenCriteria` non lo prende — quel testo non nomina nessun tool — e che lo
 * prenda o no dipende da come il modello ha scritto la frase in `set_goal`: fortuna, non meccanismo.
 *
 * I due errori non costano uguale: un criterio che resta aperto costa un giro e un `update_goal`
 * esplicito, uno chiuso di troppo è la bugia che questo file esiste per impedire.
 *
 * ponytail: read/write si decide dal NOME, non da un registro. Qui i nomi sono verbi coerenti e
 * l'errore costa un giro; se servisse esatto, il posto è una proprietà sul tool.
 *
 * Il verbo si riconosce in qualunque posizione del nome, non solo in testa: i tool del kit lo
 * portano dopo il prefisso del mestiere (`content_list_posts`, `web_read_seo_audit`, `brand_read`),
 * e con l'ancora in testa un turno di sole letture contava come lavoro fatto.
 */
const READ_LIKE = /(^|_)(read|list|grep|search|get|study|review|fetch|show|find|ls|check|query|observe)(_|$)/;

/** Fra i tool riusciti, ce n'è almeno uno che ha LASCIATO qualcosa? */
export function leftATrace(succeededTools: readonly string[]): boolean {
  return succeededTools.some((t) => !READ_LIKE.test(t));
}

/**
 * Gli stessi nomi, letti dai MESSAGGI invece che dai passi: serve a `update_goal`, che gira DENTRO il
 * ciclo e ha solo `opts.messages`. Come `hasReadFile` in agent-files.ts, e per la stessa ragione —
 * `messages` è la storia rigiocata, quindi sopravvive a una ripresa dopo il muro.
 */
type TurnMessage = { role?: string; content?: unknown };

export function succeededToolNamesFromMessages(
  messages: TurnMessage[] | undefined,
  exclude: readonly string[] = []
): string[] {
  const skip = new Set(exclude);
  const nameById = new Map<string, string>();
  const out = new Set<string>();
  const parts = (m: TurnMessage): StepPart[] => (Array.isArray(m?.content) ? (m.content as StepPart[]) : []);
  for (const m of messages ?? []) {
    for (const p of parts(m)) {
      if (p?.type === 'tool-call' && p.toolCallId && p.toolName) nameById.set(p.toolCallId, p.toolName);
    }
  }
  for (const m of messages ?? []) {
    for (const p of parts(m)) {
      const isResult = p?.type === 'tool-result' || (p?.type === 'tool-call' && p.output !== undefined);
      if (!isResult) continue;
      const name = p.toolName ?? (p.toolCallId ? nameById.get(p.toolCallId) : undefined);
      if (!name || skip.has(name)) continue;
      if (outputSaysError(p.output ?? p.result)) continue;
      out.add(name);
    }
  }
  return [...out];
}

/**
 * I tool che in questo turno sono stati RIFIUTATI e mai recuperati — letture escluse.
 *
 * L'ancora non è il testo del criterio, è il turno: hai spuntato qualcosa in un giro in cui lo
 * strumento che stavi usando ti ha detto di no. Senza, `update_goal` restava la strada più semplice
 * per la stessa bugia. Le letture non contano, o un `read_file` andato male bloccherebbe una spunta
 * che non c'entra niente.
 */
export function refusedToolNames(
  steps: TurnStep[] | undefined,
  exclude: readonly string[] = []
): string[] {
  const ok = new Set(succeededToolNames(steps, exclude));
  const skip = new Set(exclude);
  const out = new Set<string>();
  for (const st of steps ?? []) {
    const nameById = new Map<string, string>();
    for (const tc of st.toolCalls ?? []) {
      if (tc.toolCallId && tc.toolName) nameById.set(tc.toolCallId, tc.toolName);
    }
    const consider = (name: string | undefined, payload: unknown) => {
      if (!name || skip.has(name) || ok.has(name) || READ_LIKE.test(name)) return;
      if (outputSaysError(payload)) out.add(name);
    };
    for (const r of st.toolResults ?? []) {
      consider(r.toolName ?? (r.toolCallId ? nameById.get(r.toolCallId) : undefined), r.output ?? r.result);
    }
    for (const p of st.content ?? []) {
      if (p?.type === 'tool-result') {
        consider(p.toolName ?? (p.toolCallId ? nameById.get(p.toolCallId) : undefined), p.output ?? p.result);
      } else if (p?.type === 'tool-call' && p.output !== undefined) {
        consider(p.toolName, p.output);
      }
    }
  }
  return [...out];
}

/**
 * PROVENIENZA: «l'ho trovato» non è «l'ho fatto». Una verifica di ESISTENZA («c'è un MP4?»)
 * promuoverebbe un file di sei ore prima, letto da `list_motion_videos` in un'altra conversazione.
 *
 * Quindi: se il testo del criterio NOMINA un tool dell'agente, quel tool deve essere girato bene
 * almeno una volta da quando l'obiettivo è aperto. Un criterio che non nomina nessun tool non si
 * tocca — qui non si indovina, si controlla ciò che il criterio dichiara.
 */
const TOOL_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

export function toolsNamedBy(text: string | null | undefined, knownTools: readonly string[]): string[] {
  const known = new Set(knownTools);
  const out: string[] = [];
  for (const m of String(text ?? '').toLowerCase().matchAll(TOOL_TOKEN)) {
    if (known.has(m[0]) && !out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

/** I criteri che nominano un tool e non hanno NESSUNO dei tool nominati fra quelli riusciti. */
export function unprovenCriteria(
  criteria: GoalCriterion[],
  proven: ReadonlySet<string>,
  knownTools: readonly string[]
): GoalCriterion[] {
  if (!knownTools.length) return [];
  return criteria.filter((c) => {
    const named = toolsNamedBy(c.text, knownTools);
    return named.length > 0 && !named.some((t) => proven.has(t));
  });
}

export type CriteriaUpdate = {
  done?: string[];
  drop?: string[];
  add?: string[];
  note?: string | null;
};

/**
 * Applica una modifica alla lista e dice cosa non ha trovato: un `done: ["c9"]` inghiottito in
 * silenzio è il caso in cui il modello crede di aver chiuso un criterio che è ancora lì.
 */
export function applyCriteriaUpdate(
  criteria: GoalCriterion[],
  update: CriteriaUpdate
): { criteria: GoalCriterion[]; closed: number; unknown: string[] } {
  const next = criteria.map((c) => ({ ...c }));
  const unknown: string[] = [];
  let closed = 0;

  for (const ref of update.done ?? []) {
    const found = findCriterion(next, ref);
    if (!found) {
      unknown.push(ref);
      continue;
    }
    if (found.status === 'open') closed++;
    found.status = 'done';
    if (update.note) found.note = String(update.note).slice(0, MAX_CRITERION_CHARS);
  }
  for (const ref of update.drop ?? []) {
    const found = findCriterion(next, ref);
    if (!found) {
      unknown.push(ref);
      continue;
    }
    found.status = 'dropped';
    if (update.note) found.note = String(update.note).slice(0, MAX_CRITERION_CHARS);
  }

  return { criteria: normalizeGoalCriteria(update.add ?? [], next), closed, unknown };
}

/**
 * QUALI criteri si sono chiusi fra due istantanee — i nomi servono all'avviso di fine turno, che è la
 * fotografia di QUEL turno e non lo stato accumulato.
 *
 * Per differenza e non con un contatore dentro il tool: nel corso di un turno l'obiettivo può essere
 * toccato più volte e da percorsi diversi, e un contatore risponderebbe a «quante volte è stato
 * chiamato update_goal» invece che a «quanto è avanzato il lavoro». Un criterio nato E chiuso dentro
 * lo stesso turno conta come avanzamento, perché lo è.
 */
export function closedSince(
  before: GoalCriterion[] | null | undefined,
  after: GoalCriterion[]
): GoalCriterion[] {
  const wasOpen = new Map((before ?? []).map((c) => [c.id, c.status]));
  return after.filter((c) => {
    if (c.status === 'open') return false;
    const prev = wasOpen.get(c.id);
    return prev === undefined || prev === 'open';
  });
}

export function criteriaClosedBetween(
  before: GoalCriterion[] | null | undefined,
  after: GoalCriterion[]
): number {
  return closedSince(before, after).length;
}

/**
 * La richiesta ha la forma di un lavoro in più passi? Serve solo ad alzare la voce nel prompt del
 * turno; non decide niente, e un falso positivo costa una chiamata a `set_goal`. Volutamente
 * prudente: meglio non accorgersi di un lavoro grosso che trasformare «com'è andato il post di
 * ieri?» in un progetto con la sua checklist.
 */
const GOAL_WORTHY_PATTERNS: RegExp[] = [
  /\b(tutt[ieo]|ognuno|ogni|all\s+(the\s+)?|every|each)\s+\w{3,}/i,
  /\b(sistema|sistemare|ripulisci|ripulire|correggi|correggere|rifai|rifare|aggiorna tutt|fix|clean\s?up|repair|refactor|migrate|migra)\b/i,
  /\b(produci|produrre|prepara|preparare|genera|generare|pianifica|pianificare|lancia|lanciare|produce|prepare|plan|launch)\b.{0,40}\b(settiman|mese|campagna|calendario|piano|week|month|campaign|calendar|plan|batch)/i,
  /\b(audit|revisione completa|review\s+(all|every|the whole)|analizza a fondo|full review)\b/i,
  /\b\d{2,}\s+\w{3,}/,
  /(^|\n)\s*(\d+[.)]|[-*])\s+\S+(\s|\S)*\n\s*(\d+[.)]|[-*])\s+\S+/
];

export function goalWorthyRequest(text: string | null | undefined): boolean {
  const t = String(text ?? '').trim();
  // Sotto una certa lunghezza è una domanda, non un incarico — e un obiettivo aperto su «ciao» resta
  // appeso al thread e rientra in ogni prompt successivo.
  if (t.length < 25) return false;
  return GOAL_WORTHY_PATTERNS.some((re) => re.test(t));
}

/**
 * La riga in più quando la richiesta ha forma di incarico e nessun obiettivo è aperto: la regola sta
 * già nella descrizione di `set_goal`, questa la ripete sul turno giusto, e si paga solo lì.
 */
export function goalNudge(locale: string): string {
  return bilingualNoticeLocale(locale) === 'en'
    ? 'THIS REQUEST LOOKS LIKE A MULTI-STEP JOB. Call set_goal BEFORE your first action: one sentence, then the checkable facts that will make it true. Close each one with update_goal as you go — closing is a CALL, not a word: "c1 done" written in your reply closes nothing. Do not ask permission — it is your own working discipline, not a decision for the user.'
    : 'QUESTA RICHIESTA HA LA FORMA DI UN LAVORO IN PIÙ PASSI. Chiama set_goal PRIMA della prima azione: una frase, poi i fatti verificabili che la renderanno vera. Chiudili uno per uno con update_goal mentre procedi — chiudere è una CHIAMATA, non una parola: «c1 chiuso» scritto nella risposta non chiude niente. Non chiedere il permesso — è la tua disciplina di lavoro, non una decisione dell\'utente.';
}

/** Le righe dell'obiettivo che rientrano nel system prompt a ogni turno. */
export function goalBriefing(goal: ChatGoal, locale: string): string {
  const { done, total } = goalProgress(goal.criteria);
  const lines = goal.criteria.map((c) => {
    const mark = c.status === 'done' ? '[x]' : c.status === 'dropped' ? '[–]' : '[ ]';
    return `${mark} ${c.id}: ${c.text}${c.note ? ` — ${c.note}` : ''}`;
  });
  const en = bilingualNoticeLocale(locale) === 'en';
  const head = en
    ? `OPEN GOAL FOR THIS CONVERSATION (${done}/${total} criteria closed, ${goal.laps} background resume${goal.laps === 1 ? '' : 's'} used)`
    : `OBIETTIVO APERTO DI QUESTA CONVERSAZIONE (${done}/${total} criteri chiusi, ${goal.laps} ripres${goal.laps === 1 ? 'a' : 'e'} in background usat${goal.laps === 1 ? 'a' : 'e'})`;
  // Obiettivo dettato dall'utente e non ancora scomposto: c'è una sola cosa da dire, ed è quella.
  if (!goal.criteria.length) {
    return en
      ? `OPEN GOAL FOR THIS CONVERSATION (set by the user, not yet broken down)\n${goal.statement}\n\n- Your FIRST action this turn is set_goal with exactly this statement and the verifiable criteria you derive from it. Then work through them and close each one with update_goal.\n- Until it has criteria this goal cannot be closed, and nothing resumes it: breaking it down is not optional.`
      : `OBIETTIVO APERTO DI QUESTA CONVERSAZIONE (dettato dall'utente, non ancora scomposto)\n${goal.statement}\n\n- La tua PRIMA azione in questo turno è set_goal con esattamente questa frase e i criteri verificabili che ne derivi. Poi lavoraci e chiudili uno per uno con update_goal.\n- Finché non ha criteri questo obiettivo non si può chiudere, e niente lo riprende: scomporlo non è facoltativo.`;
  }
  const rules = en
    ? [
        'This goal is yours: you set it, and it outlives the turn that opened it. It is still open, so the work is NOT done.',
        'Work on the first open criterion. Close each one with update_goal(done=["c1"], note="what is actually true now") the moment it is really true — not in advance, not in bulk at the end.',
        'CLOSING IS A CALL, NOT A LABEL. Writing "c1 done" in your reply closes nothing: the checklist above is read by code, and code only sees update_goal. A criterion you describe as finished without the call is a turn that closed nothing — say it AND call it, or do not say it.',
        'WHILE THIS GOAL IS OPEN YOU DO NOT ASK PERMISSION. No "shall I go ahead?", no choice between two ways of doing the same thing, no ending the turn on a question while a criterion is still yours to close. The goal IS the permission and the order of the steps is your craft. Do not stop to wait for a verdict you can give yourself either — if a review or a QC is what is missing, run it.',
        'Ask only for something that exists nowhere but in their head and without which you would be inventing (their budget, their decision, a fact only they know) — and then use ask_user_questions, which stops the turn properly, instead of a question in prose that leaves everyone waiting.',
        'Never claim the job is finished while a criterion is open. close_goal(outcome="met") is refused until they all are.',
        'If the user asks something else, answer THEM first. The goal stays open and you come back to it in the same turn.',
        'If a criterion turns out to be impossible or pointless, drop it with update_goal(drop=["c3"], note="why") — do not leave it open forever, and do not pretend it is done.',
        'Same for a criterion that is not really part of what was asked but a standard of your craft (always leave an idea behind, always match the palette): it holds the job hostage to work nobody asked for. If it would be just as true for a completely different request, drop it with the reason.'
      ]
    : [
        'Questo obiettivo è tuo: te lo sei dato tu, e sopravvive al turno che lo ha aperto. È ancora aperto, quindi il lavoro NON è finito.',
        'Lavora sul primo criterio aperto. Chiudi ogni criterio con update_goal(done=["c1"], note="cosa è vero adesso") nel momento in cui è davvero vero — non prima, non tutti insieme alla fine.',
        'CHIUDERE È UNA CHIAMATA, NON UN\'ETICHETTA. Scrivere «c1 chiuso» nella risposta non chiude niente: la checklist qui sopra la legge il codice, e il codice vede solo update_goal. Un criterio che descrivi come fatto senza la chiamata è un turno che non ha chiuso nulla — dillo E chiamalo, oppure non dirlo.',
        'FINCHÉ QUESTO OBIETTIVO È APERTO NON CHIEDI IL PERMESSO. Niente «vuoi che proceda?», niente bivi fra due modi di fare la stessa cosa, niente turni che finiscono con una domanda mentre resta un criterio che puoi chiudere da solo. L\'obiettivo È il permesso e l\'ordine dei passi è mestiere tuo. E non fermarti ad aspettare un giudizio che puoi darti da solo — se manca una review o un QC, fallo.',
        "Chiedi solo ciò che esiste unicamente nella testa della persona e senza cui inventeresti (il suo budget, una sua decisione, un fatto che sa solo lei) — e allora usa ask_user_questions, che ferma il turno per davvero, invece di una domanda in prosa che lascia tutti ad aspettare.",
        'Non dire mai che il lavoro è finito mentre un criterio è aperto. close_goal(outcome="met") viene rifiutato finché non lo sono tutti.',
        "Se l'utente chiede altro, rispondi PRIMA a lui. L'obiettivo resta aperto e ci torni nello stesso turno.",
        'Se un criterio si rivela impossibile o inutile, buttalo con update_goal(drop=["c3"], note="perché") — non lasciarlo aperto per sempre, e non fingere che sia fatto.',
        "Idem per un criterio che non è davvero parte di ciò che è stato chiesto ma uno standard del tuo mestiere (lasciare sempre un'idea nel banco, rispettare sempre la palette): tiene in ostaggio il lavoro per una cosa che nessuno ha chiesto. Se sarebbe altrettanto vero per una richiesta completamente diversa, buttalo con la ragione."
      ];
  return `${head}\n${goal.statement}\n${lines.join('\n')}\n\n${rules.map((r) => `- ${r}`).join('\n')}`;
}

/**
 * Il prompt della ripresa in background: non «continua», ma «mancano questi». Il turno che riparte
 * vede la cronologia dal di fuori, e senza i criteri aperti ricomincerebbe dal primo elemento della
 * lista rifacendo ciò che è già fatto.
 */
export function goalContinuationPrompt(
  goal: ChatGoal,
  locale: string,
    /**
     * Il giro precedente non ha chiuso NIENTE: è l'unico caso in cui la ripresa deve dire anche
     * perché sta ripartendo, o sarebbe la stessa istruzione di prima. Vedi `GOAL_MAX_EMPTY_LAPS`.
     */
  opts?: { emptyLap?: boolean }
): string {
  const open = openCriteria(goal.criteria).map((c) => `- ${c.id}: ${c.text}`);
  const emptyEn = opts?.emptyLap
    ? [
        'THE PREVIOUS PASS CLOSED NOTHING. This is your second and last automatic attempt on it: if this one closes nothing either, the goal goes back to the user unfinished.',
        'The three ways a pass ends up empty, and what to do instead:',
        '- You did the work and only described it ("c1 done") without calling update_goal. Writing it closes nothing: call update_goal(done=["c1"], note="what is true now") NOW for everything that is already true.',
        '- You asked permission or offered a choice instead of acting. Do not. The goal is the permission and the order of the steps is your job — pick one and do it.',
        '- You stopped to wait for a verdict you can give yourself (a review, a QC, "tell me if it is fine"). Give it yourself and close the criterion.'
      ]
    : [];
  const emptyIt = opts?.emptyLap
    ? [
        'IL GIRO PRECEDENTE NON HA CHIUSO NIENTE. Questo è il secondo e ultimo tentativo automatico: se anche questo non chiude niente, l\'obiettivo torna all\'utente incompiuto.',
        'I tre modi in cui un giro finisce a vuoto, e cosa fare invece:',
        '- Hai fatto il lavoro e l\'hai solo raccontato ("c1 chiuso") senza chiamare update_goal. Scriverlo non chiude niente: chiama update_goal(done=["c1"], note="cosa è vero adesso") ADESSO per tutto ciò che è già vero.',
        '- Hai chiesto il permesso o offerto un bivio invece di agire. Non si fa. L\'obiettivo È il permesso e l\'ordine dei passi è mestiere tuo: scegline uno e fallo.',
        '- Ti sei fermato ad aspettare un giudizio che puoi darti da solo (una review, un QC, "dimmi se va bene"). Dattelo e chiudi il criterio.'
      ]
    : [];
  if (bilingualNoticeLocale(locale) === 'en') {
    return [
      ...emptyEn,
      'Keep working on the goal you set for yourself. The previous turn ended on a limit, not because the work was done.',
      `Goal: ${goal.statement}`,
      'Still open:',
      ...open,
      'Resume from the first one, do NOT redo anything already closed, and close each criterion with update_goal as soon as it is really true. If one of them is impossible, drop it with a reason instead of leaving it open.'
    ].join('\n');
  }
  return [
    ...emptyIt,
    "Continua a lavorare sull'obiettivo che ti sei dato. Il turno precedente si è chiuso su un limite, non perché il lavoro fosse finito.",
    `Obiettivo: ${goal.statement}`,
    'Ancora aperti:',
    ...open,
    'Riprendi dal primo, NON rifare quelli già chiusi, e chiudi ogni criterio con update_goal appena è davvero vero. Se uno è impossibile, buttalo con una ragione invece di lasciarlo aperto.'
  ].join('\n');
}

export type GoalContinuationReason =
  /** Restano criteri aperti e la catena può ancora girare. */
  | 'open_criteria'
  /** Il turno è finito sul tempo: è la ripresa che esisteva già, obiettivo o no. */
  | 'out_of_time'
  | 'no_goal'
  | 'met'
  /** Dettato dall'utente e mai scomposto: non c'è niente su cui far ripartire un turno. */
  | 'no_criteria'
  /** Un giro intero senza chiudere un criterio: non è lento, è bloccato. */
  | 'no_progress'
  /**
   * Un giro a vuoto, ma il PRIMO: si riprova una volta sola, dicendo all'agente perché.
   * Vedi `GOAL_MAX_EMPTY_LAPS`.
   */
  | 'no_progress_retry'
  | 'laps_exhausted'
  | 'depth_exhausted'
  | 'stalled'
  | 'stopped'
  | 'failed'
    /**
     * Il turno si è chiuso su una domanda all'utente: non è un fallimento e non è un traguardo, è
     * un'attesa. Riprendere in background qui significherebbe rispondersi da soli alla domanda
     * appena fatta.
     */
  | 'awaiting_answer';

export type GoalContinuationDecision = {
  continue: boolean;
  reason: GoalContinuationReason;
  /** True quando la catena si ferma con lavoro ancora aperto: l'obiettivo torna alla persona. */
  handBack: boolean;
};

/**
 * Questo turno è la fine del lavoro, o solo la fine del turno? Pura e testabile perché la prendono
 * due motori diversi (la route che streamma e il worker della coda) e devono prenderla identica.
 *
 * L'ORDINE DEI CONTROLLI NON È COSMETICO: prima ciò che vieta di continuare in assoluto (Stop
 * dell'utente, stream morto, loop-guard), perché riprendere lì è ripartire dentro lo stesso muro a
 * spese dell'utente; poi il tetto di catena, che è fisico; poi il tempo scaduto, che è la ripresa che
 * esisteva già prima degli obiettivi e vale anche senza obiettivo e anche se l'obiettivo è raggiunto
 * (la richiesta può contenere più dell'obiettivo); solo alla fine i criteri.
 */
export function decideGoalContinuation(input: {
  goal: ChatGoal | null;
  /** Criteri chiusi in QUESTO turno. Zero su un giro di ripresa = la catena non avanza. */
  closedThisTurn: number;
  timeRanOut: boolean;
  loopStalled: boolean;
  aborted: boolean;
  failed: boolean;
  /** Il turno è finito su `ask_user_questions`: si aspetta una persona, non un altro giro. */
  awaitingAnswer?: boolean;
  /** Profondità della catena di riprese già consumata (`continuation_depth`). */
  depth: number;
  maxDepth: number;
  maxLaps?: number;
}): GoalContinuationDecision {
  const { goal } = input;
  const stop = (reason: GoalContinuationReason, handBack = false): GoalContinuationDecision => ({
    continue: false,
    reason,
    handBack
  });

  if (input.aborted) return stop('stopped');
  if (input.failed) return stop('failed');
  // Prima di ogni altra ragione, tempo scaduto incluso: la domanda è già stata fatta, e una
  // ripresa automatica la scavalcherebbe con l'utente ancora davanti alla card.
  if (input.awaitingAnswer) return stop('awaiting_answer');
  // Un obiettivo aperto non è una ragione per riprendere dentro un loop: è la ragione per cui
  // vale la pena dirlo all'utente invece di ripartire.
  if (input.loopStalled) return stop('stalled', !!goal && !goalIsMet(goal.criteria));
  if (input.depth >= input.maxDepth) return stop('depth_exhausted', !!goal && !goalIsMet(goal.criteria));

  if (input.timeRanOut) return { continue: true, reason: 'out_of_time', handBack: false };

  if (!goal) return stop('no_goal');
  // Un obiettivo senza criteri è una frase: una ripresa automatica ripartirebbe con la stessa
  // istruzione che il turno appena finito ha già ignorato. Resta aperto, e riparte col prossimo
  // messaggio — dove l'istruzione di scomporlo torna in cima al prompt.
  if (!goal.criteria.length) return stop('no_criteria');
  if (goalIsMet(goal.criteria)) return stop('met');

  // NON SI RIPARTE PIÙ DA SOLI. Un obiettivo aperto era una ragione per rilanciare l'agente in
  // silenzio, fino a GOAL_MAX_LAPS giri più uno «a vuoto». Decisione del 25/8: un obiettivo aperto
  // è la ragione per DIRLO alla persona, non per ripartire senza che l'abbia chiesto — spendendo
  // modello e credito mentre guarda una card che si aggiorna da sé.
  //
  // `handBack: true`: il turno finisce dicendo cosa resta, e il prossimo messaggio riparte da lì —
  // dove il prompt dell'obiettivo torna comunque in cima. Il lavoro non si perde, cambia chi lo
  // decide. Il muro del serverless (`out_of_time`, sopra) resta: quello non è modalità goal.
  return stop('open_criteria', true);
}

/**
 * La riga che chiude il turno nel transcript: senza, un turno che riprenderà fra dieci secondi e uno
 * che si è arreso sono indistinguibili. `null` quando non c'è niente di onesto da aggiungere.
 */
export function goalTurnNotice(
  goal: ChatGoal | null,
  decision: GoalContinuationDecision,
  locale: string,
    /**
     * La ripresa è stata davvero messa in coda? Decidere di continuare e riuscirci sono due cose
     * diverse — la coda rifiuta di accodarsi dietro un messaggio che l'utente ha già scritto — e
     * promettere un lavoro in background che nessuno ha in programma è una bugia.
     */
  queued: boolean = decision.continue,
    /** I criteri chiusi in QUESTO turno, non tutti quelli fatti finora. Vedi NOTICE_MAX_NAMED_CLOSED. */
  closedNow: GoalCriterion[] = []
): string | null {
  if (!goal) return null;
  // Il tempo scaduto ha già la sua riga (turnTruncatedNotice): due avvisi di ripresa sullo stesso
  // turno si contraddicono a vicenda anche quando dicono la stessa cosa.
  if (decision.reason === 'out_of_time') return null;
  const { done, total } = goalProgress(goal.criteria);
  const open = openCriteria(goal.criteria);
  const en = bilingualNoticeLocale(locale) === 'en';
    // Questo testo rientra nel transcript a ogni turno successivo, quindi si paga in token per tutto
    // il resto della conversazione — e un elenco parziale spacciato per completo sarebbe peggio del
    // silenzio. ponytail: soglia binaria; se servisse nominarli in blocco, la strada è «x; y; +3».
  const named = closedNow.length && closedNow.length <= NOTICE_MAX_NAMED_CLOSED
    ? ` (${en ? 'just closed' : closedNow.length === 1 ? 'appena chiuso' : 'appena chiusi'}: ${closedNow.map((c) => c.text).join('; ')})`
    : '';

  if (decision.reason === 'met') {
    return en
      ? `\n\n_Goal reached — ${done}/${total}: ${goal.statement}_`
      : `\n\n_Obiettivo raggiunto — ${done}/${total}: ${goal.statement}_`;
  }
  if (decision.continue) {
    const left = open.map((c) => c.text).join('; ');
    if (queued) {
      return en
        ? `\n\n_Goal not reached yet — ${done}/${total} done${named}, still open: ${left}. I am picking it back up in the background._`
        : `\n\n_Obiettivo non ancora raggiunto — ${done}/${total} fatti${named}, restano: ${left}. Riprendo in background._`;
    }
    return en
      ? `\n\n_Goal not reached yet — ${done}/${total} done${named}, still open: ${left}. It stays open and I carry on with your next message._`
      : `\n\n_Obiettivo non ancora raggiunto — ${done}/${total} fatti${named}, restano: ${left}. Resta aperto e riprendo al tuo prossimo messaggio._`;
  }
  if (!decision.handBack) return null;

  const why = en
    ? decision.reason === 'no_progress'
      ? 'a whole pass closed nothing'
      : decision.reason === 'laps_exhausted'
        ? 'I used every automatic pass'
        : decision.reason === 'stalled'
          ? 'I was repeating the same steps'
          : 'I ran out of automatic passes'
    : decision.reason === 'no_progress'
      ? 'un giro intero non ha chiuso niente'
      : decision.reason === 'laps_exhausted'
        ? 'ho usato tutte le riprese automatiche'
        : decision.reason === 'stalled'
          ? 'stavo ripetendo gli stessi passi'
          : 'ho finito le riprese automatiche';

  return en
    ? `\n\n_Goal stopped at ${done}/${total}${named} — ${why}. Still open: ${open.map((c) => c.text).join('; ')}. Tell me how you want to go on._`
    : `\n\n_Obiettivo fermo a ${done}/${total}${named} — ${why}. Restano: ${open.map((c) => c.text).join('; ')}. Dimmi come vuoi procedere._`;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToGoal(row: any): ChatGoal {
  const criteria = Array.isArray(row?.criteria) ? row.criteria : [];
  return {
    id: row.id as string,
    brand_id: (row.brand_id as string) ?? '',
    thread_id: row.thread_id as string,
    statement: String(row.statement ?? ''),
    criteria: criteria
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((c: any) => c && typeof c.text === 'string')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any, i: number) => ({
        id: typeof c.id === 'string' && c.id ? c.id : `c${i + 1}`,
        text: String(c.text),
        status: (['open', 'done', 'dropped'] as const).includes(c.status) ? c.status : 'open',
        note: typeof c.note === 'string' ? c.note : null
      })),
    status: (['open', 'met', 'handed_back', 'abandoned'] as const).includes(row.status)
      ? row.status
      : 'open',
    laps: Number(row.laps ?? 0) || 0,
    source: row.source === 'user' ? 'user' : 'agent',
    closing_note: (row.closing_note as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string
  };
}

/**
 * `brandId`/`userId` sono opzionali perché le due strade sono diverse: il worker legge col service
 * role e un thread_id che gli arriva dalla riga del job, una GET del browser parte da un id che
 * l'utente può scrivere a mano. Lì il filtro esplicito non sostituisce la RLS, la affianca.
 */
type GoalScope = { brandId?: string; userId?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoped(q: any, threadId: string, scope?: GoalScope) {
  let out = q.eq('thread_id', threadId);
  if (scope?.brandId) out = out.eq('brand_id', scope.brandId);
  if (scope?.userId) out = out.eq('user_id', scope.userId);
  return out;
}

/** L'obiettivo ancora aperto del thread, se c'è. Uno solo: lo impone l'indice unico parziale. */
export async function loadOpenGoal(
  supabase: SupabaseClient,
  threadId: string,
  scope?: GoalScope
): Promise<ChatGoal | null> {
  const { data, error } = await scoped(
    supabase.from('chat_goals').select('*'),
    threadId,
    scope
  )
    .eq('status', 'open')
    .maybeSingle();
  if (error || !data) return null;
  return rowToGoal(data);
}

/** L'ultimo obiettivo del thread, aperto o chiuso: è quello che la card mostra dopo la consegna. */
export async function loadLatestGoal(
  supabase: SupabaseClient,
  threadId: string,
  scope?: GoalScope
): Promise<ChatGoal | null> {
  const { data, error } = await scoped(supabase.from('chat_goals').select('*'), threadId, scope)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToGoal(data);
}

/**
 * Apre l'obiettivo del thread, o arricchisce quello che c'è già: NON sostituisce. Un secondo
 * `set_goal` aggiorna la frase e aggiunge i criteri nuovi tenendo lo stato di quelli che esistono —
 * chi riapre un obiettivo a metà lavoro lo fa per riformularlo, non per cancellare cinque criteri
 * già chiusi. Per un obiettivo davvero diverso: chiudere questo e aprirne uno nuovo.
 */
export async function setThreadGoal(
  supabase: SupabaseClient,
  opts: {
    brandId: string;
    userId: string;
    threadId: string;
    statement: string;
    criteria: string[];
    source?: 'agent' | 'user';
  }
): Promise<{ goal: ChatGoal | null; created: boolean; error?: string }> {
  const statement = opts.statement.trim().slice(0, 500);
  const existing = await loadOpenGoal(supabase, opts.threadId);

  if (existing) {
    const criteria = normalizeGoalCriteria(opts.criteria, existing.criteria);
    const { data, error } = await supabase
      .from('chat_goals')
      .update({ statement: statement || existing.statement, criteria, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .maybeSingle();
    if (error) return { goal: existing, created: false, error: error.message };
    return { goal: data ? rowToGoal(data) : existing, created: false };
  }

  const criteria = normalizeGoalCriteria(opts.criteria);
    // Un obiettivo dell'AGENTE senza criteri è una frase, e non si può chiudere niente. Uno dettato
    // dalla PERSONA nasce legittimamente nudo — scomporlo è il primo lavoro dell'agente — e la riga
    // esiste subito perché il comando deve avere un effetto anche se poi il modello sbaglia.
  if (!criteria.length && opts.source !== 'user') {
    return { goal: null, created: false, error: 'A goal needs at least one verifiable criterion.' };
  }
  const { data, error } = await supabase
    .from('chat_goals')
    .insert({
      brand_id: opts.brandId,
      user_id: opts.userId,
      thread_id: opts.threadId,
      statement,
      criteria,
      status: 'open',
      source: opts.source ?? 'agent'
    })
    .select('*')
    .maybeSingle();
  if (data) {
    trackGoalEvent(supabase, {
      kind: 'opened',
      goalId: data.id as string,
      brandId: opts.brandId,
      userId: opts.userId,
      threadId: opts.threadId,
      actor: opts.source ?? 'agent',
      criteria,
      detail: { statement }
    });
  }
  if (error || !data) {
      // Corsa persa contro un altro turno sullo stesso thread: l'indice unico ha fatto il suo lavoro,
      // e restituire l'obiettivo dell'altro è meglio che restituire un errore.
    const now = await loadOpenGoal(supabase, opts.threadId);
    if (now) return { goal: now, created: false };
    return { goal: null, created: false, error: error?.message ?? 'Could not open the goal' };
  }
  return { goal: rowToGoal(data), created: true };
}

/** Spunta / butta / aggiunge criteri. Torna anche quanti ne ha chiusi davvero questo giro. */
export async function updateGoalCriteria(
  supabase: SupabaseClient,
  goal: ChatGoal,
  update: CriteriaUpdate
): Promise<{ goal: ChatGoal; closed: number; unknown: string[] }> {
  const applied = applyCriteriaUpdate(goal.criteria, update);
  const { data } = await supabase
    .from('chat_goals')
    .update({ criteria: applied.criteria, updated_at: new Date().toISOString() })
    .eq('id', goal.id)
    .select('*')
    .maybeSingle();
  const next = data ? rowToGoal(data) : { ...goal, criteria: applied.criteria };
    // Un aggiornamento che non muove niente (un `done` su un criterio già chiuso) non è un evento:
    // riempirebbe il diario di righe che dicono «non è successo nulla».
  const moved =
    applied.closed > 0 || (update.add?.length ?? 0) > 0 || (update.drop?.length ?? 0) > 0;
  if (moved && goal.brand_id) {
    trackGoalEvent(supabase, {
      kind: 'updated',
      goalId: goal.id,
      brandId: goal.brand_id,
      threadId: goal.thread_id,
      actor: goal.source,
      criteria: next.criteria,
      closedNow: applied.closed,
      laps: goal.laps,
      detail: {
        ...(update.drop?.length ? { dropped: update.drop.length } : {}),
        ...(update.add?.length ? { added: update.add.length } : {}),
        ...(applied.unknown.length ? { not_found: applied.unknown.length } : {}),
        ...(update.note ? { note: update.note } : {})
      }
    });
  }
  return { goal: next, closed: applied.closed, unknown: applied.unknown };
}

/**
 * I tool andati a buon fine su questo thread DA QUANDO l'obiettivo è aperto: il lavoro e la spunta
 * non cadono per forza nello stesso turno (si renderizza al primo giro e si marca al secondo), e
 * senza questa lettura il criterio verrebbe riaperto ogni volta.
 *
 * ponytail: si legge `chat_messages` invece di tenere un registro per obiettivo — `tool_calls` è già
 * quel registro. Se i thread diventassero lunghissimi, la strada è un indice su (thread_id,
 * created_at), non una tabella nuova.
 */
export async function toolsProvenSinceGoal(
  supabase: SupabaseClient,
  goal: ChatGoal
): Promise<string[]> {
  const { data } = await supabase
    .from('chat_messages')
    .select('tool_calls')
    .eq('thread_id', goal.thread_id)
    .gte('created_at', goal.created_at)
    .not('tool_calls', 'is', null);
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ tool_calls: unknown }>) {
    if (!Array.isArray(row.tool_calls)) continue;
    for (const p of row.tool_calls as StepPart[]) {
      if (p?.type !== 'tool-call' || !p.toolName) continue;
      if (p.output === undefined || outputSaysError(p.output)) continue;
      out.add(p.toolName);
    }
  }
  return [...out];
}

/** Riporta ad `open` criteri già marcati, con la riga che dice perché. */
export async function reopenCriteria(
  supabase: SupabaseClient,
  goal: ChatGoal,
  ids: string[],
  note: string
): Promise<ChatGoal> {
  const wanted = new Set(ids);
  const criteria: GoalCriterion[] = goal.criteria.map((c) =>
    wanted.has(c.id) ? { ...c, status: 'open', note: note.slice(0, MAX_CRITERION_CHARS) } : c
  );
  const { data } = await supabase
    .from('chat_goals')
    .update({ criteria, updated_at: new Date().toISOString() })
    .eq('id', goal.id)
    .select('*')
    .maybeSingle();
  return data ? rowToGoal(data) : { ...goal, criteria };
}

/** Chiude l'obiettivo. Il rifiuto di chiudere un `met` con criteri aperti sta nel tool, non qui. */
export async function closeGoal(
  supabase: SupabaseClient,
  goalId: string,
  outcome: Exclude<ChatGoalStatus, 'open'>,
  note?: string | null
): Promise<ChatGoal | null> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('chat_goals')
    .update({
      status: outcome,
      closing_note: note ? String(note).slice(0, 500) : null,
      updated_at: now,
      closed_at: now
    })
    .eq('id', goalId)
    .eq('status', 'open')
    .select('*')
    .maybeSingle();
  if (!data) return null;
  const closed = rowToGoal(data);
  trackGoalEvent(supabase, {
    kind: 'closed',
    goalId: closed.id,
    brandId: (data.brand_id as string) ?? '',
    userId: (data.user_id as string) ?? null,
    threadId: closed.thread_id,
    reason: outcome,
    actor: closed.source,
    criteria: closed.criteria,
    laps: closed.laps,
    detail: note ? { note: String(note).slice(0, 500) } : undefined
  });
  return closed;
}

/** Un giro consumato. Chiamato quando il turno rimette in coda il lavoro dell'obiettivo. */
export async function recordGoalLap(supabase: SupabaseClient, goal: ChatGoal): Promise<void> {
  await supabase
    .from('chat_goals')
    .update({ laps: goal.laps + 1, updated_at: new Date().toISOString() })
    .eq('id', goal.id)
    .eq('status', 'open');
}

export type GoalSettlement = {
  /** I criteri chiusi in QUESTO turno, con le loro parole: è ciò che l'avviso nomina. */
  closedNow: GoalCriterion[];
  /** Lo stato dell'obiettivo DOPO il turno — quello che l'agente ha lasciato, non quello che aveva. */
  goal: ChatGoal | null;
  decision: GoalContinuationDecision;
  /** La riga da appendere al transcript, se c'è qualcosa di onesto da dire. */
  notice: string | null;
  /** Con cosa far ripartire la ripresa, quando la ripresa è dell'obiettivo. */
  continuationPrompt: string | null;
};

/**
 * Cosa succede all'obiettivo quando il turno finisce. Un posto solo, perché i motori sono due (la
 * route che streamma e il worker della coda) e devono comportarsi identici.
 *
 * Aggiorna lo stato (giro consumato, chiusura automatica, resa) e prepara le parole, ma NON mette
 * niente in coda: quella la chiama il motore, che è l'unico a sapere origin, tier e profondità e a
 * poter decidere l'ordine fra salvare il messaggio e rimettere in fila il lavoro.
 */
export async function settleGoalForTurn(
  supabase: SupabaseClient,
  opts: {
    threadId: string;
    /** L'obiettivo com'era all'INIZIO del turno: serve a misurare l'avanzamento, non lo stato. */
    goalAtStart: ChatGoal | null;
    timeRanOut: boolean;
    loopStalled: boolean;
    aborted: boolean;
    failed: boolean;
    /** Il turno si è fermato su una domanda all'utente: nessuna ripresa, nessun giro consumato. */
    awaitingAnswer?: boolean;
    depth: number;
    maxDepth: number;
    locale: string;
    /** Il testo che l'utente leggerà: è lì che l'agente scrive «c1 chiuso» invece di chiamarlo. */
    turnText?: string | null;
      /**
       * I tool NON-goal che in questo turno hanno RESTITUITO qualcosa senza `error`. Sostituisce un
       * booleano `didWork` che contava anche le chiamate fallite.
       */
    succeededTools?: string[];
    /**
     * I nomi dei tool che questo agente poteva chiamare (`Object.keys(tools)`): servono a capire
     * quando un criterio ne NOMINA uno, e quindi quando la sua chiusura è verificabile.
     */
    knownTools?: readonly string[];
      /**
       * I tool NON-lettura rifiutati in questo turno e mai recuperati: chi spunta un criterio nel giro
       * in cui lo strumento gli ha detto di no lo ha spuntato sulla fiducia. È l'unica ancora che non
       * passa dal testo del criterio.
       */
    refusedTools?: string[];
  }
): Promise<GoalSettlement> {
  let goal = await loadOpenGoal(supabase, opts.threadId).catch(() => null);
  const succeeded = opts.succeededTools ?? [];
  // Non «ha chiamato qualcosa»: «ha lasciato qualcosa». Un turno di sole letture non chiude
  // criteri a parole — vedi leftATrace.
  const didWork = leftATrace(succeeded);
  const knownTools = opts.knownTools ?? [];

    // La prova di provenienza costa una lettura, quindi si fa solo quando serve: prima questo turno,
    // e solo se un criterio resta senza prova si guardano i turni precedenti dell'obiettivo
    // (renderizzare al primo giro e marcare al secondo è legittimo).
  let provenAll: Set<string> | null = null;
  const stillUnproven = async (cands: GoalCriterion[]): Promise<GoalCriterion[]> => {
    const here = unprovenCriteria(cands, new Set(succeeded), knownTools);
    if (!here.length || !goal) return [];
    if (!provenAll) {
      const past = await toolsProvenSinceGoal(supabase, goal).catch(() => []);
      provenAll = new Set([...succeeded, ...past]);
    }
    return unprovenCriteria(here, provenAll, knownTools);
  };

    // Chiusure raccontate e mai registrate: se il turno ha lavorato il difetto è la registrazione e
    // non il lavoro, quindi si registra qui con la nota che dice da dove arriva. Se NON ha lavorato la
    // frase non vale niente e i criteri restano aperti.
  if (goal && didWork && opts.turnText) {
    const declared = declaredClosures(opts.turnText, goal.criteria);
    const blocked = new Set(
      (
        await stillUnproven(
          declared.map((id) => findCriterion(goal!.criteria, id)).filter(Boolean) as GoalCriterion[]
        )
      ).map((c) => c.id)
    );
    const proven = declared.filter((id) => !blocked.has(id));
    if (proven.length) {
      const applied = await updateGoalCriteria(supabase, goal, {
        done: proven,
        note: bilingualNoticeLocale(opts.locale) === 'en' ? PROSE_CLOSE_NOTE.en : PROSE_CLOSE_NOTE.it
      }).catch(() => null);
      if (applied) goal = applied.goal;
    }
  }

    // Spunte senza lavoro dietro: un criterio marcato in questo turno che nomina un tool mai riuscito
    // torna aperto. Vale anche per `update_goal` chiamato dal modello — è l'unico punto del giro in cui
    // si sa cosa ha davvero restituito ogni tool.
  if (goal) {
    const marked = closedSince(opts.goalAtStart?.criteria ?? [], goal.criteria).filter(
      (c) => c.status === 'done'
    );
    const refused = opts.refusedTools ?? [];
      // Spuntato nel giro in cui lo strumento ha detto di no: torna aperto qualunque cosa dica il
      // testo del criterio. È l'unico caso che `unprovenCriteria` non può vedere.
    const bad = refused.length ? marked : await stillUnproven(marked);
    if (bad.length) {
      goal = await reopenCriteria(
        supabase,
        goal,
        bad.map((c) => c.id),
        bilingualNoticeLocale(opts.locale) === 'en'
          ? refused.length
            ? `Reopened: ticked off in a turn where ${refused.join(', ')} was refused and never went through.`
            : 'Reopened: this turn never got a successful result from the tool this criterion names.'
          : refused.length
            ? `Riaperto: spuntato in un turno in cui ${refused.join(', ')} è stato rifiutato e non è mai andato a buon fine.`
            : 'Riaperto: in questo turno il tool nominato dal criterio non ha mai restituito un risultato buono.'
      ).catch(() => goal as ChatGoal);
    }
  }

    // Misurato DOPO la registrazione delle chiusure raccontate, così un criterio marcato qui conta
    // come avanzamento esattamente come uno marcato dal modello: è lo stesso lavoro.
  const closedNow = goal ? closedSince(opts.goalAtStart?.criteria ?? [], goal.criteria) : [];
  const closedThisTurn = closedNow.length;
  const decision = decideGoalContinuation({
    goal,
    closedThisTurn,
    timeRanOut: opts.timeRanOut,
    loopStalled: opts.loopStalled,
    aborted: opts.aborted,
    failed: opts.failed,
    awaitingAnswer: opts.awaitingAnswer ?? false,
    depth: opts.depth,
    maxDepth: opts.maxDepth
  });

    // Un obiettivo raggiunto che resta 'open' rientrerebbe in ogni prompt successivo dicendo «il
    // lavoro non è finito» su un lavoro finito: il modo più sicuro di far ripartire un agente su nulla.
  if (goal && decision.reason === 'met') {
      /**
       * La nota dice due cose che prima taceva — che l'ha scritta il sistema, e da dove arrivano le
       * spunte. Un «every criterion was met» che l'agente non ha mai scritto, su criteri chiusi dalla
       * scorciatoia della prosa, è il sistema che mette una bugia in bocca all'agente: nessuno deve
       * affermare il falso, basta non smentire una frase nostra.
       */
    const fromProse = proseClosedCount(goal.criteria);
    const how = (en: boolean) =>
      fromProse
        ? en
          ? ` — ${fromProse} of ${goal.criteria.length} were ticked off from the turn text, not by a tool that returned`
          : ` — ${fromProse} su ${goal.criteria.length} spuntati dal testo del turno, non da uno strumento che ha restituito`
        : '';
    await closeGoal(
      supabase,
      goal.id,
      'met',
      bilingualNoticeLocale(opts.locale) === 'en'
        ? `Closed by the system, not by the agent: every criterion is ticked off${how(true)}.`
        : `Chiuso dal sistema, non dall'agente: tutti i criteri risultano spuntati${how(false)}.`
    ).catch(() => null);
  }

  // La catena si ferma con lavoro ancora aperto. L'obiettivo torna alla persona: resta scritto cosa
  // manca, e il prossimo turno non riparte da solo su un lavoro che non stava avanzando.
  if (goal && decision.handBack) {
    await closeGoal(
      supabase,
      goal.id,
      'handed_back',
      bilingualNoticeLocale(opts.locale) === 'en'
        ? `Stopped after ${goal.laps} automatic pass(es): ${openCriteria(goal.criteria).length} criterion(s) still open.`
        : `Fermato dopo ${goal.laps} ripresa/e automatiche: ${openCriteria(goal.criteria).length} criteri ancora aperti.`
    ).catch(() => null);
  }

    // Un giro è un giro qualunque sia la ragione: se non contasse anche la ripresa per tempo scaduto,
    // un lavoro che finisce il tempo a ogni giro non incontrerebbe mai GOAL_MAX_LAPS.
  if (goal && decision.continue && !goalIsMet(goal.criteria)) {
    await recordGoalLap(supabase, goal).catch(() => {});
  }

  return {
    goal,
    decision,
    closedNow,
    notice: goalTurnNotice(goal, decision, opts.locale, decision.continue, closedNow),
    continuationPrompt:
      goal && decision.continue && !goalIsMet(goal.criteria)
        ? goalContinuationPrompt(goal, opts.locale, {
            emptyLap: decision.reason === 'no_progress_retry'
          })
        : null
  };
}

/**
 * L'evento di fine turno, scritto DOPO che si sa se la ripresa è partita davvero. Fuori da
 * `settleGoalForTurn` per la stessa ragione della coda: chi decide non sa ancora se l'accodamento
 * riuscirà, e un diario che registra le intenzioni risponde alla domanda sbagliata.
 */
export function trackGoalSettlement(
  supabase: SupabaseClient,
  settled: GoalSettlement,
  ctx: { brandId: string; userId?: string | null; threadId: string; depth: number; queued: boolean }
): void {
  // Niente obiettivo, niente riga: il diario è degli obiettivi, non dei turni.
  if (!settled.goal) return;
  trackGoalEvent(supabase, {
    kind: 'settled',
    goalId: settled.goal.id,
    brandId: ctx.brandId,
    userId: ctx.userId,
    threadId: ctx.threadId,
    reason: settled.decision.reason,
    actor: settled.goal.source,
    criteria: settled.goal.criteria,
    laps: settled.goal.laps,
    depth: ctx.depth,
    queued: ctx.queued,
    detail: settled.decision.handBack ? { handed_back: true } : undefined
  });
}
