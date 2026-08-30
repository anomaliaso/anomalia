import type { ModelMessage } from 'ai';

export type ToolApproval = {
	approvalId: string;
	toolCallId: string;
	toolName: string;
	input: unknown;
	reason?: string;
};

export function findToolApproval(steps: readonly unknown[]): ToolApproval | null {
	const calls = new Map<string, { toolName: string; input: unknown }>();
	for (const step of steps) {
		const value = step as { content?: unknown; toolCalls?: unknown };
		for (const part of partsOf(value.content)) {
			if (part.type === 'tool-call' && typeof part.toolCallId === 'string' && typeof part.toolName === 'string') {
				calls.set(part.toolCallId, { toolName: part.toolName, input: part.input });
			}
		}
		for (const call of Array.isArray(value.toolCalls) ? value.toolCalls : []) {
			const part = call as Record<string, unknown>;
			if (typeof part.toolCallId === 'string' && typeof part.toolName === 'string') {
				calls.set(part.toolCallId, { toolName: part.toolName, input: part.input });
			}
		}
	}

	for (const step of steps) {
		for (const part of partsOf((step as { content?: unknown }).content)) {
			if (part.type !== 'tool-approval-request' || typeof part.approvalId !== 'string' || typeof part.toolCallId !== 'string') continue;
			const call = calls.get(part.toolCallId);
			if (!call) continue;
			return {
				approvalId: part.approvalId,
				toolCallId: part.toolCallId,
				toolName: call.toolName,
				input: call.input,
				...(typeof part.reason === 'string' ? { reason: part.reason } : {})
			};
		}
	}
	return null;
}

export function approvalMessageParts(approval: ToolApproval): unknown[] {
	return [
		{ type: 'tool-call', toolCallId: approval.toolCallId, toolName: approval.toolName, input: approval.input },
		{ type: 'tool-approval-request', approvalId: approval.approvalId, toolCallId: approval.toolCallId }
	];
}

export function approvalContinuationMessage(input: {
	approvalId: string;
	approved: boolean;
	reason?: string;
}): ModelMessage {
	return {
		role: 'tool',
		content: [
			{
				type: 'tool-approval-response',
				approvalId: input.approvalId,
				approved: input.approved,
				...(input.reason ? { reason: input.reason } : {})
			} as never
		]
	};
}

function partsOf(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter((part): part is Record<string, unknown> => !!part && typeof part === 'object') : [];
}
