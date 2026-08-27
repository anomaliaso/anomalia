/**
 * Long designer turns (Motion video, UGC Creator) share the chat_jobs row + partial
 * mirror that brand chat uses: the live SSE is teed onto `partial`, a client that
 * drops the HTTP stream can poll it, and a turn that hits the Vercel wall enqueues
 * a NEW job that picks up from persisted work.
 */
import { CHAT_JOB_STATUS } from '$lib/chat-job-status';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import {
	applyChatStreamEvent,
	emptyStreamState,
	readSseEvents,
	toolsForMirror,
	type ChatStreamState,
	type StreamToolCallState
} from '$lib/chat-stream-events';
import {
	CHAT_HEARTBEAT_INTERVAL_MS,
	CHAT_PENDING_STALE_MS,
	CHAT_REAP_MIN_AGE_MS,
	classifyChatJob,
	turnTruncatedNotice
} from '$lib/server/chat/turn-limits';
import { DESIGNER_MAX_CONTINUATIONS } from '$lib/designer-limits';

export const DESIGNER_TOOL_MOTION = 'motion_video';
export const DESIGNER_TOOL_UGC = 'ugc_batch';

export const DESIGNER_TOOLS = [DESIGNER_TOOL_MOTION, DESIGNER_TOOL_UGC] as const;
export type DesignerToolName = (typeof DESIGNER_TOOLS)[number];

/** Don't start another UGC clip / heavy motion step if less than this remains on the clock. */
export const DESIGNER_SLICE_RESERVE_MS = 90_000;

export type DesignerPartial = {
	text: string;
	tools: StreamToolCallState[];
	reasoning: string;
	at: number;
};

export type DesignerJobResult = {
	truncated?: boolean;
	continuation_job_id?: string | null;
	done?: number;
	failed?: number;
};

export function isDesignerTool(name: unknown): name is DesignerToolName {
	return name === DESIGNER_TOOL_MOTION || name === DESIGNER_TOOL_UGC;
}

export function kickDesignerWork(origin: string): Promise<void> {
	const headers: Record<string, string> = {};
	if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
	else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
	return fetch(`${origin}/api/v1/designer/work`, { method: 'POST', headers }).then(
		() => undefined,
		() => undefined
	);
}

type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

export function scheduleDesignerKick(platform: Platform, origin: string) {
	const kick = kickDesignerWork(origin);
	if (platform?.context?.waitUntil) platform.context.waitUntil(kick);
	else void kick;
}

/**
 * ACCODA un lavoro designer perche` lo esegua il DRAIN, invece di eseguirlo qui.
 *
 * La differenza con `insertDesignerJob` e` una sola parola — `pending` invece di `running` — ed
 * e` tutta la differenza che conta: la pagina inserisce la riga e poi fa girare il turno in
 * proprio, usandola come specchio dell'avanzamento; chi accoda non ha nessuno che lo faccia, e
 * una riga `running` che nessuno sta eseguendo il drain non la raccoglie MAI.
 *
 * `origin` non e` decorativo: il drain si sveglia via HTTP, quindi senza non parte nessuno.
 * Gli stati e cosa significano stanno in `$lib/chat-job-status`.
 */
export async function queueDesignerJob(
	supabase: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		toolName: DesignerToolName;
		inputParams: Record<string, unknown>;
		threadId?: string | null;
	}
): Promise<string | null> {
	const { data, error } = await supabase
		.from('chat_jobs')
		.insert({
			brand_id: opts.brandId,
			user_id: opts.userId,
			tool_name: opts.toolName,
			...(opts.threadId ? { thread_id: opts.threadId } : {}),
			status: CHAT_JOB_STATUS.pending,
			input_params: { ...opts.inputParams, queued: true },
			partial: { text: '', tools: [], reasoning: '', at: Date.now() }
		})
		.select('id')
		.maybeSingle();
	if (error) {
		console.error('[designer-jobs] queue', error.message);
		return null;
	}
	return (data?.id as string) ?? null;
}

