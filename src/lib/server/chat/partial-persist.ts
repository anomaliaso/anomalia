/**
 * Promote a live stream snapshot (or incomplete steps) into a durable assistant
 * row when a turn dies mid-flight. Without this, reopen shows only the user
 * message even though the model already wrote text / ran tools.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelMessage } from 'ai';
import { assistantContentFromSteps, saveMessages } from './persistence';

export type ChatPartialSnapshot = {
	text?: string;
	/** Il motore v1 e i job di chat scrivono ancora il ragionamento come una stringa sola. */
	reasoning?: string;
	/** Lo specchio kit scrive i pensieri uno per uno, ognuno con la sua posizione nel turno. */
	reasoningSegments?: Array<{ text?: string }>;
	tools?: Array<{
		toolCallId?: string;
		toolName?: string;
		status?: string;
		textLen?: number;
		/**
		 * Gli ARGOMENTI della chiamata. Mancavano da questo tipo, e la riga qui sotto li scriveva
		 * `{}` a mano: il salvataggio parziale — cioè un turno ucciso dal muro dei 300 secondi o
		 * fermato dall'utente — persisteva ogni tool call SENZA sapere con cosa era stata chiamata.
		 * Misurato su 60 giorni: gli argomenti ci sono nel 100% dei turni normali, si perdono nel
		 * 24% di quelli oltre i 250 secondi e nel 100% dei salvataggi parziali. La misura spariva
		 * esattamente nei turni per cui serviva.
		 *
		 * Il dato non andava raccolto: `StreamToolCallState.input` (chat-stream-events.ts) lo
		 * riempie già da `tool-input-available`. Mancava solo di portarlo fin qui.
		 */
		input?: unknown;
	}>;
};

/** Build assistant content parts from the job.partial mirror (no step payloads). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assistantContentFromPartial(partial: ChatPartialSnapshot | null | undefined): any[] {
	if (!partial || typeof partial !== 'object') return [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const content: any[] = [];
	const segments = Array.isArray(partial.reasoningSegments) ? partial.reasoningSegments : [];
	const reasoning = (
		segments.length
			? segments.map((s) => String(s?.text ?? '')).filter(Boolean).join('\n\n')
			: String(partial.reasoning ?? '')
	)
		.replace(/^\u200b$/, '')
		.trim();
	if (reasoning) content.push({ type: 'reasoning', text: reasoning });

	const text = String(partial.text ?? '');
	const tools = Array.isArray(partial.tools) ? partial.tools : [];
	// Replay in stream order: text before each tool (via textLen), then trailing text.
	const ordered = [...tools]
		.map((t, i) => ({
			toolCallId: String(t.toolCallId ?? `partial-${i}`),
			toolName: String(t.toolName ?? 'tool'),
			textLen: typeof t.textLen === 'number' ? t.textLen : text.length,
			status: t.status,
			input: t.input
		}))
		.sort((a, b) => a.textLen - b.textLen || a.toolCallId.localeCompare(b.toolCallId));

	let cursor = 0;
	for (const t of ordered) {
		const slice = text.slice(cursor, t.textLen).trim();
		if (slice) content.push({ type: 'text', text: slice });
		cursor = Math.max(cursor, t.textLen);
		content.push({
			type: 'tool-call',
			toolCallId: t.toolCallId,
			toolName: t.toolName,
			input: t.input ?? {},
			...(t.status === 'error' ? { status: 'error' } : t.status === 'done' ? { status: 'done' } : {})
		});
	}
	const tail = text.slice(cursor).trim();
	if (tail) content.push({ type: 'text', text: tail });
	else if (!ordered.length && text.trim()) content.push({ type: 'text', text: text.trim() });

	return content;
}

/**
 * Prefer real step payloads (previews, structured tool results); fall back to the
 * SSE mirror when the provider died before onFinish had usable steps.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function contentFromFailedTurn(opts: {
	steps?: any[] | null;
	text?: string | null;
	partial?: ChatPartialSnapshot | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
}): any[] {
	const fromSteps = assistantContentFromSteps(opts.steps ?? [], opts.text ?? undefined);
	if (fromSteps.length > 0) return fromSteps;
	return assistantContentFromPartial(opts.partial);
}

export async function persistPartialAssistantReply(
	supabase: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		threadId: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		content: any[];
		jobId?: string | null;
		model?: string | null;
		tier?: string | null;
		durationMs?: number;
		error?: string | null;
		/** User Stop → cancelled; provider/timeout → failed (default). */
		finalStatus?: 'failed' | 'cancelled';
	}
): Promise<string | undefined> {
	if (!opts.content.length) return undefined;

	const finalStatus = opts.finalStatus ?? 'failed';

	// Stop can race across instances (cancel action + onAbort). Claim once so we never
	// insert two assistant rows for the same stopped turn.
	if (opts.jobId && finalStatus === 'cancelled') {
		const { data: claimed } = await supabase
			.from('chat_jobs')
			.update({
				status: 'cancelled',
				result: { stopped: true },
				partial: null,
				completed_at: new Date().toISOString()
			})
			.eq('id', opts.jobId)
			.in('status', ['pending', 'running', 'cancelled'])
			.is('result', null)
			.select('id')
			.maybeSingle();
		if (!claimed) return undefined;
	}

	const [savedId] = await saveMessages(
		supabase,
		opts.brandId,
		opts.userId,
		[{ role: 'assistant', content: opts.content } as unknown as ModelMessage],
		opts.threadId,
		{
			...(opts.durationMs != null ? { durationMs: opts.durationMs } : {}),
			...(opts.model ? { model: opts.model } : {}),
			...(opts.tier ? { tier: opts.tier } : {})
		}
	);

	if (opts.jobId && finalStatus === 'failed') {
		await supabase
			.from('chat_jobs')
			.update({
				status: 'failed',
				error: (opts.error ?? 'stream failed').slice(0, 2000),
				// L'id del messaggio promosso resta sulla riga: se il turno era vivo e finisce dopo
				// il reap (heartbeat in stallo, non processo morto), il finish lo ritrova qui e può
				// supersedere il doppione invece di lasciare due bolle identiche nel thread.
				...(savedId ? { result: { salvaged_message_id: savedId } } : {}),
				// Keep partial until a successful retry supersedes — useful for debugging,
				// but the message row is now the source of truth for the UI.
				completed_at: new Date().toISOString()
			})
			.eq('id', opts.jobId)
			.in('status', ['pending', 'running', 'failed']);
	}

	return savedId;
}

/**
 * When a job is abandoned (serverless timeout / crash), promote whatever was
 * mirrored onto `partial` so reopen still shows the work done so far.
 */
export async function salvageStaleChatJobPartial(
	supabase: SupabaseClient,
	job: {
		id: string;
		brand_id: string;
		user_id: string;
		thread_id: string | null;
		partial: ChatPartialSnapshot | null;
		error?: string | null;
		input_params?: { tier?: string } | null;
	}
): Promise<string | undefined> {
	if (!job.thread_id) return undefined;
	const content = assistantContentFromPartial(job.partial);
	if (!content.length) return undefined;

	return persistPartialAssistantReply(supabase, {
		brandId: job.brand_id,
		userId: job.user_id,
		threadId: job.thread_id,
		content,
		jobId: job.id,
		tier: job.input_params?.tier ?? null,
		error: job.error ?? 'abandoned: no result before timeout'
	});
}
