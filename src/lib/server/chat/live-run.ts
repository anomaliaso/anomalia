import type { SupabaseClient } from '@supabase/supabase-js';
import { KIT_RUN_WORKING_STATES, kitRunIsAlive } from './turn-limits';

export type LiveRunRow = {
	id: string;
	agent_id: string;
	state: string;
	created_at: string;
	partial?: unknown;
	partial_saved_msg_id?: string | null;
};

/**
 * Il run vivo del thread, per il PRIMO render. Finché lo seminava solo il client, la bolla del
 * lavoro in corso non esisteva fino alla prima risposta del poll: chi ricaricava a metà turno
 * vedeva il vuoto per qualche centinaio di millisecondi, e il testo che il database aveva già
 * non aveva dove essere disegnato. La stessa lettura di `kit-run/+server.ts`, spostata dove il
 * caricamento della pagina può usarla.
 */
export async function loadLiveRun(
	supabase: SupabaseClient,
	threadId: string
): Promise<LiveRunRow | null> {
	const { data } = await supabase
		.from('agent_kit_runs')
		.select('id, agent_id, state, created_at, updated_at, partial, partial_saved_msg_id, heartbeat_at')
		.eq('thread_id', threadId)
		.in('state', [...KIT_RUN_WORKING_STATES])
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (!data || !kitRunIsAlive(data)) return null;
	return data as LiveRunRow;
}
