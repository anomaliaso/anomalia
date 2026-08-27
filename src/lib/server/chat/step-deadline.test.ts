import { describe, expect, it, vi } from 'vitest';
import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_MIN_SLICE_MS, withStepDeadline } from './step-deadline';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Plenty of budget — the wrapper should be invisible. */
const roomy = { remainingMs: () => 60_000 };

function toolWith(execute: (input: unknown, opts: unknown) => unknown, extra: Record<string, unknown> = {}) {
	return { description: 'x', inputSchema: {}, execute, ...extra };
}

describe('withStepDeadline', () => {
	it('passes the result through when the tool finishes in time', async () => {
		const tools = withStepDeadline({ fast: toolWith(async () => ({ ok: true, n: 1 })) }, roomy);
		await expect(tools.fast.execute({}, {})).resolves.toEqual({ ok: true, n: 1 });
	});

	it('forwards input and execution options to the wrapped tool', async () => {
		const spy = vi.fn(async () => ({ ok: true }));
		const tools = withStepDeadline({ echo: toolWith(spy) }, roomy);
		const execOpts = { abortSignal: undefined, toolCallId: 'call-1' };
		await tools.echo.execute({ a: 1 }, execOpts);
		expect(spy).toHaveBeenCalledWith({ a: 1 }, execOpts);
	});

	it('preserves every other property of the tool', () => {
		const tools = withStepDeadline({ t: toolWith(async () => null, { description: 'keep me' }) }, roomy);
		expect(tools.t.description).toBe('keep me');
		expect(tools.t.inputSchema).toBeDefined();
	});

	it('stops a tool that outlives the remaining budget', async () => {
		const tools = withStepDeadline(
			{ hangs: toolWith(async () => { await sleep(5_000); return { ok: true }; }) },
			{ remainingMs: () => 30, minSliceMs: 10 }
		);
		const result = (await tools.hangs.execute({}, {})) as Record<string, unknown>;
		expect(result.error).toBe('tool_timeout');
		expect(result.tool).toBe('hangs');
		expect(result.waited_ms).toBeGreaterThanOrEqual(20);
	});

	it('reports an expiry through onExpired', async () => {
		const onExpired = vi.fn();
		const tools = withStepDeadline(
			{ hangs: toolWith(async () => { await sleep(5_000); }) },
			{ remainingMs: () => 30, minSliceMs: 10, onExpired }
		);
		await tools.hangs.execute({}, {});
		expect(onExpired).toHaveBeenCalledWith(
			expect.objectContaining({ tool: 'hangs', reason: 'timeout' })
		);
	});

	it('does not start a tool when the slice is below the floor', async () => {
		const spy = vi.fn(async () => ({ ok: true }));
		const onExpired = vi.fn();
		const tools = withStepDeadline({ late: toolWith(spy) }, { remainingMs: () => 100, onExpired });
		const result = (await tools.late.execute({}, {})) as Record<string, unknown>;
		expect(spy).not.toHaveBeenCalled();
		expect(result.error).toBe('turn_out_of_time');
		expect(onExpired).toHaveBeenCalledWith(
			expect.objectContaining({ tool: 'late', reason: 'no_time_left' })
		);
	});

	it('uses a 5s floor by default', async () => {
		expect(DEFAULT_MIN_SLICE_MS).toBe(5_000);
		const spy = vi.fn(async () => ({ ok: true }));
		const tools = withStepDeadline({ t: toolWith(spy) }, { remainingMs: () => DEFAULT_MIN_SLICE_MS - 1 });
		await tools.t.execute({}, {});
		expect(spy).not.toHaveBeenCalled();
	});

	it('reads the remaining budget fresh on every call', async () => {
		const slices = [60_000, 60_000, 0];
		const tools = withStepDeadline(
			{ t: toolWith(async () => ({ ok: true })) },
			{ remainingMs: () => slices.shift() ?? 0 }
		);
		await expect(tools.t.execute({}, {})).resolves.toEqual({ ok: true });
		await expect(tools.t.execute({}, {})).resolves.toEqual({ ok: true });
		expect((await tools.t.execute({}, {})) as Record<string, unknown>).toMatchObject({
			error: 'turn_out_of_time'
		});
	});

	it('lets tool rejections through unchanged', async () => {
		const tools = withStepDeadline(
			{ boom: toolWith(async () => { throw new Error('provider exploded'); }) },
			roomy
		);
		await expect(tools.boom.execute({}, {})).rejects.toThrow('provider exploded');
	});

	it('turns a synchronous throw into a rejection rather than crashing the wrapper', async () => {
		const tools = withStepDeadline(
			{ sync: toolWith(() => { throw new Error('sync boom'); }) },
			roomy
		);
		await expect(tools.sync.execute({}, {})).rejects.toThrow('sync boom');
	});

	it('returns cancelled when the signal is already aborted', async () => {
		const spy = vi.fn(async () => ({ ok: true }));
		const tools = withStepDeadline({ t: toolWith(spy) }, roomy);
		const result = (await tools.t.execute({}, { abortSignal: AbortSignal.abort() })) as Record<string, unknown>;
		expect(spy).not.toHaveBeenCalled();
		expect(result.cancelled).toBe(true);
	});

	it('stops waiting as soon as the signal aborts mid-call', async () => {
		const ctrl = new AbortController();
		const tools = withStepDeadline(
			{ slow: toolWith(async () => { await sleep(5_000); return { ok: true }; }) },
			roomy
		);
		const pending = tools.slow.execute({}, { abortSignal: ctrl.signal });
		setTimeout(() => ctrl.abort(), 20);
		const result = (await pending) as Record<string, unknown>;
		expect(result.cancelled).toBe(true);
	});

	it('does not raise an unhandled rejection when a stopped tool fails later', async () => {
		const onUnhandled = vi.fn();
		process.on('unhandledRejection', onUnhandled);
		const tools = withStepDeadline(
			{
				hangs: toolWith(async () => {
					await sleep(40);
					throw new Error('late failure nobody is waiting for');
				})
			},
			{ remainingMs: () => 20, minSliceMs: 10 }
		);
		expect((await tools.hangs.execute({}, {})) as Record<string, unknown>).toMatchObject({
			error: 'tool_timeout'
		});
		await sleep(120);
		process.off('unhandledRejection', onUnhandled);
		expect(onUnhandled).not.toHaveBeenCalled();
	});

	it('passes through entries that have no execute', () => {
		const clientSide = { description: 'answered on the client', inputSchema: {} };
		const tools = withStepDeadline({ ask: clientSide }, roomy);
		expect(tools.ask).toBe(clientSide);
	});

	// The wrapper rebuilds each entry with a spread. Everything streamText reads off a tool —
	// description, inputSchema, type — has to survive that, or the model silently loses the tool.
	it('keeps a real AI SDK tool() intact', async () => {
		const real = tool({
			description: 'reads posts',
			inputSchema: z.object({ status: z.string() }),
			execute: async ({ status }: { status: string }) => ({ status, posts: [] })
		});
		const tools = withStepDeadline({ read_posts: real }, roomy);

		for (const key of Reflect.ownKeys(real)) {
			expect(Reflect.has(tools.read_posts, key)).toBe(true);
		}
		expect(tools.read_posts.description).toBe('reads posts');
		expect(tools.read_posts.inputSchema).toBe(real.inputSchema);
		await expect(tools.read_posts.execute({ status: 'pending' }, {})).resolves.toEqual({
			status: 'pending',
			posts: []
		});
	});
});
