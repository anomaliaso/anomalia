/**
 * Does the async tool path actually run a job, end to end?
 *
 * It did not, before this: /api/v1/chat/run has no caller anywhere in the repo and the turn drain
 * filters on `tool_name = 'chat_response'`, so a tool job enqueued as `pending` had no executor at
 * all — it aged until the reaper declared it dead. These tests pin the mechanism that replaces
 * that, including the property that actually costs money if it breaks: a job must be executed
 * exactly once, no matter how many drains reach for it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const executeChatToolJob = vi.fn();
const assertActive = vi.fn(async () => {});

// Only the executor is stubbed. EXECUTABLE_TOOL_JOBS comes through real, because it is the
// allowlist under test — a mocked copy would happily pass while production claimed the wrong rows.
vi.mock('$lib/server/chat/job-executor', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	executeChatToolJob: (...args: unknown[]) => executeChatToolJob(...args)
}));
vi.mock('$lib/server/chat/job-cancel', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	createJobCancellation: () => ({ signal: new AbortController().signal, assertActive }),
	isChatJobCancelledError: (e: unknown) => e instanceof Error && e.message === 'cancelled'
}));

/**
 * In-memory `chat_jobs` good enough to be worth trusting: conditional UPDATE really does re-check
 * the row it matched, which is the only reason the claim below is a lock rather than a hope.
 */
function makeDb(rows: Row[]) {
	const table: Row[] = rows.map((r) => ({ ...r }));

	function build(mode: 'select' | 'update', patch?: Row) {
		const filters: Array<(r: Row) => boolean> = [];
		let limit = Infinity;
		let sortKey: string | null = null;

		const run = () => {
			let hits = table.filter((r) => filters.every((f) => f(r)));
			if (sortKey) hits = [...hits].sort((a, b) => String(a[sortKey!]).localeCompare(String(b[sortKey!])));
			if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
			return hits.slice(0, limit);
		};

		const api: Row = {
			eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
			neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), api),
			in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
			lt: (c: string, v: string) => (filters.push((r) => r[c] < v), api),
			gte: (c: string, v: string) => (filters.push((r) => r[c] >= v), api),
			order: (c: string) => ((sortKey = c), api),
			limit: (n: number) => ((limit = n), api),
			select: () => api,
			maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
			// A real thenable: production code awaits some of these and calls `.then(undefined, fn)`
			// on others (the fire-and-forget heartbeat), so a `then` that assumes a callback is
			// present blows up outside the test's own stack where nothing can catch it.
			then: (
				res?: (v: { data: Row[]; error: null }) => unknown,
				rej?: (e: unknown) => unknown
			) => {
				try {
					const value = { data: run(), error: null };
					return Promise.resolve(res ? res(value) : value);
				} catch (e) {
					return rej ? Promise.resolve(rej(e)) : Promise.reject(e);
				}
			}
		};
		return api;
	}

	return {
		table,
		client: {
			from: () => ({
				select: () => build('select'),
				update: (patch: Row) => build('update', patch)
			})
		}
	};
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function pendingToolJob(over: Row = {}): Row {
	return {
		id: 'job-1',
		brand_id: 'brand-1',
		user_id: 'user-1',
		thread_id: 'thread-1',
		tool_name: 'produce_week',
		input_params: { week: 0 },
		status: 'pending',
		created_at: iso(5_000),
		...over
	};
}

async function drain(client: unknown) {
	const { processNextPendingToolJob } = await import('./queue');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return processNextPendingToolJob(client as any);
}

beforeEach(() => {
	executeChatToolJob.mockReset();
	assertActive.mockClear();
	executeChatToolJob.mockResolvedValue({ ok: true, video_url: 'https://cdn/clip.mp4' });
});

afterEach(() => vi.useRealTimers());

