/**
 * La riga in `agent_kit_runs` è la sorgente di verità del run, non la memoria di un processo.
 * Ogni transizione passa da `assertTransition` PRIMA di scrivere, e ogni scrittura è un
 * compare-and-swap sullo stato di partenza: se un altro worker ha già mosso la riga, l'update
 * tocca zero righe e qui diventa un errore nominato, non un silenzio.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertTransition, isResumable, type RunState } from '@anomalia/agent-contracts/contracts';
import type { RunStopReason } from '@anomalia/agent-kit/types';

const TABLE = 'agent_kit_runs';

export type RunRow = {
	id: string;
	brand_id: string;
	thread_id: string | null;
	agent_id: string;
	user_id: string | null;
	state: RunState;
	reason: string | null;
	question: unknown | null;
	lease_until: string | null;
	heartbeat_at: string | null;
	created_at: string;
	updated_at: string;
};

function nowIso(): string {
	return new Date().toISOString();
}

/** Crea la riga in `queued`. È l'unico punto che inserisce. */
export async function createRun(
	db: SupabaseClient,
	input: { brandId: string; threadId?: string | null; agentId: string; userId?: string | null }
): Promise<RunRow> {
	const { data, error } = await db
		.from(TABLE)
		.insert({
			brand_id: input.brandId,
			thread_id: input.threadId ?? null,
			agent_id: input.agentId,
			user_id: input.userId ?? null,
			state: 'queued'
		})
		.select()
		.single();
	if (error) throw new Error(`run: creazione fallita — ${error.message}`);
	return data as RunRow;
}

/** Validata prima di scrivere; il `.eq('state', from)` fa perdere il secondo worker, non pareggiare. */
export async function transition(
	db: SupabaseClient,
	runId: string,
	from: RunState,
	to: RunState,
	extra?: Record<string, unknown>
): Promise<RunRow> {
	assertTransition(from, to);

	const { data, error } = await db
		.from(TABLE)
		.update({ state: to, updated_at: nowIso(), ...extra })
		.eq('id', runId)
		.eq('state', from)
		.select();
	if (error) throw new Error(`run: transizione fallita — ${error.message}`);
	if (!data || data.length === 0) {
		throw new Error(`run: stato cambiato sotto le mani (atteso ${from})`);
	}
	return data[0] as RunRow;
}

/** running → waiting_input, con la domanda salvata sulla riga. */
export function askUser(db: SupabaseClient, runId: string, question: unknown): Promise<RunRow> {
	return transition(db, runId, 'running', 'waiting_input', { question });
}

/** Da waiting_input/waiting_takeover a running: legge il `from` esatto, poi il solito CAS. */
export async function resume(
	db: SupabaseClient,
	runId: string
): Promise<{ run: RunRow; question: unknown | null }> {
	const { data, error } = await db.from(TABLE).select('state, question').eq('id', runId).single();
	if (error) throw new Error(`run: lettura fallita — ${error.message}`);
	const from = data.state as RunState;
	if (!isResumable(from)) throw new Error(`run: non riprendibile da ${from}`);

	// `heartbeat_at` va riscritto QUI: senza, un run fermo in waiting_input per ore torna 'running'
	// col battito stantio del segmento prima — il reaper lo abortisce da vivo e i guard
	// anti-concorrenza, credendolo morto, lasciano partire un secondo run sullo stesso thread.
	const run = await transition(db, runId, from, 'running', { heartbeat_at: nowIso() });
	return { run, question: data.question ?? null };
}

/** Rinnova il lease del worker che sta girando il run — il battito che lo tiene reclamato. */
export async function renewLease(db: SupabaseClient, runId: string, ms: number): Promise<RunRow> {
	const { data, error } = await db
		.from(TABLE)
		.update({ lease_until: new Date(Date.now() + ms).toISOString(), heartbeat_at: nowIso(), updated_at: nowIso() })
		.eq('id', runId)
		.select();
	if (error) throw new Error(`run: rinnovo lease fallito — ${error.message}`);
	if (!data || data.length === 0) throw new Error(`run: rinnovo lease — run ${runId} non trovato`);
	return data[0] as RunRow;
}

/** I run `running` col lease scaduto: NON li transiziona, restituisce le righe e chi chiama decide. */
export async function claimStale(
	db: SupabaseClient,
	{ olderThanMs, limit }: { olderThanMs: number; limit: number }
): Promise<RunRow[]> {
	const cutoff = new Date(Date.now() - olderThanMs).toISOString();
	const { data, error } = await db.from(TABLE).select().eq('state', 'running').lt('lease_until', cutoff).limit(limit);
	if (error) throw new Error(`run: ricerca run scaduti fallita — ${error.message}`);
	return (data ?? []) as RunRow[];
}

function terminalStateFor(reason: RunStopReason): 'done' | 'failed' | 'aborted' {
	switch (reason) {
		case 'completed':
		case 'reply':
			return 'done';
		case 'step_limit':
		case 'token_budget':
		case 'deadline':
			return 'failed';
		case 'aborted':
			return 'aborted';
		case 'waiting_input':
			throw new Error('run: waiting_input non è un finish, usa askUser');
	}
}

/** Chiude il run: legge lo stato corrente per il `from`, poi transition col CAS al solito. */
export async function finish(db: SupabaseClient, runId: string, reason: RunStopReason): Promise<RunRow> {
	const to = terminalStateFor(reason);
	const { data, error } = await db.from(TABLE).select('state').eq('id', runId).single();
	if (error) throw new Error(`run: lettura fallita — ${error.message}`);
	const from = data.state as RunState;
	return transition(db, runId, from, to, { reason });
}

export type CloseOutcome =
	| { kind: 'finish'; reason: Exclude<RunStopReason, 'waiting_input'> }
	| { kind: 'ask_user'; question: unknown };

/** La riga assistant già sagomata (stessa forma di saveMessages): colonne, non parti. */
export type CloseMessage = {
	content: string;
	reasoning?: string;
	toolCalls?: unknown;
	attachments?: string[];
};

/**
 * Chiusura ATOMICA: messaggio in chat + stato finale nella stessa transazione (RPC
 * `agent_kit_close_run`, migration 0222), col CAS su `state='running'` come recinto. Un worker
 * sfrattato (reaper, o un pari più giovane) riceve `closed:false` e non ha scritto NIENTE —
 * né il messaggio né lo stato. È il fix a monte del doppione in chat: `saveMessages` prima di
 * `finish` lasciava depositare la risposta a un run già dichiarato morto.
 */
export async function closeRunSaving(
	db: SupabaseClient,
	runId: string,
	outcome: CloseOutcome,
	message: CloseMessage | null
): Promise<{ closed: boolean; messageId: string | null }> {
	const to = outcome.kind === 'ask_user' ? 'waiting_input' : terminalStateFor(outcome.reason);
	assertTransition('running', to);
	const { data, error } = await db.rpc('agent_kit_close_run', {
		p_run_id: runId,
		p_to_state: to,
		p_reason: outcome.kind === 'finish' ? outcome.reason : null,
		p_question: outcome.kind === 'ask_user' ? outcome.question : null,
		p_message: message
			? {
					content: message.content,
					reasoning: message.reasoning ?? null,
					tool_calls: message.toolCalls ?? null,
					attachments: message.attachments ?? null
				}
			: null
	});
	if (error) throw new Error(`run: chiusura atomica fallita — ${error.message}`);
	const out = data as { closed: boolean; message_id?: string | null };
	return { closed: out.closed, messageId: out.message_id ?? null };
}
