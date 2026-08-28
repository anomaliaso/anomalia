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
    ? `## PRIVATE AGENT CHAT — READ FIRST\nThis thread is NOT a conversation with the end user. It is a private thread between two AI agents of this brand: you (**${meName}**) and **${otherName}**. Every "user" message here was written by ${otherName} — an AI agent, never a human. Reply TO ${otherName}: concise and operational — facts, decisions, blockers, next steps. NEVER greet or address the user or the brand, never introduce yourself, no customer-facing prose. The user can read this thread but cannot write in it.\nIf the request needs the PERSON — a decision, an approval, a question only they can answer, a result to hand over — OPEN YOUR OWN USER SESSION: call open_session_with_user with your visible opening line to them. It opens your own user thread (the one with your face in the sidebar), writes your line, and puts you to work there. Then tell ${otherName} in ONE line that you did, so they can point the user to it. Do not do the user-facing work here and do not write your answer as if the user could reply.\nIf the request needs an action of your craft, do it with your tools and report the outcome. Your reply text IS your message to ${otherName} — do not use message_agent here.`
    : `## CHAT PRIVATA TRA AGENTI — LEGGI PRIMA\nQuesto thread NON è una conversazione con l'utente finale. È un thread privato fra due agenti AI di questo brand: tu (**${meName}**) e **${otherName}**. Ogni messaggio "user" qui l'ha scritto ${otherName} — un agente AI, mai una persona. Rispondi A ${otherName}: conciso e operativo — fatti, decisioni, blocchi, prossimi passi. MAI salutare o rivolgerti all'utente o al brand, mai presentarti, niente prosa da cliente. L'utente può leggere questo thread ma non scriverci.\nSe la richiesta ha bisogno della PERSONA — una scelta, un'approvazione, una domanda che solo lei può rispondere, un risultato da consegnare — APRI LA TUA SESSIONE UTENTE: chiama open_session_with_user con la tua riga di apertura rivolta a lei. Apre il tuo thread utente (quello con la tua faccia in sidebar), scrive la tua riga e ti mette al lavoro lì. Poi di' a ${otherName} in UNA riga che l'hai fatto, così può indirizzare l'utente lì. Non fare il lavoro per l'utente qui e non scrivere la tua risposta come se l'utente potesse rispondere.\nSe serve un'azione del tuo mestiere, falla con i tuoi tool e riferisci l'esito. Il testo della tua risposta È il messaggio per ${otherName} — non usare message_agent qui.`;
}

/**
 * Vecchia riga USER che versava la risposta del DM nel thread con l'utente. Non si scrive più:
 * l'interazione è la chip "N messaggi con X". Resta il detector, perché i thread già salvati
 * non devono farla rivedere.
 */
export function dmReplyBackMessage(fromName: string, text: string, locale: string): string {
  const summary = text.trim().slice(0, 800);
  return locale === 'en'
    ? `📩 Reply from ${fromName} (private agent chat): ${summary}`
    : `📩 Risposta di ${fromName} (chat privata tra agenti): ${summary}`;
}

export function isDmReplyBackMessage(text: unknown): boolean {
  if (typeof text !== 'string' || !text.startsWith('📩 ')) return false;
  return (
    text.includes('(chat privata tra agenti):') || text.includes('(private agent chat):')
  );
}

/** Un invio `message_agent` visibile come chip: thread privato + nome del destinatario. */
export type DmSend = { threadId: string; to: string; name: string };

function parseJsonObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    const v = JSON.parse(t) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function recordFromContentParts(parts: unknown[]): Record<string, unknown> | null {
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (typeof p.text === 'string' && (p.type === 'text' || p.type === undefined)) {
      const parsed = parseJsonObject(p.text);
      if (parsed) return parsed;
    }
  }
  return null;
}

/**
 * L'output di `message_agent` dopo il kit: oggetto piano, wrapper SDK `{type,value}`, o
 * `ToolResult` `{ content: [{ type:'text', text: JSON }] }`. Senza srotolare, ChatDmChip non
 * vede `dm_thread_id` e la chip sparisce.
 */
function unwrapDmRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') return parseJsonObject(raw);
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw)) return recordFromContentParts(raw);
  const rec = raw as Record<string, unknown>;
  if ('type' in rec && 'value' in rec && rec.value !== undefined) {
    const inner = unwrapDmRecord(rec.value);
    if (inner) return inner;
  }
  if (Array.isArray(rec.content)) {
    const fromParts = recordFromContentParts(rec.content);
    if (fromParts) return fromParts;
  }
  return rec;
}

function sendFrom(raw: unknown): DmSend | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const threadId = typeof r.dm_thread_id === 'string' ? r.dm_thread_id : typeof r.threadId === 'string' ? r.threadId : '';
  if (!threadId) return null;
  return {
    threadId,
    to: typeof r.to === 'string' ? r.to : '',
    name: typeof r.to_name === 'string' && r.to_name ? r.to_name : typeof r.name === 'string' && r.name ? r.name : 'Agent'
  };
}

/** Gli invii da una tool-call: campo hoisted `dmSends` (compattazione) o output srotolato. */
export function dmSendsFromCall(call: { output?: unknown; dmSends?: unknown }): DmSend[] {
  if (Array.isArray(call.dmSends)) {
    const hoisted = call.dmSends.map(sendFrom).filter((s): s is DmSend => !!s);
    if (hoisted.length) return hoisted;
  }
  return dmSendsFromOutput(call.output);
}

export function dmSendsFromOutput(raw: unknown): DmSend[] {
  const rec = unwrapDmRecord(raw);
  if (!rec) return [];
  if (Array.isArray(rec.sends)) {
    const list = rec.sends.map(sendFrom).filter((s): s is DmSend => !!s);
    if (list.length) return list;
  }
  const one = sendFrom(rec);
  return one ? [one] : [];
}
