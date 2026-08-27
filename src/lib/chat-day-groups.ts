/**
 * I divisori del transcript: la riga col giorno fra due bolle, e il confine dei non letti.
 *
 * Qui e non dentro le due chat perché le superfici sono due, e un raggruppamento calcolato due
 * volte prima o poi diverge. Modulo puro: nessuno store, nessun DOM, `now` iniettabile.
 *
 * Fuso orario: quello del browser, come `threadTimeLabel` in sidebar. `brands.timezone` serve a
 * programmare le pubblicazioni; usarlo qui sarebbe una terza convenzione, e quella sbagliata.
 */

/** Il minimo che serve per raggruppare: ogni superficie ne passa i suoi messaggi così com'è. */
export type TranscriptMsg = {
  role?: string;
  content?: string;
  created_at?: string | null;
};

const DAY_MS = 86_400_000;

/** Mezzanotte locale in ms: due istanti sono "lo stesso giorno" se qui danno lo stesso numero. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DayLabelOpts = {
  locale?: string | null;
  /** Adesso. Parametro e non `new Date()` fisso: è l'unico modo di testare "oggi" e "ieri". */
  now?: Date;
  /** `$_` di svelte-i18n, passato come callback — stessa convenzione di `threadIdentity`. */
  t: (key: string) => string;
};

/**
 * "Oggi 12:56", "Ieri 09:14", "lunedì 15:20", "12 mar 09:00" — le stesse fasce di
 * `threadTimeLabel` in sidebar, con l'ora accodata. Giorni e mesi li scrive `Intl` nella lingua
 * dell'app, quindi il catalogo porta solo "Oggi" e "Ieri".
 */
export function dayDividerLabel(iso: string | null | undefined, opts: DayLabelOpts): string {
  const d = parse(iso);
  if (!d) return '';
  const loc = opts.locale || 'en';
  const now = opts.now ?? new Date();
  const time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  const today = startOfDay(now);
  const day = startOfDay(d);
  // `>=` e non `===`: un orologio avanti di qualche minuto scrive nel futuro, e quel messaggio è
  // comunque "oggi" per chi lo legge.
  if (day >= today) return `${opts.t('chat.groupToday')} ${time}`;
  if (day >= today - DAY_MS) return `${opts.t('chat.groupYesterday')} ${time}`;
  if (day >= today - 6 * DAY_MS) return `${d.toLocaleDateString(loc, { weekday: 'long' })} ${time}`;
  // Anno diverso: senza, "12 mar" dell'anno scorso e "12 mar" di quest'anno sono la stessa riga.
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(loc, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  });
  return `${date} ${time}`;
}

/**
 * `{ indice → etichetta }`: dove cambia il giorno, più il primo messaggio del transcript.
 * Una passata sola e non una funzione per riga: cercare ogni volta il messaggio datato precedente
 * sarebbe O(n²) dentro un `{#each}`.
 * I messaggi senza `created_at` (la bolla ottimistica) non aprono né chiudono un giorno.
 */
export function dayDividers(messages: TranscriptMsg[], opts: DayLabelOpts): Record<number, string> {
  const out: Record<number, string> = {};
  let prevDay: number | null = null;
  for (let i = 0; i < messages.length; i++) {
    const d = parse(messages[i]?.created_at);
    if (!d) continue;
    const day = startOfDay(d);
    if (prevDay === null || day !== prevDay) out[i] = dayDividerLabel(messages[i].created_at, opts);
    prevDay = day;
  }
  return out;
}

/**
 * Da quanto una risposta deve stare lì prima di valere un divisore. Sotto questa età non è roba
 * che l'utente si è perso: è la risposta appena comparsa mentre guardava, o quella di due minuti
 * fa che ha già letto e sta solo ricaricando.
 */
export const UNREAD_MIN_AGE_MS = 5 * 60_000;

/**
 * Il primo messaggio non letto, o -1. Stesso identico criterio del badge in sidebar
 * (`loadUnreadCounts`): risposte dell'agente con del testo, scritte dopo `last_read_at`. Non un
 * secondo criterio, o la sidebar direbbe 3 e la chat ne segnerebbe 5. Senza segnalibro non c'è
 * confine e non c'è divisore — lo stesso degrado silenzioso del pallino.
 *
 * `openedAt` è il momento in cui l'utente è entrato nel thread, CONGELATO: si legge una volta e
 * non si aggiorna finché si resta lì. Da quel numero discendono due cose che il segnalibro da
 * solo non sa dire — una risposta arrivata dopo l'apertura è per definizione più recente della
 * soglia, quindi non può diventare il confine per quanto si resti sul thread; e una arrivata
 * poco prima è stata vista, quindi ricaricare la pagina non fa comparire un divisore su ciò che
 * si stava già leggendo. Senza apertura (0) non c'è confine: nessun divisore.
 *
 * ponytail: la soglia confronta un orologio del browser con un `created_at` del database. Un
 * client fuori di più di UNREAD_MIN_AGE_MS sbaglia il divisore — cosmetico, e non vale il giro
 * di un `now` del server attraverso due endpoint.
 */
export function firstUnreadIndex(
  messages: TranscriptMsg[],
  lastReadAt: string | null | undefined,
  openedAt: number = Date.now()
): number {
  if (!lastReadAt) return -1;
  const cut = Date.parse(lastReadAt);
  if (Number.isNaN(cut)) return -1;
  const settled = openedAt - UNREAD_MIN_AGE_MS;
  return messages.findIndex((m) => {
    if (m?.role !== 'assistant' || !m.content) return false;
    const t = Date.parse(m.created_at ?? '');
    return !Number.isNaN(t) && t > cut && t <= settled;
  });
}
