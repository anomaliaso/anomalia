/**
 * The reconciler is the whole reason a clip render can now outlive a request, so the properties
 * worth pinning are the ones that cost money or lose work when they break: a render is finished
 * exactly once, an unfinished one is handed straight back, a dead claim is recovered, and a task
 * kie never resolves is eventually given up on rather than retried forever.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const finishVideoRender = vi.fn();

vi.mock('$lib/server/video', () => ({
	finishVideoRender: (...args: unknown[]) => finishVideoRender(...args)
}));
vi.mock('$lib/server/ai-log', () => ({
	withBrandContext: <T>(_brandId: string, fn: () => T) => fn()
}));

/** In-memory tables where a conditional UPDATE really re-checks the row it matched. */
function makeDb(seed: Record<string, Row[]>) {
	const tables: Record<string, Row[]> = {};
	for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

	function build(name: string, mode: 'select' | 'update', patch?: Row) {
		const table = (tables[name] ??= []);
		const filters: Array<(r: Row) => boolean> = [];
		let limit = Infinity;

		const run = () => {
			const hits = table.filter((r) => filters.every((f) => f(r))).slice(0, limit);
			if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
			return hits;
		};

		const api: Row = {
			eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
			neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), api),
			in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
			lt: (c: string, v: string) => (filters.push((r) => r[c] != null && r[c] < v), api),
			order: () => api,
			limit: (n: number) => ((limit = n), api),
			select: () => api,
			maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
			then: (res?: (v: { data: Row[]; error: null }) => unknown, rej?: (e: unknown) => unknown) => {
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
		tables,
		client: {
			from: (name: string) => ({
				select: () => build(name, 'select'),
				update: (patch: Row) => build(name, 'update', patch),
				insert: (row: Row) => {
					const created = { id: `row-${(tables[name] ??= []).length + 1}`, ...row };
					tables[name].push(created);
					return {
						select: () => ({ maybeSingle: async () => ({ data: created, error: null }) })
					};
				}
			})
		}
	};
}

function renderRow(over: Row = {}): Row {
	return {
		id: 'render-1',
		brand_id: 'brand-1',
		user_id: 'user-1',
		post_id: 'post-1',
		thread_id: null,
		task_id: 'kie-task-1',
		model: 'bytedance/seedance-2-5',
		status: 'rendering',
		duration_seconds: 12,
		resolution: '720p',
		cover_url: 'https://cdn/cover.jpg',
		prompt: 'a clip',
		persist_opts: { captions: false, tighten: false },
		submitted_at: new Date(Date.now() - 30_000).toISOString(),
		attempts: 0,
		...over
	};
}

async function reconcile(client: unknown) {
	const { reconcileVideoRenders } = await import('./video-render-queue');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return reconcileVideoRenders(client as any);
}

beforeEach(() => {
	finishVideoRender.mockReset();
});

