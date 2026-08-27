/**
 * DA UNA LISTA DI DESTINATARI ALL'AGENTE DEL THREAD — una regola sola, per tutte le volte che
 * il composer deve rispondere alla domanda "chi risponde a questo messaggio?".
 *
 * Viveva dentro `applyRecipients` in ChatColumn, e il ramo "nessun thread" dello stesso file la
 * indovinava con una costante: al rimontaggio della Panoramica l'effetto che ripristina il campo
 * "A" girava per primo e metteva l'agente giusto, poi il reset gli riscriveva sopra il default.
 * I chip mostravano Motion, `createThread` riceveva Content, e nessuno dei due schermi mentiva
 * abbastanza da far sospettare l'altro.
 *
 * Estrarla qui non e' un'astrazione: e' toglierle il secondo esemplare. Ed e' pura, quindi la
 * regola si prova senza montare un componente.
 */

/** Il minimo di un agente custom che serve per capire di che mestiere e'. */
export type RecipientCustomAgent = { id: string; agent: string | null };

export type RecipientsAgent = {
  /** Lo specialista del thread. `null` = i destinatari non lo dicono: chi chiama tenga il suo. */
  agent: string | null;
  /** La persona custom legata al thread, se il destinatario e' un agente del brand. */
  customAgentId: string | null;
  /** I membri della stanza (>= 2 destinatari), o `[]` se non e' una stanza. */
  room: string[];
};

const CUSTOM = 'custom:';

export function recipientsAgent(
  keys: string[],
  customAgents: RecipientCustomAgent[],
  opts: {
    /** Con chi parte una conversazione senza destinatari scelti. */
    fallback: string;
    /** Il generalista: mai il volto di una stanza se c'e' un mestiere vero fra i membri. */
    generalist: string;
  }
): RecipientsAgent {
  // Due o piu': e' una stanza. `agent` e' solo la RICADUTA se il server la rifiuta (feature
  // spenta, chiavi non riconosciute), e dev'essere lo specialista scelto — mai il generalista,
  // o una scelta [Anomalia, Content] si ridurrebbe ad Anomalia buttando via Content in silenzio.
  if (keys.length >= 2) {
    const first =
      keys.find((k) => !k.startsWith(CUSTOM) && k !== opts.generalist) ??
      keys.find((k) => !k.startsWith(CUSTOM));
    return { agent: first ?? null, customAgentId: null, room: keys };
  }

  const key = keys[0] ?? opts.fallback;
  if (key.startsWith(CUSTOM)) {
    const found = customAgents.find((c) => c.id === key.slice(CUSTOM.length));
    // Come il picker: un agente custom porta il thread sul mestiere per cui e' stato scritto.
    // Se la lista non e' ancora atterrata, `null` dice a chi chiama di non toccare niente.
    return { agent: found?.agent ?? null, customAgentId: found?.id ?? null, room: [] };
  }
  return { agent: key, customAgentId: null, room: [] };
}
