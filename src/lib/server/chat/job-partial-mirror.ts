/**
 * LO SPECCHIO DEL PARTIAL SU UNA RIGA `chat_jobs`.
 *
 * La stessa macchina per i due mondi che eseguono un sub-agent: il worker dei job accodati
 * (subagent-jobs.ts) e la run inline con riga specchio (mode `inline` + `mirror`, il bridge kit).
 * Il partial è la stessa forma dell'SSE di chat piegata dal reducer condiviso — flush immediato
 * quando l'evento è una tool call (è ciò che l'utente deve vedere SUBITO), throttle sul testo, e
 * un battito a intervallo che riscrive lo stato DI ADESSO: `classifyChatJob` legge `partial.at`
 * come segno di vita, e un modello che pensa in silenzio per minuti non deve sembrare morto.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { toolsForMirror, type ChatStreamState } from '$lib/chat-stream-events';

const PARTIAL_MS = 300;
const HEARTBEAT_MS = 10_000;

export function createJobPartialMirror(db: SupabaseClient, jobId: string) {
	let lastWrite = 0;
	let writing = false;
	let lastState: ChatStreamState | null = null;

	const write = async (state: ChatStreamState) => {
		writing = true;
		try {
			await db
				.from('chat_jobs')
				.update({
					partial: {
						text: state.text,
						tools: toolsForMirror(state.tools),
						reasoning: state.reasoning,
						at: Date.now()
					}
				})
				.eq('id', jobId);
		} catch {
			// Lo specchio non può uccidere la run: un update perso si riprende al prossimo flush.
		}
		writing = false;
	};

	return {
		push(state: ChatStreamState, force = false) {
			const now = Date.now();
			lastState = state;
			if (writing) return;
			if (!force && now - lastWrite < PARTIAL_MS) return;
			lastWrite = now;
			void write(state);
		},
		/** Il battito: mentre la run vive, la riga dice «sono viva» anche senza eventi nuovi. */
		startHeartbeat() {
			const timer = setInterval(() => {
				if (lastState) void write(lastState);
			}, HEARTBEAT_MS);
			return () => clearInterval(timer);
		},
		/** Lo stato finale arriva spesso DENTRO la finestra di throttle: senza questo flush, il
		 * partial sulla riga resterebbe indietro di un giro proprio quando la run è finita. */
		async flushLatest() {
			if (lastState) await write(lastState);
		}
	};
}
