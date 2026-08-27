import { hasToolCall } from 'ai';
import { HarnessAgent } from '@ai-sdk/harness/agent';
import { createPi, type PiHarnessSettings } from '@ai-sdk/harness-pi';
import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { createJustBashSandbox } from '@ai-sdk/sandbox-just-bash';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';
import type { AgentRuntime } from '@anomalia/agent-kit/interfaces';
import { buildTools, type ExecToolCall } from './ai-runtime';
import type {
	AdapterContext,
	AdapterDescriptor,
	RunEvent,
	RunRequest,
	RunStopReason,
	RunTokenUsage
} from '@anomalia/agent-kit/types';

type StreamPart = {
	type: string;
	text?: string;
	toolCallId?: string;
	toolName?: string;
	input?: unknown;
	output?: unknown;
	error?: unknown;
};

export interface HarnessStreamHandle {
	fullStream: AsyncIterable<StreamPart>;
}

export interface HarnessSessionLike {
	destroy(): Promise<unknown>;
}

export interface HarnessAgentLike {
	createSession(options?: { sessionId?: string }): Promise<HarnessSessionLike>;
	stream(input: { session: unknown; messages: unknown }): Promise<HarnessStreamHandle>;
}

export type CreateHarnessAgent = (settings: Record<string, unknown>) => HarnessAgentLike;

export interface TurnDeadlineState {
	reached: () => boolean;
	readonly expired: boolean;
}

export interface HarnessRuntimeDeps {
	agentDir?: string;
	execToolCall: ExecToolCall;
	sandboxProvider: unknown;
	createAgent?: CreateHarnessAgent;
	chatTurnDeadline?: (startedAt: number, budgetMs?: number) => TurnDeadlineState;
}

type PiExtensionFactory = NonNullable<PiHarnessSettings['extensionFactories']>[number];

export function stickySessionExtension(value: string): PiExtensionFactory {
	return (pi) => {
		pi.on('before_provider_headers', (event) => {
			event.headers['x-session-id'] = value;
		});
	};
}

export const HARNESS_SETUPS: Record<
	string,
	{ harness: (modelId?: string, agentDir?: string, settings?: Partial<PiHarnessSettings>) => unknown; sandbox: () => unknown }
> = {
	pi: {
		harness: (modelId, agentDir, settings) =>
			createPi({ auth: 'ai-gateway', ...(modelId ? { model: modelId } : {}), ...settings }),
		sandbox: () => createJustBashSandbox()
	},
	kie: {
		harness: (modelId, agentDir, settings) =>
			createPi({ ...(agentDir ? { agentDir } : {}), ...(modelId ? { model: modelId } : {}), ...settings }),
		sandbox: () => createJustBashSandbox()
	},
	custom: {
		harness: (modelId, agentDir, settings) =>
			createPi({ ...(agentDir ? { agentDir } : {}), ...(modelId ? { model: modelId } : {}), ...settings }),
		sandbox: () => createJustBashSandbox()
	},
	'claude-code': {
		harness: (modelId) => createClaudeCode(modelId ? { model: modelId } : {}),
		sandbox: () => createVercelSandbox({ runtime: 'node24' })
	}
};

const DEFAULT_PROVIDER = 'pi';