export async function insertDesignerJob(
	supabase: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		toolName: DesignerToolName;
		inputParams: Record<string, unknown>;
	}
): Promise<string | null> {
	const { data, error } = await supabase
		.from('chat_jobs')
		.insert({
			brand_id: opts.brandId,
			user_id: opts.userId,
			tool_name: opts.toolName,
			// `running` e non `pending`: qui il turno lo fa il CHIAMANTE, e la riga e` solo lo
			// specchio del suo avanzamento. Vedi `queueDesignerJob` per il caso opposto.
			status: CHAT_JOB_STATUS.running,
			input_params: opts.inputParams,
			partial: { text: '', tools: [], reasoning: '', at: Date.now() }
		})
		.select('id')
		.maybeSingle();
	if (error) {
		console.error('[designer-jobs] insert', error.message);
		return null;
	}
	return (data?.id as string) ?? null;
}

export async function finishDesignerJob(
	supabase: SupabaseClient,
	jobId: string,
	patch: {
		status: 'done' | 'failed';
		result?: DesignerJobResult | Record<string, unknown> | null;
		error?: string | null;
		partial?: DesignerPartial | null;
	}
): Promise<void> {
	const row: Record<string, unknown> = {
		status: patch.status,
		completed_at: new Date().toISOString(),
		result: patch.result ?? null,
		error: patch.error ?? null
	};
	if (patch.partial) row.partial = patch.partial;
	const { error } = await supabase.from('chat_jobs').update(row).eq('id', jobId);
	if (error) console.error('[designer-jobs] finish', error.message);
}

export function designerContinuePrompt(
	locale: string,
	kind: 'motion' | 'ugc',
	depth?: number
): string {
	const turn = Math.max(1, Math.trunc(depth ?? 0) + 1);
	if (kind === 'motion') {
		return locale === 'en'
			? `Continue exactly where you left off (turn ${turn} of a long session). The previous slice hit a time or step limit — the TSX already on disk is the source of truth. Keep making SMALL replace_source patches; do not rewrite the file or redo finished edits. Call finish only when the brief is fully applied. If nothing is left, call finish with one line.`
			: `Continua esattamente da dove ti sei fermato (turno ${turn} di una sessione lunga). Lo slice precedente è scaduto per tempo o per numero di step — il TSX già salvato è la fonte di verità. Continua con replace_source PICCOLE; non riscrivere il file e non rifare le edit già applicate. Chiama finish solo quando il brief è completamente applicato. Se non resta nulla, chiama finish in una riga.`;
	}
	return locale === 'en'
		? `Continue the UGC batch from the remaining clips only (turn ${turn}). Do not redo clips that already exist. If nothing is left, say so in one line.`
		: `Continua il batch UGC solo con i clip ancora da fare (turno ${turn}). Non rifare quelli già pronti. Se non resta nulla, dillo in una riga.`;
}

/**
 * Queue a fresh serverless invocation for the rest of a truncated designer turn.
 * Copies input_params (minus huge uploads) and points the parent job at the child.
 */
export async function enqueueDesignerContinuation(
	supabase: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		toolName: DesignerToolName;
		parentJobId: string;
		inputParams: Record<string, unknown>;
		origin: string;
		locale?: string;
		depth?: number;
	}
): Promise<string | null> {
	const depth = Math.max(0, Math.trunc(opts.depth ?? 0));
	if (depth >= DESIGNER_MAX_CONTINUATIONS) return null;

	const locale = bilingualNoticeLocale(opts.locale);
	const { data, error } = await supabase
		.from('chat_jobs')
		.insert({
			brand_id: opts.brandId,
			user_id: opts.userId,
			tool_name: opts.toolName,
			status: 'pending',
			input_params: {
				...opts.inputParams,
				queued: true,
				continuation: true,
				continuation_depth: depth + 1,
				parent_job_id: opts.parentJobId,
				origin: opts.origin,
				locale
			}
		})
		.select('id')
		.maybeSingle();
	if (error) {
		console.error('[designer-jobs] continuation insert', error.message);
		return null;
	}
	const id = (data?.id as string) ?? null;
	if (id) {
		await supabase
			.from('chat_jobs')
			.update({
				result: { truncated: true, continuation_job_id: id },
				status: 'done',
				completed_at: new Date().toISOString()
			})
			.eq('id', opts.parentJobId)
			.eq('status', 'running');
	}
	return id;
}

