import type { SupabaseClient } from '@supabase/supabase-js';
import {
	CHAT_REAP_MIN_AGE_MS,
	CHAT_RUNNING_HARD_STALE_MS,
	chatJobDeathKind,
	chatJobDeathMessage,
	classifyChatJob
} from './turn-limits';

/**
 * Cancel in-flight chat jobs for the current turn:
 * - the chat_response job itself (if provided)
 * - async tool jobs on the same thread created at/after that job
 *
 * Without chatJobId, cancels all pending/running jobs on the thread (fallback).
 */
export async function cancelThreadChatJobs(
	supabase: SupabaseClient,
	opts: { userId: string; threadId: string; chatJobId?: string | null }
): Promise<{ error: Error | null }> {
	const completedAt = new Date().toISOString();
	let since: string | null = null;

	if (opts.chatJobId) {
		const { data: chatJob } = await supabase
			.from('chat_jobs')
			.select('created_at')
			.eq('id', opts.chatJobId)
			.eq('user_id', opts.userId)
			.maybeSingle();
		since = chatJob?.created_at ?? null;

		const { error: chatErr } = await supabase
			.from('chat_jobs')
			.update({ status: 'cancelled', completed_at: completedAt })
			.eq('id', opts.chatJobId)
			.eq('user_id', opts.userId)
			.in('status', ['pending', 'running']);
		if (chatErr) return { error: new Error(chatErr.message) };
	}

	let query = supabase
		.from('chat_jobs')
		.update({ status: 'cancelled', completed_at: completedAt })
		.eq('user_id', opts.userId)
		.eq('thread_id', opts.threadId)
		.in('status', ['pending', 'running']);

	// Only sibling/child jobs from this turn — don't kill older async tools still running
	if (since) {
		query = query.gte('created_at', since);
	}

	const { error } = await query;
	return { error: error ? new Error(error.message) : null };
}

/** True when a background runner should persist results. */
export function shouldPersistAsyncToolResult(status: string | null | undefined): boolean {
	return status === 'running';
}

export class ChatJobCancelledError extends Error {
	constructor(message = 'Chat job cancelled') {
		super(message);
		this.name = 'ChatJobCancelledError';
	}
}

export function isChatJobCancelledError(e: unknown): boolean {
	return e instanceof ChatJobCancelledError || (e instanceof Error && e.name === 'ChatJobCancelledError');
}

export type JobCancellation = {
	signal: AbortSignal;
	/** Throws ChatJobCancelledError if the job is no longer running. */
	assertActive: () => Promise<void>;
};

/**
 * Cooperative cancellation for a running async chat tool job.
 * `assertActive` re-reads status from DB; on cancel it aborts `signal` so in-flight fetches can stop.
 */
export function createJobCancellation(supabase: SupabaseClient, jobId: string): JobCancellation {
	const ac = new AbortController();

	async function assertActive(): Promise<void> {
		if (ac.signal.aborted) throw new ChatJobCancelledError();

		const { data } = await supabase.from('chat_jobs').select('status').eq('id', jobId).maybeSingle();

		if (!shouldPersistAsyncToolResult(data?.status)) {
			if (!ac.signal.aborted) ac.abort(new ChatJobCancelledError());
			throw new ChatJobCancelledError();
		}
	}

	return { signal: ac.signal, assertActive };
}

/**
 * Upper bound on how long a chat job row may still be believed by the "is a reply in flight?"
 * read paths. Liveness itself is decided by {@link classifyChatJob} (heartbeat-based); this is
 * only the coarse DB filter that keeps ancient rows out of those queries in the window before the
 * reaper reaches them.
 *
 * Derived from the function wall rather than picked, because the failure is silent if it is ever
 * SHORTER than a turn may legitimately run: a live turn simply drops out of these queries, so a
 * client that reloads late finds no active job, never starts polling, and watches a working turn
 * as if nothing were happening. Tying it to the same bound `classifyChatJob` uses for a row with
 * no heartbeat keeps the coarse filter and the real liveness test from disagreeing.
 */
export const CHAT_JOB_STALE_MS = CHAT_RUNNING_HARD_STALE_MS;

/** ISO cutoff below which a pending/running chat job is considered dead. */
export const chatJobFreshSince = (): string => new Date(Date.now() - CHAT_JOB_STALE_MS).toISOString();

/**
 * Close out dead job rows so they stop blocking the UI, and make sure somebody hears about it.
 *
 * Called on the read paths that ask whether a turn is in flight AND from the queue worker's cron,
 * so a zombie is closed within ~2 minutes even if nobody ever reopens the chat — the read paths
 * alone left a dead turn claiming "still generating" until a human happened to look.
 *
 * Two things happen per dead row, in this order:
 *  1. Promote any `partial` snapshot into a real assistant message, so a turn that died mid-stream
 *     still leaves the work done so far in the transcript for retry / reopen.
 *  2. Report it. A turn killed at the function wall never throws, so `streamText.onError` never
 *     fires — this is the ONLY place that can tell Sentry / ops that turns are dying.
 *
 * `userId` is optional so the cron can sweep every user with the service-role client.
 */
