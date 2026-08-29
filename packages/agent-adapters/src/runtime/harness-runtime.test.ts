import { describe, expect, it } from 'vitest';
import { HarnessRuntime } from './harness-runtime';
import type { AdapterContext, RunEvent, RunRequest, ToolSpec } from '@anomalia/agent-kit/types';

const ctx: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'en' };

const spec: ToolSpec = {
	name: 'publish_post',
	description: 'publish',
	consequential: true,
	inputSchema: { type: 'object', properties: {} }
};

function request(overrides?: Partial<RunRequest>): RunRequest {
	return {
		runId: 'r1',
		system: 'you make content',
		messages: [{ role: 'user', content: 'ciao' }],
		tools: [spec],
		model: { provider: 'pi', id: 'claude-sonnet-5' },
		limits: { maxSteps: 20, tokenBudget: 1000, deadlineMs: 60_000 },
		...overrides
	};
}

type FakePart = { type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown };

function fakeAgent(parts: FakePart[]) {
	const seen: {
		sessionId?: string;
		destroyed: boolean;
	} = { destroyed: false };
	const agent = {
		seen,
		settings: null as unknown,
		createSession: async (opts?: { sessionId?: string }) => {
			seen.sessionId = opts?.sessionId;
			return {
				async destroy() {
					seen.destroyed = true;
				}
			};
		},
		stream: async (input: { session: unknown }) => {
			void input;
			return {
				fullStream: (async function* () {
					for (const part of parts) {
						if (part.type === '__abort__') throw new Error('Request aborted');
						yield part;
					}
				})()
			};
		}
	};
	return { agent, seen };
}

describe('HarnessRuntime', () => {
	it('dichiara streaming e tool come l’altro runtime', () => {
		const { agent } = fakeAgent([]);
		const runtime = new HarnessRuntime({
			execToolCall: async () => ({ content: [] }),
			sandboxProvider: {} as never,
			createAgent: () => agent
		});
		expect(runtime.describe().capabilities).toEqual({ streaming: true, tools: true });
	});

	it('passa sistema e tool all’harness e mappa gli eventi del turno', async () => {
		const { agent, seen } = fakeAgent([
			{ type: 'text-delta', text: 'ciao' },
			{ type: 'tool-call', toolCallId: 't1', toolName: 'publish_post', input: { id: 1 } },
			{ type: 'tool-result', toolCallId: 't1', output: { content: [{ type: 'text', text: 'ok' }] } },
			{ type: 'finish-step' }
		]);
		const runtime = new HarnessRuntime({
			execToolCall: async () => ({ content: [{ type: 'text', text: 'eseguito' }] }),
			sandboxProvider: {} as never,
			createAgent: (settings) => {
				agent.settings = settings;
				return agent;
			}
		});

		const events: RunEvent[] = [];
		for await (const event of runtime.run(request(), ctx)) events.push(event);

		const settings = agent.settings as {
			instructions?: string;
			stopWhen?: unknown[];
		};
		expect(settings.instructions).toBe('you make content');
		expect(Object.keys(settings as object)).toContain('tools');

		expect(events.some((e) => e.type === 'text' && e.text === 'ciao')).toBe(true);
		const call = events.find((e) => e.type === 'tool_call');
		expect(call && call.type === 'tool_call' && call.call.name).toBe('publish_post');
		const done = events.at(-1);
		expect(done).toMatchObject({ type: 'done', reason: 'completed' });
		expect(seen.sessionId).toBe('r1');
		expect(seen.destroyed).toBe(true);
	});

	it('un tool terminale entra tra le condizioni di stop', async () => {
		const { agent, seen } = fakeAgent([{ type: 'finish-step' }]);
		const runtime = new HarnessRuntime({
			execToolCall: async () => ({ content: [] }),
			sandboxProvider: {} as never,
			createAgent: (settings) => {
				agent.settings = settings;
				return agent;
			}
		});
		const terminal: RunRequest = request({ tools: [{ ...spec, terminal: true }] });
		const iterator = runtime.run(terminal, ctx);
		while (!(await iterator.next()).done) void 0;

		const settings = agent.settings as { stopWhen?: unknown[] };
		expect(settings.stopWhen?.length).toBe(1);
		expect(seen.destroyed).toBe(true);
	});

	it('un turno interrotto esce come aborted e chiude comunque la sessione', async () => {
		const { agent, seen } = fakeAgent([{ type: '__abort__' }]);
		const runtime = new HarnessRuntime({
			execToolCall: async () => ({ content: [] }),
			sandboxProvider: {} as never,
			createAgent: () => agent
		});

		const events: RunEvent[] = [];
		for await (const event of runtime.run(request(), ctx)) events.push(event);

		expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'aborted' });
		expect(seen.destroyed).toBe(true);
	});

	it('il tempo scaduto ferma il turno come deadline, non come completed', async () => {
		const { agent } = fakeAgent([
			{ type: 'text-delta', text: 'lavoro' },
			{ type: 'finish-step' }
		]);
		const runtime = new HarnessRuntime({
			execToolCall: async () => ({ content: [] }),
			sandboxProvider: {} as never,
			createAgent: () => agent,
			chatTurnDeadline: () => ({ reached: () => true, expired: true })
		});

		const events: RunEvent[] = [];
		for await (const event of runtime.run(request(), ctx)) events.push(event);

		expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'deadline' });
	});

	it('i tool vedono il contesto del run corrente, non uno vuoto', async () => {
		const { agent } = fakeAgent([]);
		let seenContext: unknown = null;
		const runtime = new HarnessRuntime({
			execToolCall: async (_call, context) => {
				seenContext = context;
				return { content: [] };
			},
			sandboxProvider: {} as never,
			createAgent: (settings) => {
				agent.settings = settings;
				return agent;
			}
		});
		for await (const event of runtime.run(request(), ctx)) void event;

		const tools = (agent.settings as { tools: Record<string, { execute: (input: unknown) => Promise<unknown> }> })
			.tools;
		await tools.publish_post.execute({});
		expect(seenContext).toMatchObject({ brandId: 'b1', userId: 'u1', runId: 'r1' });
	});
});
