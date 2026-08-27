import { tool, jsonSchema, type JSONSchema7, type ToolSet } from 'ai';
import type { AdapterContext, ToolCall, ToolResult, ToolSpec } from '@anomalia/agent-kit/types';

export type ExecToolCall = (call: ToolCall, context: AdapterContext) => Promise<ToolResult>;

function toModelContent(content: ToolResult['content']) {
	return content.map((item) =>
		item.type === 'text'
			? { type: 'text' as const, text: item.text }
			: { type: 'media' as const, data: item.base64, mediaType: item.mimeType }
	);
}

function toModelOutput({ output }: { output: ToolResult }) {
	const value = toModelContent(output.content);
	return output.isError ? ({ type: 'error-json' as const, value: { content: value } }) : ({ type: 'content' as const, value });
}

export function buildTools(specs: ToolSpec[], execToolCall: ExecToolCall, context: AdapterContext): ToolSet {
	const tools: ToolSet = {};
	for (const spec of specs) {
		tools[spec.name] = spec.terminal
			? tool({
					description: spec.description,
					inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema as JSONSchema7)
				})
			: tool({
					description: spec.description,
					inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema as JSONSchema7),
					execute: async (input: Record<string, unknown>, options) =>
						execToolCall(
							{
								name: spec.name,
								args: input ?? {},
								...(options?.toolCallId ? { id: options.toolCallId } : {})
							},
							context
						),
					toModelOutput
				});
	}
	return tools;
}
