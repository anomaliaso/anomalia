/**
 * A ceiling on a single tool call.
 *
 * `stopWhen` bounds a turn BETWEEN steps; nothing bounds a step. So a tool that hangs — a poll loop
 * whose own timeout is longer than the function wall, a fetch with no timeout of its own — sails
 * straight past the soft budget and takes the turn down at the hard abort, mid-step, with no
 * `onFinish`: the reply is salvaged from a partial snapshot instead of being finished properly.
 *
 * Wrapping every `execute` closes that from the outside. Whatever a tool does internally, it cannot
 * outlive the time the turn has left. Two properties make this safe to apply blanket-wise:
 *
 *  1. On expiry the wrapper RETURNS, it does not throw. The step completes normally, `stopWhen`
 *     gets its chance, and the turn ends through the finish path with everything already streamed.
 *  2. It never shortens a tool that fits. A tool only ever sees the clock when it was going to
 *     overrun the turn anyway.
 *
 * What it does NOT do is stop the work. A tool that ignores its `abortSignal` keeps running in the
 * background until the process ends — the wrapper stops the TURN waiting on it. Propagating the
 * signal into the tool is still the real fix; this is the floor under the ones that don't.
 */

/** Below this there is no point starting a tool — the result would be thrown away anyway. */
export const DEFAULT_MIN_SLICE_MS = 5_000;

const EXPIRED = Symbol('step-deadline-expired');
const CANCELLED = Symbol('step-deadline-cancelled');

export type StepExpiry = {
	tool: string;
	waitedMs: number;
	/** `timeout` = it ran and overran. `no_time_left` = it was never started. */
	reason: 'timeout' | 'no_time_left';
};

export type StepDeadlineOpts = {
	/**
	 * Time the turn still has for productive work, read FRESH on every step — normally
	 * `ChatTurnDeadline.remainingMs`, so a step's ceiling is whatever the soft budget has left.
	 * Expiring against that (rather than a fixed per-tool cap) is what guarantees the turn reaches
	 * `stopWhen` before the hard abort.
	 */
	remainingMs: () => number;
	minSliceMs?: number;
	/** Observability hook — the timeouts this catches are exactly the ones worth alerting on. */
	onExpired?: (info: StepExpiry) => void;
};

/** Shape the model sees when a tool was stopped. Reads as a result, not as a crash. */
function timedOutResult(tool: string, waitedMs: number) {
	return {
		error: 'tool_timeout',
		tool,
		waited_ms: waitedMs,
		message: `${tool} did not finish within the time left in this turn and was stopped. Any work it started may be incomplete. Do not call it again now — tell the user what is still missing and that it needs another turn.`
	};
}

function outOfTimeResult(tool: string) {
	return {
		error: 'turn_out_of_time',
		tool,
		message: `Not enough time left in this turn to run ${tool}, so it was not started. Wrap up with what you already have and tell the user what is still pending.`
	};
}

function cancelledResult(tool: string) {
	return { cancelled: true, tool, message: `${tool} was cancelled.` };
}

function race<T>(
	work: Promise<T>,
	ms: number,
	signal?: AbortSignal
): Promise<T | typeof EXPIRED | typeof CANCELLED> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;

	const guard = new Promise<typeof EXPIRED | typeof CANCELLED>((resolve) => {
		timer = setTimeout(() => resolve(EXPIRED), ms);
		if (signal) {
			onAbort = () => resolve(CANCELLED);
			signal.addEventListener('abort', onAbort, { once: true });
		}
	});

	return Promise.race([work, guard]).finally(() => {
		if (timer) clearTimeout(timer);
		if (signal && onAbort) signal.removeEventListener('abort', onAbort);
	});
}

/**
 * Wrap every tool in `tools` so no single call can outlive the turn's remaining budget.
 * Entries without an `execute` (client-side tools) are passed through untouched.
 */
export function withStepDeadline<T extends Record<string, unknown>>(tools: T, opts: StepDeadlineOpts): T {
	const minSlice = opts.minSliceMs ?? DEFAULT_MIN_SLICE_MS;
	const wrapped: Record<string, unknown> = {};

	for (const [name, tool] of Object.entries(tools)) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const execute = (tool as { execute?: (input: any, execOpts: any) => any } | null)?.execute;
		if (typeof execute !== 'function') {
			wrapped[name] = tool;
			continue;
		}

		wrapped[name] = {
			...(tool as object),
			execute: async (input: unknown, execOpts?: { abortSignal?: AbortSignal }) => {
				const signal = execOpts?.abortSignal;
				if (signal?.aborted) return cancelledResult(name);

				const slice = Math.trunc(opts.remainingMs());
				if (slice < minSlice) {
					opts.onExpired?.({ tool: name, waitedMs: 0, reason: 'no_time_left' });
					return outOfTimeResult(name);
				}

				const startedAt = Date.now();
				// Normalises a synchronous throw into a rejection so the race below sees it either way.
				const work = (async () => execute(input, execOpts ?? {}))();
				// We may stop waiting on `work` before it settles; without this its later rejection
				// would surface as an unhandled rejection and take the process down.
				work.catch(() => {});

				const result = await race(work, slice, signal);
				if (result === CANCELLED) return cancelledResult(name);
				if (result === EXPIRED) {
					const waitedMs = Date.now() - startedAt;
					opts.onExpired?.({ tool: name, waitedMs, reason: 'timeout' });
					console.error(`[Chat] tool '${name}' stopped after ${Math.round(waitedMs / 1000)}s — out of turn budget`);
					return timedOutResult(name, waitedMs);
				}
				return result;
			}
		};
	}

	return wrapped as T;
}
