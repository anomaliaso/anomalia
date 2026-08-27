/**
 * Independent anti-loop for chat turns.
 *
 * Step count and wall-clock caps are coarse. This watches what the model actually does: after
 * every step we fingerprint the tool calls (+ a short text slice) and stop when the recent
 * window is stuck — either N identical steps in a row, or a tight A↔B oscillation.
 *
 * When this fires, do NOT auto-continue the turn: continuing would resume the same loop.
 */

import { bilingualNoticeLocale } from '$lib/i18n/locale';

export const CHAT_LOOP_THRESHOLD = 5;
export const TOOL_BENCH_FAILURES = 2;

export type BenchedTool = { toolName: string; detail: string };

export type ChatLoopGuard = {
	/** Call from `onStepFinish` with that step's tool calls + assistant text. */
	recordStep: (toolCalls: Array<{ toolName: string; input?: unknown }> | undefined, text?: string) => void;
	/** Call from `onStepFinish` with that step's `content` parts. */
	recordToolFailures: (stepContent: unknown) => void;
	/** Tools that failed `TOOL_BENCH_FAILURES` times with the same arguments this turn. */
	benchedTools: () => BenchedTool[];
	/** `stopWhen` predicate — true once a loop has been detected. */
	reached: () => boolean;
	/** Latched after `reached()` first returns true. */
	readonly stalled: boolean;
};

export function chatStepFingerprint(
	toolCalls: Array<{ toolName: string; input?: unknown }> | undefined,
	text?: string
): string {
	const calls = (toolCalls ?? []).map((tc) => {
		let input = '';
		try {
			input = JSON.stringify(tc.input ?? null);
		} catch {
			input = '[unserializable]';
		}
		// Cap so huge payloads don't make every call unique and disable the detector.
		return `${tc.toolName}:${input.slice(0, 300)}`;
	});
	return JSON.stringify({
		calls,
		text: String(text ?? '')
			.trim()
			.slice(0, 120)
	});
}

/** Last `threshold` fingerprints identical. */
export function identicalTail(fingerprints: string[], threshold: number): boolean {
	if (fingerprints.length < threshold) return false;
	const tail = fingerprints.slice(-threshold);
	return tail.every((f) => f === tail[0]);
}

/** Tight A↔B oscillation over `threshold` pairs (2×threshold fingerprints). */
export function oscillatingTail(fingerprints: string[], threshold: number): boolean {
	const need = threshold * 2;
	if (fingerprints.length < need) return false;
	const tail = fingerprints.slice(-need);
	const a = tail[0];
	const b = tail[1];
	if (!a || !b || a === b) return false;
	return tail.every((f, i) => f === (i % 2 === 0 ? a : b));
}

export function chatLoopDetected(
	fingerprints: string[],
	threshold: number = CHAT_LOOP_THRESHOLD
): boolean {
	return identicalTail(fingerprints, threshold) || oscillatingTail(fingerprints, threshold);
}

type FailedToolCall = { toolName: string; input?: unknown; detail: string };

function failureDetail(output: unknown): string | null {
	if (!output || typeof output !== 'object') return null;
	const o = output as { isError?: boolean; error?: unknown; content?: Array<{ type?: string; text?: string }> };
	if (o.isError === true) {
		const text = Array.isArray(o.content)
			? o.content
					.filter((c) => c?.type === 'text')
					.map((c) => c.text ?? '')
					.join(' ')
					.trim()
			: '';
		return text || 'error';
	}
	if (o.error != null) return typeof o.error === 'string' ? o.error : JSON.stringify(o.error);
	return null;
}

export function failedToolCalls(stepContent: unknown): FailedToolCall[] {
	if (!Array.isArray(stepContent)) return [];
	const out: FailedToolCall[] = [];
	for (const p of stepContent) {
		if (!p || typeof p !== 'object') continue;
		const part = p as { type?: string; toolName?: string; input?: unknown; error?: unknown; output?: unknown };
		if (!part.toolName) continue;
		if (part.type === 'tool-error') {
			const detail = part.error instanceof Error ? part.error.message : String(part.error ?? 'error');
			out.push({ toolName: part.toolName, input: part.input, detail });
			continue;
		}
		if (part.type !== 'tool-result') continue;
		const detail = failureDetail(part.output);
		if (detail != null) out.push({ toolName: part.toolName, input: part.input, detail });
	}
	return out;
}

