/**
 * La cassetta dei messaggi scritti MENTRE un turno sta girando.
 *
 * Prima, un messaggio inviato durante la generazione finiva in coda (`chat_jobs` pending) e
 * partiva come turno intero DOPO — cioè l'utente che scrive "no, in inglese!" veniva ascoltato
 * a lavoro finito. Il loop ricostruisce comunque i messaggi a ogni step (`prepareStep`), quindi
 * il confine di step è il punto naturale dove un follow-up può entrare nel turno IN CORSO.
 *
 * Regole:
 *  - si consuma UNA volta: claim atomico pending→done, un solo consumatore (drain incluso);
 *  - solo follow-up umani semplici: continuazioni, turni schedulati e messaggi con documenti
 *    restano turni interi — hanno bisogno del loro giro completo (brief, idratazione allegati);
 *  - un messaggio arrivato DOPO l'ultimo step resta `pending` e gira come turno normale appena
 *    il turno corrente finisce (scheduleQueueKick) — niente si perde;
 *  - il testo assorbito viene salvato subito come riga user del thread, così il transcript
 *    mostra il messaggio nel punto in cui è stato detto — a meno che non ci sia già
 *    (`user_message_saved`: il POST l'aveva persistito prima di prendersi il 409 busy).
 */
import type { ModelMessage } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveMessages } from './persistence';

export type MailboxClaim = {
	id: string;
	text: string;
	/** La riga user è già nel thread: l'ha salvata il POST prima di ricevere il 409 busy. */
	alreadySaved: boolean;
};

/** Claim dei follow-up pending su questo thread. Esportata da sola per i test. */
export async function claimQueuedFollowUps(
	supabase: SupabaseClient,
	opts: { userId: string; threadId: string; consumedByJobId?: string | null }
): Promise<MailboxClaim[]> {
	const { data: rows } = await supabase
		.from('chat_jobs')
		.select('id, input_params')
		.eq('user_id', opts.userId)
		.eq('thread_id', opts.threadId)
		.eq('tool_name', 'chat_response')
		.eq('status', 'pending')
		.order('created_at', { ascending: true })
		.limit(5);

	const out: MailboxClaim[] = [];
	for (const row of rows ?? []) {
		const params = (row.input_params ?? {}) as Record<string, unknown>;
		// Non sono messaggi per il turno in corso: sono turni interi che devono girare da soli.
		if (params.continuation === true || params.scheduled === true) continue;
		// Un DM fra agenti forza CHI risponde (agent/speaker nei params): assorbirlo nel turno in
		// corso farebbe rispondere l'agente sbagliato e perderebbe firma e brief del destinatario.
		if (params.dm === true) continue;
		// I documenti vanno idratati dal loro giro completo — meglio un turno dopo che un allegato perso.
		if (params.documents) continue;
		const text = String(params.user_message ?? '').trim();
		if (!text) continue;
		const { data: claimed } = await supabase
			.from('chat_jobs')
			.update({
				status: 'done',
				result: { consumed_mid_turn: true, consumed_by: opts.consumedByJobId ?? null },
				completed_at: new Date().toISOString()
			})
			.eq('id', row.id as string)
			.eq('status', 'pending')
			.select('id')
			.maybeSingle();
		if (claimed) out.push({ id: row.id as string, text, alreadySaved: params.user_message_saved === true });
	}
	return out;
}

export type MidTurnMailbox = {
	/** Da passare (o comporre) come `prepareStep` della chiamata al modello. */
	prepareStep: (args: { messages?: ModelMessage[] }) => Promise<{ messages?: ModelMessage[] }>;
	/** Quanti follow-up sono stati assorbiti in questo turno. */
	absorbedCount: () => number;
};

/**
 * Mailbox per UN turno: a ogni confine di step reclama i follow-up e li appende come messaggi
 * user in fondo al contesto dello step. L'override di `messages` resta la base degli step
 * successivi (ai@7), quindi ogni follow-up si appende UNA volta e l'SDK lo porta avanti da sé.
 */
export function createMidTurnMailbox(
	supabase: SupabaseClient,
	opts: { brandId: string; userId: string; threadId: string; jobId?: string | null }
): MidTurnMailbox {
	const undelivered: ModelMessage[] = [];
	let absorbed = 0;
	return {
		prepareStep: async ({ messages }) => {
			try {
				const claims = await claimQueuedFollowUps(supabase, {
					userId: opts.userId,
					threadId: opts.threadId,
					consumedByJobId: opts.jobId ?? null
				});
				for (const c of claims) {
					undelivered.push({ role: 'user', content: c.text });
					absorbed += 1;
					if (c.alreadySaved) continue;
					// Visibile subito nel transcript, nell'ordine in cui è stato detto.
					await saveMessages(
						supabase,
						opts.brandId,
						opts.userId,
						[{ role: 'user', content: c.text }],
						opts.threadId
					).catch(() => []);
				}
			} catch {
				// Mailbox rotta = turno normale: il follow-up resterà in coda e girerà dopo.
			}
			if (!undelivered.length || !messages) return {};
			return { messages: [...messages, ...undelivered.splice(0)] };
		},
		absorbedCount: () => absorbed
	};
}