/**
 * A Motion/UGC process killed at the Vercel wall never reaches `enqueueDesignerContinuation`.
 * Promote those dead `running` rows into a NEW pending job so the next worker picks up the TSX /
 * remaining clips. Orphaned `pending` rows (never claimed) are failed — they never started.
 */
export async function reapStaleDesignerJobs(
	supabase: SupabaseClient,
	origin: string
): Promise<number> {
	const { data: candidates, error } = await supabase
		.from('chat_jobs')
		.select('id, brand_id, user_id, tool_name, input_params, status, created_at, partial')
		.in('tool_name', [...DESIGNER_TOOLS])
		.in('status', ['pending', 'running'])
		.lt('created_at', new Date(Date.now() - CHAT_REAP_MIN_AGE_MS).toISOString())
		.order('created_at', { ascending: true })
		.limit(50);
	if (error) {
		console.error('[designer-jobs] reap list', error.message);
		return 0;
	}

	let reaped = 0;
	for (const job of candidates ?? []) {
		const verdict = classifyChatJob(job as Parameters<typeof classifyChatJob>[0]);
		if (!verdict.dead) continue;
		if (!isDesignerTool(job.tool_name)) continue;

		const params = (job.input_params ?? {}) as Record<string, unknown>;
		const locale = bilingualNoticeLocale(params.locale);
		const depth = Math.max(0, Math.trunc(Number(params.continuation_depth)) || 0);
		const jobOrigin = typeof params.origin === 'string' && params.origin ? params.origin : origin;

		if (job.status === 'pending') {
			await finishDesignerJob(supabase, job.id as string, {
				status: 'failed',
				error: 'queued designer job was never picked up by a worker'
			});
			reaped += 1;
			continue;
		}

		const child = await enqueueDesignerContinuation(supabase, {
			brandId: job.brand_id as string,
			userId: job.user_id as string,
			toolName: job.tool_name,
			parentJobId: job.id as string,
			inputParams: { ...params, origin: jobOrigin, locale },
			origin: jobOrigin,
			locale,
			depth
		});
		if (!child) {
			await finishDesignerJob(supabase, job.id as string, {
				status: 'failed',
				error: 'designer turn died mid-flight (heartbeat lost)'
			});
		} else {
			void kickDesignerWork(jobOrigin);
		}
		reaped += 1;
	}
	return reaped;
}

export function offsetDesignerTools(
	tools: StreamToolCallState[],
	textOffset: number
): StreamToolCallState[] {
	return tools.map((t) => ({
		...t,
		textLen: (typeof t.textLen === 'number' ? t.textLen : 0) + textOffset
	}));
}

export function mergeDesignerPartials(parts: DesignerPartial[]): DesignerPartial {
	let text = '';
	let reasoning = '';
	const tools: StreamToolCallState[] = [];
	let at = 0;
	for (const p of parts) {
		tools.push(...offsetDesignerTools(p.tools ?? [], text.length));
		text += p.text ?? '';
		reasoning += p.reasoning && p.reasoning !== '\u200b' ? p.reasoning : '';
		at = Math.max(at, p.at ?? 0);
	}
	return { text, tools, reasoning, at };
}

export async function loadDesignerJob(
	supabase: SupabaseClient,
	opts: { jobId: string; userId: string; brandId?: string }
): Promise<{
	id: string;
	status: string;
	tool_name: string;
	error: string | null;
	result: DesignerJobResult | null;
	partial: DesignerPartial | null;
} | null> {
	let q = supabase
		.from('chat_jobs')
		.select('id, status, tool_name, error, result, partial')
		.eq('id', opts.jobId)
		.eq('user_id', opts.userId);
	if (opts.brandId) q = q.eq('brand_id', opts.brandId);
	const { data } = await q.maybeSingle();
	if (!data) return null;
	return {
		id: data.id as string,
		status: String(data.status ?? ''),
		tool_name: String(data.tool_name ?? ''),
		error: (data.error as string | null) ?? null,
		result: (data.result as DesignerJobResult | null) ?? null,
		partial: (data.partial as DesignerPartial | null) ?? null
	};
}

