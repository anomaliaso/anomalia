import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noteRead, resetReadReceipts } from './read-guards';

/**
 * Il gate lettura→scrittura sui sorgenti motion: senza una lettura fresca non si patcha, e se il
 * video è cambiato dopo l'ultima lettura la scrittura è rifiutata con l'ordine di rileggere.
 */

const persist = vi.hoisted(() => ({
	getMotionVideo: vi.fn(),
	listMotionVideos: vi.fn(async () => []),
	saveMotionVideo: vi.fn()
}));

vi.mock('$lib/server/motion-video/persist', () => persist);
vi.mock('$lib/server/credits', () => ({ gateCredits: async () => {} }));
vi.mock('$lib/motion-video/compile', () => ({
	compileMotionSource: () => ({ fps: 30, durationInFrames: 90, width: 1080, height: 1920 })
}));

import { createMotionVideoChatTools } from '$lib/agent/tools/motion-video-tools';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row(overrides: Record<string, unknown> = {}): any {
	return {
		id: 'v1',
		brand_id: 'b1',
		user_id: 'u1',
		title: 'Trailer',
		source: '<div>ciao</div>',
		preview_url: null,
		fps: 30,
		duration_in_frames: 90,
		width: 1080,
		height: 1920,
		created_at: '',
		updated_at: 't1',
		...overrides
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (t: any, input: Record<string, unknown>) =>
	t.execute(input, { toolCallId: 't', messages: [] });

beforeEach(() => {
	resetReadReceipts();
	vi.clearAllMocks();
	const current = row();
	persist.getMotionVideo.mockImplementation(async () => current);
	persist.saveMotionVideo.mockImplementation(async (_c: unknown, o: { source: string }) => {
		current.source = o.source;
		current.updated_at = 't2';
		return { ok: true, row: { ...current } };
	});
});

describe('motion write gate', () => {
	it('rifiuta replace_motion_source su un video mai letto', async () => {
		persist.getMotionVideo.mockResolvedValue(row());
		const res = await run(createMotionVideoChatTools({} as never).replace_motion_source, {
			video_id: 'v1',
			old_str: 'ciao',
			new_str: 'a presto'
		});
		expect(res.error).toMatch(/Read before writing/);
		expect(res.error).toMatch(/read_motion_source/);
		expect(persist.saveMotionVideo).not.toHaveBeenCalled();
	});

	it('dopo la lettura scrive e il receipt si allinea al nuovo updated_at', async () => {
		noteRead('motion', 'v1', 't1');
		const tools = createMotionVideoChatTools({} as never);

		const first = await run(tools.replace_motion_source, {
			video_id: 'v1',
			old_str: 'ciao',
			new_str: 'a presto'
		});
		expect(first.error).toBeUndefined();
		expect(first.replaced).toBe(1);
		expect(persist.saveMotionVideo).toHaveBeenCalledTimes(1);

		// La seconda patch di seguito passa senza rileggere: chi ha appena scritto conosce lo stato.
		const second = await run(tools.write_motion_source, {
			video_id: 'v1',
			source: '<div>nuovo</div>'
		});
		expect(second.error).toBeUndefined();
		expect(persist.saveMotionVideo).toHaveBeenCalledTimes(2);
	});

	it('rifiuta la scrittura se il video è cambiato dopo la lettura', async () => {
		persist.getMotionVideo.mockResolvedValue(row({ updated_at: 't9' }));
		noteRead('motion', 'v1', 't1');
		const res = await run(createMotionVideoChatTools({} as never).replace_motion_source, {
			video_id: 'v1',
			old_str: 'ciao',
			new_str: 'a presto'
		});
		expect(res.error).toMatch(/changed since your last read/);
		expect(res.error).toMatch(/nothing was written/);
		expect(persist.saveMotionVideo).not.toHaveBeenCalled();
	});
});
