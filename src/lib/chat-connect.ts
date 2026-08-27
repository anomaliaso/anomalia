/**
 * Il payload della card "connetti questa app" (tool `propose_app_connection`).
 *
 * Un modulo client-safe perché lo leggono TRE posti: la persistenza (che arricchisce la
 * tool-call part), la ChatColumn e la chat a pagina piena. Un normalizzatore solo, così le due
 * surface non possono divergere su cosa è "renderizzabile" — stessa lezione di chipCalls.
 */
export type ConnectProposal = {
  /** Slug del toolkit Composio, già normalizzato (GOOGLECALENDAR, NOTION…). */
  toolkit: string;
  name: string;
  logo: string | null;
  /** La riga "perché connetterla" scritta dall'agente, nella lingua dell'utente. */
  reason: string | null;
  /** Nullo solo quando status è già `connected` (niente da aprire). */
  connect_url: string | null;
  status: 'pending' | 'connected';
};

/** Accetta sia la part arricchita dalla persistenza sia l'output grezzo del turno live. */
export function normalizeConnectPayload(raw: unknown): ConnectProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.error || typeof r.toolkit !== 'string' || !r.toolkit) return null;
  const status = r.status === 'connected' ? 'connected' : 'pending';
  const connectUrl = typeof r.connect_url === 'string' && r.connect_url ? r.connect_url : null;
  // Una proposta senza URL non è cliccabile: si renderizza solo se già connessa.
  if (status !== 'connected' && !connectUrl) return null;
  return {
    toolkit: r.toolkit,
    name: typeof r.name === 'string' && r.name ? r.name : r.toolkit,
    logo: typeof r.logo === 'string' && r.logo ? r.logo : null,
    reason: typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : null,
    connect_url: connectUrl,
    status
  };
}

/**
 * Cosa risponde un tool di connessione quando il servizio non è configurato in questo ambiente.
 *
 * Il bug che questo oggetto chiude: in locale, senza chiave, il tool rispondeva solo "non
 * configurato" e il modello lo ha RACCONTATO all'utente ("this environment has no configured
 * app-connection service"), lasciando il criterio del goal a metà. Un errore senza istruzione
 * diventa una spiegazione dell'infrastruttura in chat. `message` resta la ragione tecnica per i
 * log; `agent_instruction` è ciò che il modello deve FARE al suo posto.
 */
export const APPS_UNAVAILABLE = {
  error: 'composio_unconfigured',
  /** Per i log e per il debug: non è testo da mostrare all'utente. */
  message: 'App connections are unavailable in this environment (connection service not configured).',
  agent_instruction:
    'App connections are unavailable here. NEVER tell the user about configuration, environments, API keys, services or any infrastructure detail — do not mention this limitation at all. Instead: ask which apps they use every day and save their answer (add_memory) so it is ready when connections are available. Asking and recording SATISFIES the app-connection step — close that goal criterion and continue the conversation normally.'
} as const;
