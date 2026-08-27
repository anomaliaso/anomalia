/**
 * Follow a designer job (Motion / UGC) after the live SSE ends — including
 * Vercel-timeout continuations that land on a NEW job id.
 */
import { emptyStreamState, type ChatStreamState, type StreamToolCallState } from '$lib/chat-stream-events';
import { DESIGNER_FOLLOW_MS } from '$lib/designer-limits';

export type DesignerJobPayload = {
	id: string;
	status: string;
	error?: string | null;
	result?: { truncated?: boolean; continuation_job_id?: string | null } | null;
	partial?: {
		text?: string;
		tools?: StreamToolCallState[];
		reasoning?: string;
	} | null;
};

function offsetTools(tools: StreamToolCallState[], textOffset: number): StreamToolCallState[] {
	return tools.map((t) => ({
		...t,
		textLen: (typeof t.textLen === 'number' ? t.textLen : 0) + textOffset
	}));
}

export async function fetchDesignerJob(
	brandSlug: string,
	jobId: string,
	signal?: AbortSignal
): Promise<DesignerJobPayload | null> {
	const res = await fetch(`/app/${brandSlug}/designer-job?id=${encodeURIComponent(jobId)}`, {
		signal
	});
	if (!res.ok) return null;
	const body = (await res.json()) as { job?: DesignerJobPayload | null };
	return body.job ?? null;
}

/**
 * Poll `jobId` (and any continuation_job_id chain) until every job is terminal.
 * `onState` receives the merged transcript so the overlay keeps moving like chat.
 */
export async function followDesignerJobChain(opts: {
	brandSlug: string;
	jobId: string;
	signal?: AbortSignal;
	seed?: ChatStreamState;
	onState: (state: ChatStreamState) => void;
	onMediaTick?: () => void;
}): Promise<{ state: ChatStreamState; error?: string }> {
	const FAST_MS = 350;
	const deadline = Date.now() + DESIGNER_FOLLOW_MS;
	let currentId: string | null = opts.jobId;
	const prefix = opts.seed ?? emptyStreamState();
	let prefixText = prefix.text;
	let prefixTools = [...prefix.tools];
	let prefixReasoning = prefix.reasoning;
	let mediaTick = 0;

	let isFirst = true;

	while (currentId && Date.now() < deadline) {
		if (opts.signal?.aborted) break;
		let quiet = 0;
		let terminal: DesignerJobPayload | null = null;

		while (Date.now() < deadline) {
			if (opts.signal?.aborted) break;
			try {
				const job = await fetchDesignerJob(opts.brandSlug, currentId, opts.signal);
				if (job) {
					const text = String(job.partial?.text ?? '');
					const tools = Array.isArray(job.partial?.tools) ? job.partial!.tools! : [];
					const reasoning = String(job.partial?.reasoning ?? '');
					const merged: ChatStreamState = isFirst
						? {
								text: text.length >= prefixText.length ? text : prefixText,
								tools: tools.length >= prefixTools.length ? tools : prefixTools,
								reasoning:
									reasoning.length >= prefixReasoning.length ? reasoning : prefixReasoning,
								failed: job.status === 'failed'
							}
						: {
								text: prefixText + text,
								tools: [...prefixTools, ...offsetTools(tools, prefixText.length)],
								reasoning: prefixReasoning + (reasoning === '\u200b' ? '' : reasoning),
								failed: job.status === 'failed'
							};
					const advanced =
						merged.text.length > prefixText.length ||
						merged.tools.length > prefixTools.length ||
						merged.reasoning.length > prefixReasoning.length;
					quiet = advanced ? 0 : quiet + 1;
					opts.onState(merged);
					if (advanced && opts.onMediaTick && Date.now() - mediaTick > 8000) {
						mediaTick = Date.now();
						opts.onMediaTick();
					}
					if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
						terminal = job;
						prefixText = merged.text;
						prefixTools = merged.tools;
						prefixReasoning = merged.reasoning;
						isFirst = false;
						if (job.status === 'failed') {
							return { state: merged, error: job.error || 'job_failed' };
						}
						break;
					}
				}
			} catch (e) {
				if ((e as Error)?.name === 'AbortError') {
					return {
						state: {
							text: prefixText,
							tools: prefixTools,
							reasoning: prefixReasoning,
							failed: false
						}
					};
				}
			}
			const delay = quiet < 3 ? FAST_MS : quiet < 12 ? 1000 : 2500;
			await new Promise((r) => setTimeout(r, delay));
		}

		const next = terminal?.result?.continuation_job_id?.trim() || null;
		currentId = next && next !== currentId ? next : null;
	}

	return {
		state: {
			text: prefixText,
			tools: prefixTools,
			reasoning: prefixReasoning,
			failed: false
		}
	};
}
