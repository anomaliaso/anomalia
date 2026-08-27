import { generateText, type LanguageModel } from 'ai';

export type TranscriptEvent =
	| { kind: 'user' | 'assistant' | 'system'; text: string }
	| { kind: 'tool'; name: string; input?: unknown; output?: unknown; failed?: boolean }
	| { kind: 'run'; state: string; reason?: string | null };

export type TranscriptAnswer = { question: string; answer: boolean; reason: string };

export type TranscriptVerdict = {
	passed: boolean;
	answers: TranscriptAnswer[];
	usage?: { inputTokens?: number; outputTokens?: number };
};

export function formatTranscript(events: TranscriptEvent[]): string {
	return events
		.map((e) => {
			if (e.kind === 'tool') {
				const outcome = e.failed ? 'FAILED' : 'ok';
				return `[tool ${e.name}] input=${JSON.stringify(e.input ?? null)} -> ${outcome}: ${JSON.stringify(e.output ?? null)}`;
			}
			if (e.kind === 'run') return `[run ${e.state}${e.reason ? ` (${e.reason})` : ''}]`;
			return `${e.kind}: ${e.text}`;
		})
		.join('\n');
}

export async function judgeTranscript(opts: {
	model: LanguageModel;
	transcript: string | TranscriptEvent[];
	questions: string[];
}): Promise<TranscriptVerdict> {
	const transcript =
		typeof opts.transcript === 'string' ? opts.transcript : formatTranscript(opts.transcript);
	const { text, usage } = await generateText({
		model: opts.model,
		system:
			'You review the complete transcript of an AI agent session and answer closed questions about how it went. ' +
			'Judge only from the transcript. Reply with STRICT JSON only: an array of ' +
			'{"question": string, "answer": boolean, "reason": "<one line>"} — one item per question, in the given order.',
		prompt: `TRANSCRIPT:\n${transcript}\n\nQUESTIONS:\n${opts.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
	});
	const start = text.indexOf('[');
	const end = text.lastIndexOf(']');
	if (start < 0 || end <= start) throw new Error('transcript judge: no JSON array in verdict');
	const answers = JSON.parse(text.slice(start, end + 1)) as TranscriptAnswer[];
	const wellFormed =
		Array.isArray(answers) &&
		answers.length === opts.questions.length &&
		answers.every((a) => typeof a.answer === 'boolean');
	if (!wellFormed) {
		throw new Error(`transcript judge: expected ${opts.questions.length} boolean answers`);
	}
	return { passed: answers.every((a) => a.answer), answers, usage };
}