/**
 * Tee an AI SDK UI-message SSE onto chat_jobs.partial so a reconnecting client
 * (or a background continuation) sees the same live buffer as the original tab.
 */
export function attachDesignerStreamMirror(
	supabase: SupabaseClient,
	jobId: string
): {
	consumeSseStream: (args: { stream: ReadableStream<string | Uint8Array> }) => Promise<void>;
	stopHeartbeat: () => void;
	state: () => ChatStreamState;
	snapshot: () => DesignerPartial;
} {
	const state = emptyStreamState();
	let live: DesignerPartial = { text: '', tools: [], reasoning: '', at: Date.now() };
	const PARTIAL_MS = 300;
	/**
	 * Gli eventi che non aspettano la finestra: aprire una tool call e` cio` che l'utente deve
	 * vedere SUBITO, e dopo di essa lo stream puo` tacere per minuti. Sono rari, non un firehose.
	 */
	const FLUSH_NOW = new Set(['tool-input-available', 'tool-output-available', 'tool-output-error']);
	let lastWrite = 0;
	let dirty = false;
	let inFlight: Promise<void> | null = null;

	const flush = () => {
		if (!dirty || inFlight) return;
		dirty = false;
		lastWrite = Date.now();
		// Params e risultati dei tool stanno nella riga rispecchiata, sotto un tetto — toolsForMirror.
		const snapshot: DesignerPartial = {
			text: state.text,
			tools: toolsForMirror(state.tools),
			reasoning: state.reasoning,
			at: lastWrite
		};
		live = snapshot;
		inFlight = (async () => {
			try {
				await supabase.from('chat_jobs').update({ partial: snapshot }).eq('id', jobId);
			} catch (error) { swallow('persist job partial snapshot', error); }
			inFlight = null;
		})();
	};

	/**
	 * IL BATTITO SCRIVE LO STATO DI ADESSO, non l'ultimo snapshot riuscito.
	 *
	 * Riscriveva `{ ...live }` con una data nuova: durante un tool lungo — un render motion, dieci
	 * minuti e nessun chunk — la riga restava fresca di data e vecchia di contenuto, quindi la
	 * chiamata in corso non compariva MAI e chi apriva «1 background job» vedeva un lavoro fermo.
	 * `flush()` legge `state`, che il reducer aggiorna a ogni evento: e` la stessa scrittura, sui
	 * dati veri.
	 */
	const heartbeat = setInterval(() => {
		dirty = true;
		flush();
	}, CHAT_HEARTBEAT_INTERVAL_MS);

	const stopHeartbeat = () => clearInterval(heartbeat);

	return {
		state: () => state,
		snapshot: () => live,
		stopHeartbeat,
		consumeSseStream: async ({ stream }) => {
			const reader = stream.getReader();
			const decoder = new TextDecoder();
			let sseBuf = '';
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (typeof value === 'string') sseBuf += value;
					else if (value) sseBuf += decoder.decode(value as Uint8Array, { stream: true });
					const { events, rest } = readSseEvents(sseBuf);
					sseBuf = rest;
					let now = false;
					for (const evt of events) {
						dirty = applyChatStreamEvent(state, evt) || dirty;
						if (FLUSH_NOW.has(String((evt as { type?: unknown })?.type ?? ''))) now = true;
					}
					if (now || Date.now() - lastWrite >= PARTIAL_MS) flush();
				}
				await inFlight;
				dirty = true;
				flush();
				await inFlight;
			} finally {
				stopHeartbeat();
			}
		}
	};
}

export function truncatedDesignerNotice(locale: string, willContinue: boolean): string {
	return turnTruncatedNotice(locale, willContinue);
}

/**
 * Call at the end of a slice (after abort or stream close). `reached()` is only set when
 * `stopWhen` ran — a hung tool that hits the hard abort would otherwise look "finished".
 */
export function designerTurnNeedsContinuation(deadline: {
	reached: () => boolean;
	readonly expired: boolean;
} | null | undefined): boolean {
	if (!deadline) return false;
	deadline.reached();
	return deadline.expired;
}

export { CHAT_PENDING_STALE_MS, CHAT_REAP_MIN_AGE_MS };
