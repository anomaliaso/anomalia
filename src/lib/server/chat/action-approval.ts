import { env } from '$env/dynamic/private';
import { type ModelMessage } from 'ai';
import type { ActionApprovalConfig } from '@anomalia/agent-kit/types';
import { logAiCall } from '$lib/server/ai-log';
import { compactionModel } from './model';
import { judgeTranscript } from '$lib/server/eval/transcript-judge';

const QUESTIONS = [
	'Answer true ONLY if the user did not ask for this exact action anywhere in the conversation.',
	'Answer true ONLY if the action target or scope is wider or different from what the user asked for.'
];
const MAX_TRANSCRIPT_CHARS = 6_000;

type ActionApprovalInput = {
	messages: readonly ModelMessage[];
	brandId: string;
	userId: string;
	threadId: string;
};

function transcriptOf(messages: readonly ModelMessage[], toolName: string, args: Record<string, unknown>): string {
	const history = messages
		.slice(-12)
		.map((message) => `${message.role}: ${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`)
		.join('\n');
	return `${history}\n[proposed tool] ${toolName} input=${JSON.stringify(args)}`.slice(-MAX_TRANSCRIPT_CHARS);
}

export function createChatActionApproval(input: ActionApprovalInput): ActionApprovalConfig | undefined {
	if (env.CHAT_ACTION_JUDGE !== 'on') return undefined;

	const model = compactionModel();
	return {
		autoReviewEnabled: true,
		checker: async ({ spec, call, context }) => {
			const startedAt = Date.now();
			if (!model) {
				logAiCall({
					label: 'chatActionJudge',
					provider: 'none',
					model: 'none',
					ms: Date.now() - startedAt,
					ok: false,
					brandId: input.brandId,
					userId: input.userId,
					threadId: input.threadId,
					context: `tool=${spec.name}:no-model`
				});
				return 'error';
			}

			try {
				const result = await judgeTranscript({
					model: model.model,
					transcript: transcriptOf(input.messages, call.name, call.args),
					questions: QUESTIONS
				});
				const decision = result.answers.some((answer) => answer.answer) ? 'ask' : 'pass';
				logAiCall({
					label: 'chatActionJudge',
					provider: model.provider,
					model: model.modelId,
					ms: Date.now() - startedAt,
					ok: true,
					inputTokens: result.usage?.inputTokens,
					outputTokens: result.usage?.outputTokens,
					brandId: context.brandId,
					userId: context.userId ?? input.userId,
					threadId: input.threadId,
					context: `tool=${spec.name}:${decision}`
				});
				return decision;
			} catch {
				logAiCall({
					label: 'chatActionJudge',
					provider: model.provider,
					model: model.modelId,
					ms: Date.now() - startedAt,
					ok: false,
					brandId: context.brandId,
					userId: context.userId ?? input.userId,
					threadId: input.threadId,
					context: `tool=${spec.name}:error`
				});
				return 'error';
			}
		}
	};
}
