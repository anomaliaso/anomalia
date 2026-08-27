import type { SupabaseClient } from '@supabase/supabase-js';
import { KIT_RUN_STOPPED_BY_USER } from '$lib/server/chat/turn-limits';
import {
	assistantContentFromPartial,
	persistPartialAssistantReply,
	type ChatPartialSnapshot
} from '$lib/server/chat/partial-persist';

type ClaimedRun = {
	id: string;
	brand_id: string;
	user_id: string | null;
	partial?: ChatPartialSnapshot | null;
	partial_saved_msg_id?: string | null;
};

/**
 * LO STOP DI UN TURNO KIT. `chat_jobs` è cieco ai run kit, quindi il percorso di cancellazione
 * del motore classico non li raggiunge: il client abortiva la propria fetch e il turno andava
 * avanti — crediti spesi, risposta che ricompare, e sul muro una continuazione accodata da sola.
 *
 * CLAIM-FIRST come il classico: la transizione fuori da `running` è l'unico titolo a scrivere il
 * messaggio. Chi la perde (l'`onFinish` del turno, se ha già chiuso da solo) non tocca niente, e
 * `runKitTurn` rilegge lo stato a ogni battito e si ferma.
 *
 * `select('*')` perché i deploy NON eseguono le migration: nominare `partial` (0218) o
 * `partial_saved_msg_id` (0219) prenderebbe un 42703 e spegnerebbe lo Stop in silenzio.
 */
export async function cancelKitRun(
	admin: SupabaseClient,
	supabase: SupabaseClient,
	threadId: string
): Promise<boolean> {
	const { data } = await admin
		.from('agent_kit_runs')
		.update({ state: KIT_RUN_STOPPED_BY_USER, reason: 'aborted', updated_at: new Date().toISOString() })
		.eq('thread_id', threadId)
		.in('state', ['queued', 'running'])
		.select('*');

	const claimed = (data ?? []) as ClaimedRun[];
	if (!claimed.length) return false;

	for (const run of claimed) {
		if (run.partial_saved_msg_id || !run.user_id) continue;
		// Stop ≠ cancella: quello che era già arrivato resta nel thread, tool call comprese.
		const content = assistantContentFromPartial(run.partial ?? null);
		if (!content.length) continue;
		await persistPartialAssistantReply(supabase, {
			brandId: run.brand_id,
			userId: run.user_id,
			threadId,
			content,
			finalStatus: 'cancelled'
		}).catch((e) => console.error(`[AGENT_KIT] stop: parziale non salvato (run ${run.id})`, e));
	}
	return true;
}
