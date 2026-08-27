/**
 * GLI STATI DI UNA RIGA `chat_jobs`, e — la parte che conta — CHI la sta eseguendo.
 *
 * Erano stringhe nude in ~150 punti, e la distinzione piu` importante non era scritta da nessuna
 * parte: `pending` e `running` non descrivono l'avanzamento del lavoro, descrivono **di chi e` il
 * lavoro**.
 *
 *   pending  → nessuno la sta eseguendo. E` un'OFFERTA: il drain la reclama e la fa girare.
 *   running  → qualcuno la sta gia` eseguendo, e il drain deve tenerne le mani fuori.
 *
 * Da qui la trappola che ha morso il 26/8: `insertDesignerJob` scrive `running` perche` la pagina
 * inserisce la riga e poi esegue il turno IN PROPRIO, usandola solo come specchio
 * dell'avanzamento. Chi invece vuole che il lavoro lo faccia il drain deve scrivere `pending`,
 * altrimenti accoda una riga che nessuno raccogliera` MAI — un lavoro promesso e mai eseguito,
 * che dal fuori si legge come una coda ferma.
 *
 * Client-safe di proposito: la riga «background job» nella chat legge gli stessi stati del server,
 * e due elenchi dello stesso concetto divergono al primo stato aggiunto.
 */
export const CHAT_JOB_STATUS = {
	/** Nessuno la esegue: il drain la reclama. */
	pending: 'pending',
	/** Qualcuno la sta eseguendo — il drain non la tocca. */
	running: 'running',
	/** Finita bene. */
	done: 'done',
	/** Finita male: `error` dice perche`. */
	failed: 'failed',
	/** Fermata da una persona prima della fine. */
	cancelled: 'cancelled'
} as const;

export type ChatJobStatus = (typeof CHAT_JOB_STATUS)[keyof typeof CHAT_JOB_STATUS];

/** Gli stati in cui il lavoro e` ancora in corso — l'unico raggruppamento che la UI usa davvero. */
const LIVE: readonly ChatJobStatus[] = [CHAT_JOB_STATUS.pending, CHAT_JOB_STATUS.running];

export function isChatJobLive(status: unknown): boolean {
	return LIVE.includes(status as ChatJobStatus);
}

/** Finita, comunque sia andata: la UI smette di mostrarla come viva e l'agente smette di attendere. */
export function isChatJobSettled(status: unknown): boolean {
	return (
		status === CHAT_JOB_STATUS.done ||
		status === CHAT_JOB_STATUS.failed ||
		status === CHAT_JOB_STATUS.cancelled
	);
}
