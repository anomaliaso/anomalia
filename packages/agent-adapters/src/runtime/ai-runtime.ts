import { tool, jsonSchema, type JSONSchema7, type ToolSet } from 'ai';
import { gateAction, type ActionGateResult } from '@anomalia/agent-kit/action-approval';
import type { ActionApprovalConfig, AdapterContext, ToolCall, ToolResult, ToolSpec } from '@anomalia/agent-kit/types';

export type ExecToolCall = (call: ToolCall, context: AdapterContext) => Promise<ToolResult>;

function toModelContent(content: ToolResult['content']) {
	// Un plugin può rispondere senza `content` (o con l'output interamente assente): qui muore
	// il turno INTERO — «reading 'map'» nella conversione al prossimo step, run inchiodato su
	// `running` fino al reaper. Il modello vede testo vuoto, che è esattamente ciò che è.
	return (content ?? []).map((item) =>
		item.type === 'text'
			? { type: 'text' as const, text: item.text }
			: { type: 'media' as const, data: item.base64, mediaType: item.mimeType }
	);
}

function toModelOutput(args: { output?: ToolResult }) {
	const output = args?.output;
	if (!output) return { type: 'content' as const, value: [] };
	const value = toModelContent(output.content);
	return output.isError ? ({ type: 'error-json' as const, value: { content: value } }) : ({ type: 'content' as const, value });
}

function approvalError(name: string, reason?: string): ToolResult {
	return {
		content: [{ type: 'text', text: `${name}: ${reason ?? 'human approval required'}` }],
		isError: true
	};
}

export function buildTools(
	specs: ToolSpec[],
	execToolCall: ExecToolCall,
	context: AdapterContext,
	approval?: ActionApprovalConfig
): ToolSet {
	const tools: ToolSet = {};
	for (const spec of specs) {
		const approvalResults = new Map<string, ActionGateResult>();
		const approvalFor = async (input: Record<string, unknown>, toolCallId?: string) => {
			if (!approval) return spec.consequential;
			const result = await gateAction({
				spec,
				call: { name: spec.name, args: input ?? {}, ...(toolCallId ? { id: toolCallId } : {}) },
				context,
				config: approval
			});
			if (toolCallId) approvalResults.set(toolCallId, result);
			return result.source === 'rule' || result.source === 'judge-ask';
		};
		const execute = async (input: Record<string, unknown>, options?: { toolCallId?: string }) => {
			const call: ToolCall = {
				name: spec.name,
				args: input ?? {},
				...(options?.toolCallId ? { id: options.toolCallId } : {})
			};
			if (approval) {
				const cached = options?.toolCallId ? approvalResults.get(options.toolCallId) : undefined;
				if (options?.toolCallId) approvalResults.delete(options.toolCallId);
				const gate = cached ?? (await gateAction({ spec, call, context, config: approval }));
				if (gate.decision === 'ask' && (!cached || gate.source === 'judge-error')) {
					return approvalError(spec.name, gate.reason);
				}
			}
			return execToolCall(call, context);
		};
		tools[spec.name] = spec.terminal
			? tool({
					description: spec.description,
					inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema as JSONSchema7)
				})
				: tool({
					description: spec.description,
					inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema as JSONSchema7),
					needsApproval: (input: Record<string, unknown>, options: { toolCallId: string }) =>
						approvalFor(input, options.toolCallId),
					execute,
					toModelOutput
				});
	}
	return tools;
}
