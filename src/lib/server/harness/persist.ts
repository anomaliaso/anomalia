import { createAdminClient } from '$lib/server/supabase-admin';
import { getBrandContext } from '$lib/server/ai-log';
import type { HarnessSession } from './session';
import { redactFor, redactJson } from '$lib/server/redact';

/** Stessi tetti dichiarati da `agent-sessions.ts`: qui non c'erano affatto. */
const MAX_TRANSCRIPT = 20_000;
const MAX_SYSTEM_PROMPT = 40_000;

export type AgentSessionRow = {
	id: string;
	brand_id: string;
	user_id: string | null;
	thread_id: string | null;
	job_id: string | null;
	agent: string;
	mode: string;
	surface: string;
	status: string;
	model: string | null;
	provider: string | null;
	system_prompt: string | null;
	transcript: string;
	events: unknown;
	event_count: number;
	error: string | null;
	format_version: number;
	created_at: string;
	updated_at: string;
	finished_at: string | null;
};

/**
 * LA TRACCIA CHE SI SVUOTAVA DA SOLA, in silenzio.
 *
 * `redactJson` serializza TUTTO l'array in una stringa sola, ci passa sopra la redazione e poi
 * riparsa. Se quel round-trip fallisce torna `null`, e il `?? []` qui sotto scriveva una traccia
 * VUOTA: nessun errore, nessun log, una riga in `agent_sessions` che dice `event_count: 47` e
 * `events: []`. Misurato sul database di produzione il 2026-08-23, ultimi 14 giorni: **19 sessioni
 * su 146 della superficie `chat`** stanno esattamente così (batch 0/123, room 0/23, consult 0/2 —
 * è un difetto della chat perché è la superficie con gli eventi più grossi, mediana 55 KB e punte
 * da 1 MB, cioè quella con più occasioni di rompere il round-trip).
 *
 * Il rimedio è per evento invece che per array: ciò che si redige da solo si salva, e l'evento che
 * rompe la serializzazione lascia un segnaposto al suo posto. Un buco dichiarato è recuperabile,
 * un array vuoto no — nessuno va a cercare la traccia di un turno che sembra semplicemente non
 * averne prodotta.
 *
 * ponytail: nessun redattore più furbo, nessuno streaming JSON. Il tentativo intero resta il
 * percorso normale (una serializzazione sola, com'era); il giro per evento è il ripiego, quindi si
 * paga solo nel 13% dei casi che oggi si perdono del tutto.
 */
export function redactEvents(events: readonly unknown[], brandId: string): unknown[] {
	const all = redactJson(events as unknown[], brandId);
	if (all) return all;
	return events.map((e, i) => redactJson(e, brandId) ?? { type: 'redaction_failed', index: i });
}

export function sessionToRow(session: HarnessSession): AgentSessionRow | null {
	const brandId = session.meta.brandId || getBrandContext();
	if (!brandId) return null;
	const now = new Date().toISOString();
	const finished = session.status !== 'running';
	return {
		id: session.id,
		brand_id: brandId,
		user_id: session.meta.userId ?? null,
		thread_id: session.meta.threadId ?? null,
		job_id: session.meta.jobId ?? null,
		agent: session.meta.agent,
		mode: session.meta.mode ?? '',
		surface: session.meta.surface ?? 'batch',
		status: session.status,
		model: session.meta.model ?? null,
		provider: session.meta.provider ?? null,
		// REDATTI E TAGLIATI, in quest'ordine. Fino al 22/8/2026 questi quattro campi uscivano
		// GREZZI e senza tetti — ed è da qui che nasce ogni riga di `agent_sessions` in produzione:
		// 267 su 267, con `system_prompt` fino a 148.295 caratteri contro i 40.000 dichiarati
		// dall'altro ramo, e un `transcript` da 1.029.357. Redigere solo `saveAgentSession`
		// sarebbe stato teatro: quel ramo, in produzione, non ha scritto nemmeno una riga.
		system_prompt: redactFor(session.systemPrompt() ?? '', brandId).slice(0, MAX_SYSTEM_PROMPT) || null,
		transcript: redactFor(session.transcript(), brandId).slice(0, MAX_TRANSCRIPT),
		// Fail-closed: mai gli eventi grezzi. Ma nemmeno il vuoto silenzioso — vedi redactEvents.
		events: redactEvents(session.events, brandId),
		event_count: session.events.length,
		error: session.error ? redactFor(session.error, brandId) : null,
		// «Redatta alla scrittura». La colonna esiste già in produzione (tutte le righe a 1),
		// quindi nessuna migration: i lettori rifiutano `< 2` invece di servirle in chiaro.
		format_version: 2,
		created_at: session.createdAt,
		updated_at: now,
		finished_at: finished ? now : null
	};
}

/**
 * Fire-and-forget upsert. Never throws, never blocks the agent. Same contract as persistAgentRun
 * / logAiCall: a missing table must not fail generation.
 */
export function persistHarnessSession(session: HarnessSession): void {
	try {
		const row = sessionToRow(session);
		if (!row) {
			console.warn('[harness] skip persist — no brandId for', session.meta.agent);
			return;
		}
		const admin = createAdminClient();
		// Running snapshots use insert-only so a slow "started" write cannot overwrite a
		// finished transcript if onFinish already landed.
		const q =
			session.status === 'running'
				? admin.from('agent_sessions').insert(row)
				: admin.from('agent_sessions').upsert(row, { onConflict: 'id' });
		void q.then(({ error }) => {
			if (!error) return;
			if (session.status === 'running' && error.code === '23505') return;
			console.warn('[harness] persist failed:', error.message);
		});
	} catch {
		// missing admin env — optional observability
	}
}