export async function reapStaleChatJobs(
	supabase: SupabaseClient,
	opts: { userId?: string; threadId?: string; limit?: number; emailBudget?: number } = {}
): Promise<number> {
	let listQ = supabase
		.from('chat_jobs')
		.select('id, brand_id, user_id, thread_id, tool_name, partial, input_params, status, created_at')
		.in('status', ['pending', 'running'])
		.lt('created_at', new Date(Date.now() - CHAT_REAP_MIN_AGE_MS).toISOString())
		.order('created_at', { ascending: true })
		.limit(opts.limit ?? 200);
	if (opts.userId) listQ = listQ.eq('user_id', opts.userId);
	if (opts.threadId) listQ = listQ.eq('thread_id', opts.threadId);

	const { data: candidates, error: listErr } = await listQ;
	if (listErr) {
		console.error('[reapStaleChatJobs] list', listErr.message);
		return 0;
	}

	// One incident kills many turns at once. Sentry groups them; a mailbox does not — so cap the
	// mail and let the rest ride on Sentry/PostHog, which is where you triage a burst anyway.
	let emailsLeft = opts.emailBudget ?? 3;
	let reaped = 0;

	for (const job of candidates ?? []) {
		const verdict = classifyChatJob(job as Parameters<typeof classifyChatJob>[0]);
		if (!verdict.dead) continue;

		const reason = verdict.reason;
		const toolName = (job.tool_name as string | null) ?? null;
		// Motion / UGC slices resume via designer-work, not a failed chat turn.
		if (toolName === 'motion_video' || toolName === 'ugc_batch') continue;
		const message = chatJobDeathMessage(reason, toolName);

		// CLAIM FIRST, then salvage. The read paths and the cron reap concurrently, and an update
		// with no `select` cannot tell "I closed it" from "it was already closed" — so without this
		// two reapers would both salvage the same row (duplicate assistant message in the thread)
		// and both report it (duplicate page). Exactly one writer gets the row back here.
		const { data: claimed, error: claimErr } = await supabase
			.from('chat_jobs')
			.update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
			.eq('id', job.id as string)
			.in('status', ['pending', 'running'])
			.select('id')
			.maybeSingle();
		if (claimErr) {
			console.error('[reapStaleChatJobs]', claimErr.message);
			continue;
		}
		if (!claimed) continue;

		let salvagedMessageId: string | undefined;
		if (job.tool_name === 'chat_response' && job.thread_id && job.partial) {
			try {
				const { salvageStaleChatJobPartial } = await import('./partial-persist');
				salvagedMessageId = await salvageStaleChatJobPartial(supabase, {
					id: job.id as string,
					brand_id: job.brand_id as string,
					user_id: job.user_id as string,
					thread_id: job.thread_id as string,
					partial: job.partial as import('./partial-persist').ChatPartialSnapshot | null,
					error: message,
					input_params: (job.input_params ?? null) as { tier?: string } | null
				});
			} catch (e) {
				console.error('[reapStaleChatJobs] salvage', e);
			}
		}

		reaped += 1;

		// Un tool job morto (heartbeat perso, muro superato, mai raccolto dalla coda) deve tornare
		// in conversazione come tutti gli altri esiti: il turno che l'ha avviato si è chiuso subito
		// dicendo "ti riporto il risultato", e senza questo quella promessa resterebbe appesa.
		// Stesso punto di rientro del successo e dell'errore — vedi tool-job-report.ts.
		if (toolName && toolName !== 'chat_response' && job.thread_id) {
			const { enqueueToolJobReport } = await import('./tool-job-report');
			await enqueueToolJobReport(
				supabase,
				job as Parameters<typeof enqueueToolJobReport>[1],
				{ status: 'failed', error: message },
				''
			);
		}

		const { reportChatError } = await import('./report-error');
		await reportChatError(null, new ChatTurnDeadError(message, reason), {
			brandId: job.brand_id as string,
			userId: job.user_id as string,
			threadId: job.thread_id as string | null,
			jobId: job.id as string,
			tier: (job.input_params as { tier?: string } | null)?.tier ?? null,
			kind: chatJobDeathKind(reason, toolName),
			notify: emailsLeft > 0 ? 'all' : 'sentry',
			detail: salvagedMessageId
				? `partial reply salvaged as message ${salvagedMessageId}`
				: 'nothing to salvage — the turn produced no output'
		});
		if (emailsLeft > 0) emailsLeft -= 1;
	}

	return reaped;
}

/** Named so Sentry groups turn deaths apart from provider errors. */
export class ChatTurnDeadError extends Error {
	constructor(
		message: string,
		readonly reason: string
	) {
		super(message);
		this.name = 'ChatTurnDeadError';
	}
}
