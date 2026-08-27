/**
 * Il rientro in conversazione di un tool job che ha girato FUORI dal turno.
 *
 * Il turno che avvia un lavoro lungo si chiude subito (vedi `startLongToolJob` in tools.ts): dice
 * una riga e spegne il processo. Senza questo modulo la conversazione morirebbe lì — il job
 * finirebbe in silenzio e l'utente resterebbe con "avviato" e mai un esito.
 *
 * Non è un meccanismo nuovo: è ESATTAMENTE quello dei DM fra agenti (`reply_to_thread` in
 * queue.ts). La risposta rientra come turno accodato sul thread di partenza, e se un turno è
 * ancora vivo la assorbe la mailbox a un confine di step (`claimQueuedFollowUps`). In entrambi i
 * casi l'utente la vede arrivare senza aver aspettato una schermata bloccata.
 *
 * Un solo punto di rientro per tutti gli esiti — successo, errore, morte per scadenza (il reaper) —
 * perché il silenzio è il modo peggiore di finire: meglio "l'audit non è riuscito: …" che niente.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildToolJobSummary } from './job-summaries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export type ToolJobOutcome =
	| { status: 'done'; result: AnyRec }
	| { status: 'failed'; error: string };

export type ReportableToolJob = {
	id: string;
	brand_id: string;
	user_id: string;
	thread_id?: string | null;
	tool_name?: string | null;
	input_params?: AnyRec | null;
};

/**
 * La riga che rientra nel thread. Tagliata come `dmReplyBackMessage`: è un messaggio per il
 * modello, non un report — i dettagli stanno già dove il tool li ha scritti.
 */
export function toolJobReportMessage(
	toolName: string,
	outcome: ToolJobOutcome,
	locale: string
): string {
	const en = locale === 'en';
	if (outcome.status === 'failed') {
		const why = (outcome.error || 'unknown error').slice(0, 300);
		return en
			? `🛠️ The background job "${toolName}" did not finish: ${why}. Tell the user in one honest line what failed and what they can do; do not silently retry it.`
			: `🛠️ Il lavoro in background "${toolName}" non è riuscito: ${why}. Dillo all'utente in una riga onesta — cosa è fallito e cosa può fare; non ritentare da solo.`;
	}
	const result = outcome.result ?? {};
	// Un tool può FINIRE dicendo di no: quota esaurita, piano che non copre, sito irraggiungibile.
	// `buildToolJobSummary` ne conserverebbe solo la stringa `error` — e con essa sparirebbero il
	// messaggio operativo e l'`action` (offer_upgrade), che sono l'unica parte utile di quel no.
	if (result.error) {
		const why = String(result.message || result.error).slice(0, 400);
		const action = result.action ? ` Azione richiesta: ${result.action}.` : '';
		return en
			? `🛠️ The background job "${toolName}" stopped without doing the work: ${why}.${result.action ? ` Required action: ${result.action}.` : ''} Explain it to the user in one line and take that action; do not silently retry.`
			: `🛠️ Il lavoro in background "${toolName}" si è fermato senza fare il lavoro: ${why}.${action} Spiegalo all'utente in una riga e fai quell'azione; non ritentare da solo.`;
	}
	const body = buildToolJobSummary(toolName, result).slice(0, 1200);
	return en
		? `🛠️ The background job "${toolName}" is done. Result:\n${body}\n\nReport it to the user and carry on with what comes next.`
		: `🛠️ Il lavoro in background "${toolName}" è finito. Esito:\n${body}\n\nRiferiscilo all'utente e prosegui con quello che viene dopo.`;
}

/**
 * Accoda l'esito come turno sul thread che ha avviato il job. Best-effort per costruzione: un
 * rientro che fallisce non deve mai far fallire la chiusura della riga `chat_jobs` che lo chiama.
 */
export async function enqueueToolJobReport(
	admin: SupabaseClient,
	job: ReportableToolJob,
	outcome: ToolJobOutcome,
	origin?: string
): Promise<string | null> {
	try {
		const threadId = job.thread_id;
		const toolName = job.tool_name ?? '';
		// Niente thread = niente conversazione dove rientrare (job da CLI, da cron, dal designer).
		if (!threadId || !toolName || toolName === 'chat_response') return null;
		const params = (job.input_params ?? {}) as AnyRec;
		const locale = params.report_locale === 'en' ? 'en' : 'it';
		const { enqueueQueuedChatTurn } = await import('./queue');
		return await enqueueQueuedChatTurn(admin, {
			brandId: job.brand_id,
			userId: job.user_id,
			threadId,
			userMessage: toolJobReportMessage(toolName, outcome, locale),
			locale,
			origin: origin || String(params.report_origin ?? '')
		});
	} catch (e) {
		console.error('[Chat] tool job report failed', e);
		return null;
	}
}
