import type { HarnessSession } from './session';

/**
 * Tool pipeline: wrap execute() so every call is logged, without changing tool schemas or
 * stop conditions. Optional before/after hooks are the compositional seam for policy later;
 * agents today pass none, so behaviour is identical besides the session log.
 */

export type ToolBeforeHook = (ctx: {
	name: string;
	input: unknown;
}) =>
	| Promise<{ deny?: string; result?: unknown } | void>
	| { deny?: string; result?: unknown }
	| void;

export type ToolAfterHook = (ctx: {
	name: string;
	input: unknown;
	output: unknown;
}) => Promise<unknown | void> | unknown | void;

export type ToolPipeline = {
	before?: ToolBeforeHook[];
	after?: ToolAfterHook[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = { execute?: (...args: any[]) => any; [k: string]: unknown };

type WrappedTool<T> = T extends { execute: (...args: never[]) => unknown }
	? Omit<T, 'execute'> & { execute: (input: unknown, opts: unknown) => Promise<unknown> }
	: T;

export type WrappedTools<T> = T extends undefined
	? T
	: { [K in keyof T]: WrappedTool<T[K]> };

export function wrapTools<T extends Record<string, unknown> | undefined>(
	session: HarnessSession,
	tools: T,
	pipeline?: ToolPipeline
): WrappedTools<T> {
	if (!tools) return tools as WrappedTools<T>;
	const out: Record<string, unknown> = {};
	for (const [name, raw] of Object.entries(tools)) {
		const tool = raw as AnyTool | undefined;
		if (!tool || typeof tool.execute !== 'function') {
			out[name] = raw;
			continue;
		}
		const original = tool.execute.bind(tool);
		out[name] = {
			...tool,
			execute: async (input: unknown, opts: unknown) => {
				session.recordToolCall(name, input);
				const t0 = Date.now();
				try {
					for (const hook of pipeline?.before ?? []) {
						const gate = await hook({ name, input });
						if (gate?.deny) {
							const denied = gate.result !== undefined ? gate.result : { error: gate.deny };
							session.recordToolResult(name, denied, Date.now() - t0, true);
							return denied;
						}
					}
					let result = await original(input, opts);
					for (const hook of pipeline?.after ?? []) {
						const next = await hook({ name, input, output: result });
						if (next !== undefined) result = next;
					}
					session.recordToolResult(name, result, Date.now() - t0, true);
					return result;
				} catch (e) {
					session.recordToolResult(
						name,
						undefined,
						Date.now() - t0,
						false,
						e instanceof Error ? e.message : String(e)
					);
					throw e;
				}
			}
		};
	}
	return out as WrappedTools<T>;
}
