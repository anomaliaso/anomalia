/**
 * IL SEGNO DI VITA — lo stato del run kit di questo thread, per la UI dopo un reload.
 *
 * Il difetto che chiude (visto dal vivo il 23/8): reload a metà turno → lo stream non si
 * riaggancia, il turno continua sul server, e la pagina non ha modo di dire «sta lavorando».
 * Lo stato vive già in agent_kit_runs (RLS: select per i membri del brand) — questo endpoint
 * lo espone e basta. Niente admin client: coi permessi dell'utente, come ogni lettura.
 *
 * `partial` (0218, DA APPLICARE A MANO) è il vero riaggancio: il ramo specchio del tee in
 * live.ts lo riscrive ogni ~1s con { text, reasoning?, tools?, updatedAt }. Il client lo usa
 * per seedare la bolla live e come fallback a scatti di 4s quando il canale Realtime (evento
 * `kit_stream` sul topic `brand:<uuid>`) non è connesso — degradazione dichiarata, non un bug.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { KIT_RUN_WORKING_STATES, kitRunIsAlive } from '$lib/server/chat/turn-limits';


export const GET: RequestHandler = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return new Response('Unauthorized', { status: 401 });

	const { data: brand } = await supabase
		.from('brands')
		.select('id')
		.eq('slug', params.brand)
		.maybeSingle();
	if (!brand) return new Response('Not found', { status: 404 });

	const { data: run } = await supabase
		.from('agent_kit_runs')
		.select('id, agent_id, state, created_at, updated_at, partial, partial_saved_msg_id, heartbeat_at')
		.eq('thread_id', params.thread)
		.in('state', [...KIT_RUN_WORKING_STATES])
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (!run || !kitRunIsAlive(run)) return new Response(null, { status: 204 });
	return json(run, { headers: { 'cache-control': 'no-store' } });
};