describe('reconcileVideoRenders', () => {
	it('attaches a finished clip to its post and closes the render', async () => {
		finishVideoRender.mockResolvedValue({
			status: 'done',
			url: 'https://cdn/clip.mp4',
			durationSeconds: 12,
			resolution: '720p',
			thumbnailUrl: 'https://cdn/cover.jpg'
		});
		const { tables, client } = makeDb({
			video_renders: [renderRow()],
			posts: [{ id: 'post-1', media_url: 'https://cdn/cover.jpg', content_type: 'generated_image' }]
		});

		expect(await reconcile(client)).toMatchObject({ done: 1, failed: 0, expired: 0 });

		expect(tables.video_renders[0].status).toBe('done');
		expect(tables.video_renders[0].media_url).toBe('https://cdn/clip.mp4');
		// The post must stop advertising a cover as if it were the clip.
		expect(tables.posts[0]).toMatchObject({
			media_url: 'https://cdn/clip.mp4',
			content_type: 'generated_video',
			video_render_status: 'done',
			video_task_id: 'kie-task-1'
		});
	});

	it('hands an unfinished render straight back instead of holding it', async () => {
		finishVideoRender.mockResolvedValue({ status: 'pending' });
		const { tables, client } = makeDb({ video_renders: [renderRow()], posts: [] });

		expect(await reconcile(client)).toMatchObject({ done: 0, failed: 0 });

		expect(tables.video_renders[0].status).toBe('rendering');
		expect(tables.video_renders[0].claimed_at).toBeNull();
		// Attempts must NOT move: this was a healthy "is it done yet?" check, and counting those
		// turns the retry cap into a deadline of MAX_ATTEMPTS minutes on a per-minute cron —
		// killing every clip that legitimately takes longer.
		expect(tables.video_renders[0].attempts).toBe(0);
	});

	it('only spends an attempt on a real failure', async () => {
		finishVideoRender.mockRejectedValue(new Error('storage unreachable'));
		const { tables, client } = makeDb({ video_renders: [renderRow()], posts: [] });

		await reconcile(client);

		expect(tables.video_renders[0].attempts).toBe(1);
	});

	it('survives many pending checks without exhausting its attempts', async () => {
		const { VIDEO_RENDER_MAX_ATTEMPTS } = await import('./video-render-queue');
		finishVideoRender.mockResolvedValue({ status: 'pending' });
		const { tables, client } = makeDb({ video_renders: [renderRow()], posts: [] });

		// A twenty-minute render gets checked twenty-odd times. None of those is a failure.
		for (let i = 0; i < VIDEO_RENDER_MAX_ATTEMPTS + 5; i++) await reconcile(client);

		expect(tables.video_renders[0].status).toBe('rendering');
		expect(tables.video_renders[0].attempts).toBe(0);
	});

	it('finishes a render exactly once when two ticks overlap', async () => {
		let concurrent = 0;
		let overlapped = false;
		finishVideoRender.mockImplementation(async () => {
			concurrent += 1;
			if (concurrent > 1) overlapped = true;
			await new Promise((r) => setTimeout(r, 20));
			concurrent -= 1;
			return { status: 'done', url: 'https://cdn/clip.mp4', durationSeconds: 12, resolution: '720p' };
		});
		const { client } = makeDb({ video_renders: [renderRow()], posts: [{ id: 'post-1' }] });

		await Promise.all([reconcile(client), reconcile(client)]);

		// Downloading the mp4 and billing kie's exact charge both happen in there.
		expect(finishVideoRender).toHaveBeenCalledTimes(1);
		expect(overlapped).toBe(false);
	});

	it('marks the post failed when kie reports a failed render', async () => {
		finishVideoRender.mockResolvedValue({ status: 'failed', error: 'moderation rejected' });
		const { tables, client } = makeDb({
			video_renders: [renderRow()],
			posts: [{ id: 'post-1' }]
		});

		expect(await reconcile(client)).toMatchObject({ failed: 1 });

		expect(tables.video_renders[0].status).toBe('failed');
		expect(tables.video_renders[0].error).toBe('moderation rejected');
		expect(tables.posts[0].video_render_status).toBe('failed');
	});

	it('gives up on a task kie never resolves, without calling out again', async () => {
		const { VIDEO_RENDER_MAX_AGE_MS } = await import('./video-render-queue');
		const { tables, client } = makeDb({
			video_renders: [
				renderRow({
					submitted_at: new Date(Date.now() - VIDEO_RENDER_MAX_AGE_MS - 60_000).toISOString()
				})
			],
			posts: [{ id: 'post-1' }]
		});

		expect(await reconcile(client)).toMatchObject({ expired: 1 });

		expect(finishVideoRender).not.toHaveBeenCalled();
		expect(tables.video_renders[0].status).toBe('expired');
		expect(tables.posts[0].video_render_status).toBe('failed');
	});

	it('recovers a claim whose holder died mid-finish', async () => {
		const { VIDEO_RENDER_CLAIM_STALE_MS } = await import('./video-render-queue');
		finishVideoRender.mockResolvedValue({
			status: 'done',
			url: 'https://cdn/clip.mp4',
			durationSeconds: 12,
			resolution: '720p'
		});
		const { tables, client } = makeDb({
			video_renders: [
				renderRow({
					status: 'finishing',
					claimed_at: new Date(Date.now() - VIDEO_RENDER_CLAIM_STALE_MS - 60_000).toISOString()
				})
			],
			posts: [{ id: 'post-1' }]
		});

		// Without the sweep this row is stranded forever: the clip exists on kie and nobody collects it.
		expect(await reconcile(client)).toMatchObject({ done: 1 });
		expect(tables.video_renders[0].status).toBe('done');
	});

	it('leaves a fresh claim alone — another process is working on it', async () => {
		const { tables, client } = makeDb({
			video_renders: [renderRow({ status: 'finishing', claimed_at: new Date().toISOString() })],
			posts: []
		});

		expect(await reconcile(client)).toMatchObject({ checked: 0, done: 0 });
		expect(finishVideoRender).not.toHaveBeenCalled();
		expect(tables.video_renders[0].status).toBe('finishing');
	});

	// The clip is stored and paid for by the time applyToPost runs. Settling `done` when the post
	// write failed would strand it: nothing in this module ever re-reads a done row.
	it('keeps a render queued when the post cannot be updated', async () => {
		finishVideoRender.mockResolvedValue({
			status: 'done',
			url: 'https://cdn/clip.mp4',
			durationSeconds: 12,
			resolution: '720p'
		});
		const { tables, client } = makeDb({ video_renders: [renderRow()], posts: [] });
		// The post write errors — an unmigrated column, say. applyToPost chains .select('id') so
		// the stub has to answer that shape too.
		const realFrom = client.from.bind(client);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(client as any).from = (name: string) =>
			name === 'posts'
				? {
						update: () => ({
							eq: () => ({
								select: async () => ({ data: null, error: { message: 'column missing' } })
							})
						})
					}
				: realFrom(name);

		expect(await reconcile(client)).toMatchObject({ done: 0 });

		expect(tables.video_renders[0].status).toBe('rendering');
		// The stored url is kept so the retry does not have to download it again.
		expect(tables.video_renders[0].media_url).toBe('https://cdn/clip.mp4');
	});

	it('stops retrying a render that keeps failing, instead of downloading it sixty times', async () => {
		const { VIDEO_RENDER_MAX_ATTEMPTS } = await import('./video-render-queue');
		const { tables, client } = makeDb({
			video_renders: [renderRow({ attempts: VIDEO_RENDER_MAX_ATTEMPTS, error: 'storage down' })],
			posts: [{ id: 'post-1' }]
		});

		expect(await reconcile(client)).toMatchObject({ expired: 1 });

		expect(finishVideoRender).not.toHaveBeenCalled();
		expect(tables.video_renders[0].status).toBe('expired');
		expect(String(tables.video_renders[0].error)).toContain('storage down');
	});

	it('leaves the claim window longer than a reconciler run can last', async () => {
		const { VIDEO_RENDER_CLAIM_STALE_MS } = await import('./video-render-queue');
		// The route declares maxDuration 300s; a shorter window lets an in-flight tick's claim be
		// swept and the non-idempotent half run twice.
		expect(VIDEO_RENDER_CLAIM_STALE_MS).toBeGreaterThan(300_000);
	});

	it('returns a row to the queue when finishing throws, rather than burying it', async () => {
		finishVideoRender.mockRejectedValue(new Error('storage unreachable'));
		const { tables, client } = makeDb({ video_renders: [renderRow()], posts: [] });

		await reconcile(client);

		expect(tables.video_renders[0].status).toBe('rendering');
		expect(tables.video_renders[0].error).toBe('storage unreachable');
	});
});

describe('enqueueVideoRender', () => {
	it('writes the kie handle down with everything finishing it will need', async () => {
		const { enqueueVideoRender } = await import('./video-render-queue');
		const { tables, client } = makeDb({ video_renders: [] });

		const id = await enqueueVideoRender(client as never, {
			brandId: 'brand-1',
			userId: 'user-1',
			postId: 'post-1',
			threadId: 'thread-1',
			submitted: {
				taskId: 'kie-task-9',
				model: 'bytedance/seedance-2-5',
				prompt: 'a clip',
				durationSeconds: 22,
				resolution: '720p',
				coverUrl: 'https://cdn/cover.jpg',
				persistOpts: { captions: true, fontName: 'Inter', tighten: true },
				submittedAt: Date.now()
			}
		});

		expect(id).toBeTruthy();
		// persist_opts cannot be re-derived later — the request that computed it is long gone.
		expect(tables.video_renders[0]).toMatchObject({
			task_id: 'kie-task-9',
			thread_id: 'thread-1',
			persist_opts: { captions: true, fontName: 'Inter', tighten: true }
		});
	});
});
