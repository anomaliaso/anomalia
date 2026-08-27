import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrCreateAgentThread } from '$lib/server/team-ignition';
import type { JobKey } from '$lib/server/job-roster';
import {
	enqueueQueuedChatTurn,
	kickChatQueueWork,
	threadHasActiveChatResponse
} from '$lib/server/chat/queue';

/**
 * LA PROMOZIONE DEGLI AGENTI DI DEFAULT — un lavoro del roster che RAGIONA non chiama più il suo
 * modello inline dentro un cron: accoda un TURNO PIENO di chat nel SUO thread persistente
 * (il diario dell'agente PROPRIETARIO del job — surface='team', creato da team-ignition), sullo stesso runtime degli agenti
 * custom schedulati (`chat_jobs` → processNextQueuedChatJob → l'intero registry, deleghe, sandbox,
 * Composio). Nessun runtime nuovo: questa funzione è solo il ponte tra il tick e quella coda.
 *
 * Cosa resta nel tick, PRIMA di arrivare qui: il gate del roster (jobPausedForBrand /
 * jobEnabledForBrand + scheduledWorkAllowed) — spento o senza piano vuol dire che non si accoda
 * niente. E la CONSEGNA deterministica (pubblicazioni, attivazioni di proposte scadute, email di
 * quota) resta nei cron: il turno ragiona e usa i tool; i tool possiedono la consegna.
 *
 * Continuità: il thread è UNO per agente e per brand, quindi ogni giro continua la stessa
 * conversazione — la compattazione della coda (maybeCompactThread) tiene la storia dentro il
 * budget, come per gli agenti custom con reuse_thread.
 */
export type AgentTurnResult =
	| { ok: true; jobId: string; threadId: string }
	| { ok: false; reason: 'no_owner' | 'thread_busy' | 'fresh' | 'enqueue_failed' };

export async function enqueueAgentJobTurn(
	admin: SupabaseClient,
	opts: {
		brandId: string;
		jobKey: JobKey;
		/** L'incarico vero, nel system prompt. In inglese, come i blurb del roster: il modello traduce. */
		brief: string;
		/** La riga corta che il thread mostra come messaggio "utente" del giro. */
		visible: { it: string; en: string };
		/** Base URL per il kick della coda; senza, ci pensa il cron della coda. */
		origin?: string;
		/**
		 * Dedupe: se in questo thread è già stato accodato un turno schedulato più recente di così,
		 * non se ne accoda un altro (`reason: 'fresh'`). È IL gate di freschezza del percorso
		 * promosso — i vecchi guard su gtm_plans/agent_runs non vedono cosa scrive un turno pieno.
		 */
		minIntervalMs?: number;
	}
): Promise<AgentTurnResult> {
	const t = await getOrCreateAgentThread(admin, opts.brandId, opts.jobKey);
	if (!t) return { ok: false, reason: 'no_owner' };

	if (opts.minIntervalMs && opts.minIntervalMs > 0) {
		const since = new Date(Date.now() - opts.minIntervalMs).toISOString();
		const { data: recent } = await admin
			.from('chat_jobs')
			.select('id')
			.eq('thread_id', t.threadId)
			.eq('tool_name', 'chat_response')
			.gte('created_at', since)
			// Solo i giri schedulati: una risposta dell'utente nel thread non deve sopprimere il giro.
			.filter('input_params->scheduled', 'eq', 'true')
			.limit(1);
		if (recent?.length) return { ok: false, reason: 'fresh' };
	}

	// Un giro precedente ancora in corsa (o in coda) tiene il posto: non si impila.
	const busy = await threadHasActiveChatResponse(admin, { userId: t.userId, threadId: t.threadId });
	if (busy) return { ok: false, reason: 'thread_busy' };

	const locale = t.locale === 'it' ? 'it' : 'en';
	const jobId = await enqueueQueuedChatTurn(admin, {
		brandId: opts.brandId,
		userId: t.userId,
		threadId: t.threadId,
		userMessage: locale === 'it' ? opts.visible.it : opts.visible.en,
		locale,
		origin: opts.origin ?? '',
		scheduled: true,
		brief: opts.brief
	});
	if (!jobId) return { ok: false, reason: 'enqueue_failed' };
	if (opts.origin) void kickChatQueueWork(opts.origin);
	return { ok: true, jobId, threadId: t.threadId };
}