export function createChatLoopGuard(threshold: number = CHAT_LOOP_THRESHOLD): ChatLoopGuard {
	const fingerprints: string[] = [];
	const failureCounts = new Map<string, number>();
	const benched = new Map<string, string>();
	let stalled = false;
	return {
		recordStep(toolCalls, text) {
			fingerprints.push(chatStepFingerprint(toolCalls, text));
			// Bound memory on very long turns.
			if (fingerprints.length > threshold * 8) fingerprints.splice(0, fingerprints.length - threshold * 4);
			if (chatLoopDetected(fingerprints, threshold)) stalled = true;
		},
		recordToolFailures(stepContent) {
			for (const failed of failedToolCalls(stepContent)) {
				const key = chatStepFingerprint([{ toolName: failed.toolName, input: failed.input }]);
				const count = (failureCounts.get(key) ?? 0) + 1;
				failureCounts.set(key, count);
				if (count >= TOOL_BENCH_FAILURES) benched.set(failed.toolName, failed.detail);
			}
		},
		benchedTools: () => [...benched].map(([toolName, detail]) => ({ toolName, detail })),
		reached: () => stalled || chatLoopDetected(fingerprints, threshold),
		get stalled() {
			return stalled;
		}
	};
}

const BENCH_DETAIL_MAX_CHARS = 300;

export function toolBenchNotice(toolName: string, detail: string, locale: string): string {
	const why = detail.slice(0, BENCH_DETAIL_MAX_CHARS);
	if (bilingualNoticeLocale(locale) === 'en') {
		return `The tool "${toolName}" has been removed for the rest of this turn: it failed ${TOOL_BENCH_FAILURES} times with the same arguments (${why}). Do not try it again — take a different route, or tell the user honestly what is missing.`;
	}
	return `Lo strumento "${toolName}" è stato tolto dal tavolo per il resto di questo turno: ha fallito ${TOOL_BENCH_FAILURES} volte con gli stessi argomenti (${why}). Non riprovarlo — cambia strada, oppure di' onestamente all'utente cosa manca.`;
}

type PrepareStepPatch<M> = { messages?: M[]; activeTools?: string[] } & Record<string, unknown>;

export function benchAwarePrepareStep<M>(
	guard: ChatLoopGuard,
	toolNames: string[],
	locale: string,
	inner?: (args: { messages?: M[] }) => Promise<PrepareStepPatch<M> | undefined> | PrepareStepPatch<M> | undefined
): (args: { messages?: M[] }) => Promise<PrepareStepPatch<M>> {
	const announced = new Set<string>();
	return async (args) => {
		const base = (await inner?.(args)) ?? {};
		const benched = guard.benchedTools();
		if (!benched.length) return base;
		const active = toolNames.filter((name) => !benched.some((b) => b.toolName === name));
		const out = active.length ? { ...base, activeTools: active } : base;
		const fresh = benched.filter((b) => !announced.has(b.toolName));
		if (!fresh.length) return out;
		for (const b of fresh) announced.add(b.toolName);
		const messages = base.messages ?? args.messages;
		if (!messages) return out;
		const notice = fresh.map((b) => toolBenchNotice(b.toolName, b.detail, locale)).join('\n');
		return { ...out, messages: [...messages, { role: 'user', content: notice } as M] };
	};
}

const REPEATED_REPLY_MIN_CHARS = 40;
const REPEATED_REPLY_PREFIX_RATIO = 0.9;

export function isRepeatedReply(current: string, previous: string | null | undefined): boolean {
	const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
	const a = norm(current);
	const b = norm(previous ?? '');
	if (!a || !b || a.length < REPEATED_REPLY_MIN_CHARS) return false;
	if (a === b) return true;
	const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
	return longer.startsWith(shorter) && shorter.length / longer.length >= REPEATED_REPLY_PREFIX_RATIO;
}

export function repeatedReplyContinuation(locale: string): string {
	if (bilingualNoticeLocale(locale) === 'en') {
		return 'Your last reply was identical to your previous one and you executed NO tools this turn: the work you claim does not exist. Do not repeat that text. Either do the work NOW by calling the tools, or use ask_user to ask what is missing.';
	}
	return 'La tua ultima risposta è identica alla precedente e in questo turno non hai eseguito NESSUNO strumento: il lavoro che dichiari non esiste. Non ripetere quel testo. O esegui ADESSO il lavoro chiamando gli strumenti, oppure usa ask_user per chiedere cosa ti manca.';
}

export function repeatedReplyNotice(locale: string): string {
	if (bilingualNoticeLocale(locale) === 'en') {
		return "I keep producing the same reply without doing any new work — what I claimed does not exist. I'm stopping instead of repeating myself: tell me what you expected to see and I'll do it for real, step by step.";
	}
	return 'Mi sto ripetendo: stavo per riscriverti la stessa risposta senza aver fatto alcun lavoro nuovo — quello che dichiaravo non esiste. Mi fermo invece di ripetermi: dimmi cosa ti aspettavi di vedere e lo faccio davvero, un passo alla volta.';
}

/** Closing line when the turn stopped because the agent was looping. Never promises auto-continue. */
export function turnLoopNotice(locale: string): string {
	if (bilingualNoticeLocale(locale) === 'en') {
		return '\n\n_Stopped — I was repeating the same steps without progress. Everything above is saved; tell me how you want to continue._';
	}
	return '\n\n_Mi fermo — stavo ripetendo gli stessi passi senza avanzare. Tutto quello sopra è salvato; dimmi come vuoi continuare._';
}
