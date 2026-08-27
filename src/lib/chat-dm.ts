/**
 * DM fra agenti — il marcatore sul thread, e niente altro.
 *
 * Un DM è un `chat_threads` normale la cui colonna `room_agents` porta un OGGETTO invece
 * dell'array delle room: `{ dm: [a, b], names: {…} }`. Non è estetica: `parseRoomAgents` accetta
 * solo array, quindi per tutto il codice delle room un DM "non è una stanza" senza un solo if in
 * più e senza migration nuova.
 *
 * Le chiavi membro sono quelle delle room più `anomalia`: il generalista, che nelle room non esiste
 * ma nei DM è chi più spesso scrive agli specialisti.
 *
 * `names` è scritto UNA volta alla creazione: permette a sidebar e transcript di etichettare le
 * battute senza una query sui custom agent a ogni render.
 */

export type DmMarker = { dm: [string, string]; names?: Record<string, string> };

/**
 * Passi del turno di risposta in un DM: una consulenza operativa (leggere, fare, riferire), non una
 * produzione da 75 step — il tetto tiene il costo nell'ordine di un consulto.
 */
export const DM_REPLY_STEP_CAP = 15;

/** La coppia di membri se il thread è un DM, altrimenti null. Tollerante come parseRoomAgents. */
export function dmAgents(raw: unknown): [string, string] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const dm = (raw as { dm?: unknown }).dm;
  if (!Array.isArray(dm) || dm.length !== 2) return null;
  const [a, b] = [String(dm[0] ?? '').trim(), String(dm[1] ?? '').trim()];
  if (!a || !b || a === b) return null;
  return [a, b];
}

/** I nomi visualizzabili dei membri, per etichettare le battute. Vuoto se il marcatore non li ha. */
export function dmNames(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const names = (raw as { names?: unknown }).names;
  if (!names || typeof names !== 'object' || Array.isArray(names)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(names as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/** Il marcatore da scrivere alla creazione. La coppia è ordinata: (A,B) e (B,A) sono LO stesso DM. */
export function dmMarker(a: { key: string; name: string }, b: { key: string; name: string }): DmMarker {
  const pair = [a.key, b.key].sort() as [string, string];
  return { dm: pair, names: { [a.key]: a.name, [b.key]: b.name } };
}

/**
 * Il blocco di sistema del turno di risposta in un DM. Sta qui e non nel tool perché lo monta IL
 * RUNNER (queue.ts) leggendo il marker del thread: così ogni turno su un thread DM nasce DM, anche
 * uno accodato senza params. Va IN TESTA al system prompt: in coda il modello vedeva "user: ciao"
 * sotto un intero prompt di brand e salutava l'utente per nome, ignorando il paragrafo finale.
 */
export function dmBrief(meName: string, otherName: string, locale: string): string {
  return locale === 'en'
    ? `## PRIVATE AGENT CHAT — READ FIRST\nThis thread is NOT a conversation with the end user. It is a private thread between two AI agents of this brand: you (**${meName}**) and **${otherName}**. Every "user" message here was written by ${otherName} — an AI agent, never a human. Reply TO ${otherName}: concise and operational — facts, decisions, blockers, next steps. NEVER greet or address the user or the brand, never introduce yourself, no customer-facing prose. The user can read this thread but cannot write in it. If the request needs an action of your craft, do it with your tools and report the outcome. Your reply text IS your message to ${otherName} — do not use message_agent here.`
    : `## CHAT PRIVATA TRA AGENTI — LEGGI PRIMA\nQuesto thread NON è una conversazione con l'utente finale. È un thread privato fra due agenti AI di questo brand: tu (**${meName}**) e **${otherName}**. Ogni messaggio "user" qui l'ha scritto ${otherName} — un agente AI, mai una persona. Rispondi A ${otherName}: conciso e operativo — fatti, decisioni, blocchi, prossimi passi. MAI salutare o rivolgerti all'utente o al brand, mai presentarti, niente prosa da cliente. L'utente può leggere questo thread ma non scriverci. Se serve un'azione del tuo mestiere, falla con i tuoi tool e riferisci l'esito. Il testo della tua risposta È il messaggio per ${otherName} — non usare message_agent qui.`;
}

/**
 * Il messaggio che riporta la risposta di un DM nel contesto dell'iniziatore (await:true). È una
 * riga USER nel thread di partenza: se il turno gira ancora la assorbe la mailbox a un confine di
 * step, altrimenti diventa un turno normale appena il drain la pesca.
 */
export function dmReplyBackMessage(fromName: string, text: string, locale: string): string {
  const summary = text.trim().slice(0, 800);
  return locale === 'en'
    ? `📩 Reply from ${fromName} (private agent chat): ${summary}`
    : `📩 Risposta di ${fromName} (chat privata tra agenti): ${summary}`;
}