describe('processNextPendingToolJob', () => {
	it('runs a pending tool job and stores the real result', async () => {
		const { table, client } = makeDb([pendingToolJob()]);

		const r = await drain(client);

		expect(r).toMatchObject({ processed: true, jobId: 'job-1' });
		expect(executeChatToolJob).toHaveBeenCalledTimes(1);
		// The tool name and its input have to survive the round trip, or the job runs as the wrong thing.
		expect(executeChatToolJob).toHaveBeenCalledWith(
			expect.anything(),
			'brand-1',
			'user-1',
			'produce_week',
			{ week: 0 },
			expect.anything(),
			{ id: 'job-1', thread_id: 'thread-1' }
		);
		expect(table[0].status).toBe('done');
		expect(table[0].result).toEqual({ ok: true, video_url: 'https://cdn/clip.mp4' });
		expect(table[0].completed_at).toBeTruthy();
	});

	it('claims the row before running it, so a second drain finds nothing', async () => {
		const { table, client } = makeDb([pendingToolJob()]);

		await drain(client);
		executeChatToolJob.mockClear();
		const second = await drain(client);

		expect(second.processed).toBe(false);
		expect(executeChatToolJob).not.toHaveBeenCalled();
		expect(table[0].status).toBe('done');
	});

	it('executes exactly once when two drains race for the same job', async () => {
		const { client } = makeDb([pendingToolJob()]);
		let running = 0;
		let overlapped = false;
		executeChatToolJob.mockImplementation(async () => {
			running += 1;
			if (running > 1) overlapped = true;
			await new Promise((r) => setTimeout(r, 20));
			running -= 1;
			return { ok: true };
		});

		const [a, b] = await Promise.all([drain(client), drain(client)]);

		expect(executeChatToolJob).toHaveBeenCalledTimes(1);
		expect(overlapped).toBe(false);
		expect([a.processed, b.processed].filter(Boolean)).toHaveLength(1);
	});

	it('records a failure instead of leaving the row running forever', async () => {
		const { table, client } = makeDb([pendingToolJob()]);
		executeChatToolJob.mockRejectedValue(new Error('kie returned 500'));

		const r = await drain(client);

		expect(r).toMatchObject({ processed: true, error: 'kie returned 500' });
		expect(table[0].status).toBe('failed');
		expect(table[0].error).toBe('kie returned 500');
		expect(table[0].completed_at).toBeTruthy();
	});

	// chat_jobs is shared: the designer enqueues motion_video / ugc_batch continuations there for a
	// worker of its own. Claiming one runs it into executeChatToolJob's default case and writes
	// `done` on a row whose work never happened, killing a motion session mid-generation. This is
	// why the drain uses an allowlist rather than "anything that is not a chat turn".
	it.each(['motion_video', 'ugc_batch'])('leaves the designer\'s %s rows alone', async (toolName) => {
		const { table, client } = makeDb([pendingToolJob({ tool_name: toolName })]);

		const r = await drain(client);

		expect(r.processed).toBe(false);
		expect(executeChatToolJob).not.toHaveBeenCalled();
		expect(table[0].status).toBe('pending');
	});

	// `create_motion_video` is a chat tool but has no case in executeChatToolJob, so it is not
	// runnable out-of-band yet. Claiming it would mark it done having done nothing — the allowlist
	// is what makes "not yet supported" fail safe instead of failing silently.
	it.each(['create_motion_video', 'some_future_tool'])(
		'refuses to claim %s, which its executor cannot run',
		async (toolName) => {
			const { table, client } = makeDb([pendingToolJob({ tool_name: toolName })]);

			expect((await drain(client)).processed).toBe(false);
			expect(executeChatToolJob).not.toHaveBeenCalled();
			expect(table[0].status).toBe('pending');
		}
	);

	it('keeps the allowlist free of names other drains own', async () => {
		const { EXECUTABLE_TOOL_JOBS } = await import('./job-executor');
		for (const foreign of ['chat_response', 'motion_video', 'ugc_batch']) {
			expect(EXECUTABLE_TOOL_JOBS).not.toContain(foreign);
		}
	});

	it('closes the row when the tool aborts instead of leaving it running', async () => {
		const { table, client } = makeDb([pendingToolJob()]);
		const abort = new Error('The operation was aborted');
		abort.name = 'AbortError';
		executeChatToolJob.mockRejectedValue(abort);

		expect((await drain(client)).processed).toBe(true);
		expect(table[0].status).toBe('cancelled');
		expect(table[0].completed_at).toBeTruthy();
	});

	it('never touches a chat_response row — those belong to the turn drain', async () => {
		const { table, client } = makeDb([
			pendingToolJob({ id: 'turn-1', tool_name: 'chat_response' })
		]);

		const r = await drain(client);

		expect(r.processed).toBe(false);
		expect(executeChatToolJob).not.toHaveBeenCalled();
		expect(table[0].status).toBe('pending');
	});

	it('leaves an abandoned job for the reaper rather than resurrecting it', async () => {
		const { CHAT_PENDING_STALE_MS } = await import('./turn-limits');
		const { table, client } = makeDb([
			pendingToolJob({ created_at: iso(CHAT_PENDING_STALE_MS + 60_000) })
		]);

		const r = await drain(client);

		expect(r.processed).toBe(false);
		expect(executeChatToolJob).not.toHaveBeenCalled();
		expect(table[0].status).toBe('pending');
	});

	it('does not pick up a job somebody else is already running', async () => {
		const { client } = makeDb([pendingToolJob({ status: 'running' })]);

		expect((await drain(client)).processed).toBe(false);
		expect(executeChatToolJob).not.toHaveBeenCalled();
	});

	it('keeps the heartbeat ticking so the reaper does not close a live render', async () => {
		const { CHAT_HEARTBEAT_INTERVAL_MS, CHAT_HEARTBEAT_STALE_MS } = await import('./turn-limits');
		vi.useFakeTimers();
		const { table, client } = makeDb([pendingToolJob({ created_at: new Date().toISOString() })]);

		let release: () => void = () => {};
		executeChatToolJob.mockImplementation(
			() => new Promise((r) => (release = () => r({ ok: true })))
		);

		const pending = drain(client);
		await vi.waitFor(() => expect(executeChatToolJob).toHaveBeenCalled());
		const claimedAt = table[0].partial.at;

		// Run it past the point where a silent row would be declared dead. This is the property
		// that matters: a ten-minute clip render must not be reaped out from under itself.
		await vi.advanceTimersByTimeAsync(CHAT_HEARTBEAT_STALE_MS + CHAT_HEARTBEAT_INTERVAL_MS);
		const beat = table[0].partial.at;
		expect(beat).toBeGreaterThan(claimedAt);
		expect(Date.now() - beat).toBeLessThan(CHAT_HEARTBEAT_STALE_MS);

		release();
		await pending;
		expect(table[0].status).toBe('done');

		// And it stops once the job is over — a cleared interval is what keeps a finished job from
		// looking eternally alive to the reaper.
		const afterDone = table[0].partial.at;
		await vi.advanceTimersByTimeAsync(CHAT_HEARTBEAT_INTERVAL_MS * 3);
		expect(table[0].partial.at).toBe(afterDone);
	});
});