function toRunEvent(part: StreamPart): RunEvent | null {
	switch (part.type) {
		case 'text-delta':
			return { type: 'text', text: part.text ?? '' };
		case 'reasoning-delta':
			return { type: 'reasoning', text: part.text ?? '' };
		case 'tool-call':
			return {
				type: 'tool_call',
				id: part.toolCallId ?? '',
				call: { name: part.toolName ?? '', args: (part.input ?? {}) as Record<string, unknown> }
			};
		case 'tool-result':
			return {
				type: 'tool_result',
				id: part.toolCallId ?? '',
				result: part.output as Extract<RunEvent, { type: 'tool_result' }>['result']
			};
		case 'tool-error':
			return {
				type: 'tool_result',
				id: part.toolCallId ?? '',
				result: {
					content: [{ type: 'text', text: errorMessage(part.error) }],
					isError: true
				}
			};
		case 'error':
			return { type: 'error', message: errorMessage(part.error) };
		case 'finish':
		case 'finish-step':
			return null;
		default:
			return {
				type: 'error',
				message: `RAW ${part.type} ${JSON.stringify(part).slice(0, 300)}`
			};
	}
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function stopReason(input: {
	aborted: boolean;
	stepsCount: number;
	maxSteps: number;
	deadlineExpired: boolean;
}): RunStopReason {
	if (input.aborted) return 'aborted';
	if (input.deadlineExpired) return 'deadline';
	if (input.stepsCount >= input.maxSteps) return 'step_limit';
	return 'completed';
}

export class HarnessRuntime implements AgentRuntime {
	private readonly controllers = new Map<string, AbortController>();
	private readonly sessions = new Map<string, HarnessSessionLike>();

	constructor(private readonly deps: HarnessRuntimeDeps) {}

	describe(): AdapterDescriptor<{ streaming: boolean; tools: boolean }> {
		return { id: 'harness-runtime', adapterVersion: '0.1.0', capabilities: { streaming: true, tools: true } };
	}

	async abort(runId: string): Promise<void> {
		this.controllers.get(runId)?.abort();
	}

	async *run(request: RunRequest, context: AdapterContext): AsyncIterable<RunEvent> {
		const controller = new AbortController();
		this.controllers.set(request.runId, controller);
		const abortSignal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;

		const deadline = this.deps.chatTurnDeadline?.(Date.now(), request.limits.deadlineMs);
		const agent = await this.agentFor(request, context);
		let session: HarnessSessionLike | null = null;
		let aborted = false;
		let usage: RunTokenUsage | undefined;
		let stepsCount = 0;

		try {
			const key = context.sessionKey;
			session = key ? this.sessions.get(key) ?? null : null;
			if (!session) {
				session = await agent.createSession({ sessionId: request.runId });
				if (key) this.sessions.set(key, session);
			}
			const result = await agent.stream({ session, messages: request.messages });

			for await (const part of result.fullStream) {
				if (part.type === 'finish-step') stepsCount += 1;
				if (part.type === 'finish') {
					const u = (part as { totalUsage?: { inputTokens?: number; outputTokens?: number } }).totalUsage;
					if (u) usage = { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 };
					continue;
				}
				const event = toRunEvent(part);
				if (event) yield event;
				if (deadline?.reached()) break;
			}

			yield {
				type: 'done',
				reason: stopReason({
					aborted,
					stepsCount,
					maxSteps: request.limits.maxSteps,
					deadlineExpired: deadline?.expired ?? false
				}),
				usage
			};
		} catch (err) {
			if (context.sessionKey) this.sessions.delete(context.sessionKey);
			if (abortSignal.aborted || /abort/i.test(errorMessage(err))) {
				yield { type: 'done', reason: 'aborted' };
			} else {
				yield { type: 'error', message: errorMessage(err) };
			}
		} finally {
			this.controllers.delete(request.runId);
			const reused = context.sessionKey && this.sessions.get(context.sessionKey) === session;
			if (!reused) await session?.destroy().catch(() => undefined);
		}
	}

	private async agentFor(request: RunRequest, context: AdapterContext): Promise<HarnessAgentLike> {
		const settings = this.settingsFor(request, context);
		if (this.deps.createAgent) return this.deps.createAgent(settings);
		return new HarnessAgent(settings as never) as unknown as HarnessAgentLike;
	}

	private settingsFor(request: RunRequest, context: AdapterContext): Record<string, unknown> {
				const known = HARNESS_SETUPS[request.model.provider];
		const setup = known ?? (this.deps.agentDir ? HARNESS_SETUPS.custom : HARNESS_SETUPS[DEFAULT_PROVIDER]);
		return {
			harness: setup.harness(request.model.id),
			sandbox: this.deps.sandboxProvider ?? setup.sandbox(),
			instructions: request.system,
			tools: buildTools(request.tools, this.deps.execToolCall, context),
			stopWhen: request.tools.filter((tool) => tool.terminal).map((tool) => hasToolCall(tool.name))
		};
	}
}
