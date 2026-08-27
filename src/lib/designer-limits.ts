/**
 * Shared Motion / UGC slice limits. Safe for client + server (no $env).
 *
 * One Vercel invocation is ~4 minutes of work. Tiny `replace_source` patches need
 * many agent turns across many invocations — these caps are the chain, not one slice.
 */

/** Agent tool-turns allowed inside one Motion serverless slice. */
export const MOTION_SLICE_MAX_STEPS = 64;

/**
 * Background resumes after the first interactive slice.
 * 1 live turn + 24 jobs × ~4 min ≈ 100 minutes of wall clock.
 */
export const DESIGNER_MAX_CONTINUATIONS = 24;

/** How long the overlay keeps polling a continuation chain. */
export const DESIGNER_FOLLOW_MS =
	(1 + DESIGNER_MAX_CONTINUATIONS) * 5 * 60 * 1000;

/**
 * What one agent slice reported when it ended: did it call finish, how many tool turns it used,
 * and — for a caller that delegated the whole composition instead of watching it stream — what
 * the agent said it built. `summary` is the ONLY prose a delegating caller gets back: the TSX
 * stays where it was written.
 */
export type DesignerSliceEnd = {
	finished: boolean;
	steps: number;
	summary?: string;
	/** True when `finish` passed with no independent review left in the budget. */
	unreviewed?: boolean;
	/**
	 * Perche` la fetta e` morta. `toUIMessageStreamResponse` non rilancia l'errore al chiamante:
	 * senza questo campo un turno delegato che esplode arriva indistinguibile da uno che non ha
	 * trovato niente da fare.
	 */
	error?: string;
};

export function mergeDesignerSliceEnd(
	slice: DesignerSliceEnd,
	tools: Array<{ toolName: string; status?: string }>
): DesignerSliceEnd {
	return {
		finished:
			slice.finished ||
			tools.some((t) => t.toolName === 'finish' && t.status === 'done'),
		steps: Math.max(slice.steps, tools.length),
		...(slice.summary ? { summary: slice.summary } : {}),
		...(slice.unreviewed ? { unreviewed: true } : {}),
		...(slice.error ? { error: slice.error } : {})
	};
}

/**
 * Keep going on a NEW job when this slice ran out of clock or step budget
 * without `finish`. A natural stop (few steps, time left, no finish) is done.
 */
export function shouldContinueDesignerSlice(opts: {
	finished?: boolean;
	steps?: number;
	maxSteps?: number;
	timedOut?: boolean;
	tools?: Array<{ toolName: string; status?: string }>;
}): boolean {
	const finished =
		opts.finished === true ||
		(opts.tools ?? []).some((t) => t.toolName === 'finish' && t.status === 'done');
	if (finished) return false;
	if (opts.timedOut) return true;
	const max = opts.maxSteps ?? MOTION_SLICE_MAX_STEPS;
	return (opts.steps ?? 0) >= max;
}
