import { afterEach, describe, expect, it } from 'vitest';
import { compactMotionPersist, createMotionVideoChatTools } from './motion-video-tools';
import { buildAgentHead } from './agents';
import type { MotionVideoRow } from '$lib/motion-video/source';

const row: MotionVideoRow = {
	id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
	brand_id: 'b1',
	user_id: 'u1',
	title: 'Launch',
	source: 'export default function MotionVideo() { return null }',
	preview_url: null,
	fps: 30,
	duration_in_frames: 180,
	width: 1080,
	height: 1080,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z'
};

describe('compactMotionPersist', () => {
	it('drops the full TSX and reports source_chars', () => {
		const out = compactMotionPersist(row, { replaced: 2 });
		expect(out.video_id).toBe(row.id);
		expect(out.source_chars).toBe(row.source.length);
		expect(out.replaced).toBe(2);
		expect(out).not.toHaveProperty('source');
		expect(JSON.stringify(out)).not.toContain('export default');
	});

	/**
	 * IL CASO VERO (22/08): `ok: true` + `preview_url: null` + «Preview in the Motion video gallery
	 * — /motion-video» nello stesso hint. L'agente ha mandato quel link al proprietario come
	 * anteprima del trailer, e la pagina era vuota.
	 */
	it('senza MP4 non dice riuscito, dice cosa manca e NON invita all anteprima', () => {
		const out = compactMotionPersist({ ...row, preview_url: null });
		expect(out.status).toBe('source_saved_not_rendered');
		expect(out.next_step).toBe('render_motion_video');
		expect(out.hint).not.toContain('/motion-video');
		expect(out).not.toHaveProperty('ok');
	});

	it('col MP4 in galleria l invito torna, ed è vero', () => {
		const out = compactMotionPersist({ ...row, preview_url: 'https://x/y.mp4' });
		expect(out.status).toBe('rendered');
		expect(out.hint).toContain('/motion-video');
		expect(out).not.toHaveProperty('not_rendered_yet');
	});
});

/**
 * The case that will actually happen: Context7 is down, slow, or rate-limiting us.
 * A documentation lookup is a convenience — it must never be the thing that kills a turn in which
 * the agent was writing a composition. So every failure comes back as a normal tool result.
 */
describe('search_library_docs', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const docsTool = () => (createMotionVideoChatTools({ supabase: {} as any, brandId: 'b1', userId: 'u1' }) as any).search_library_docs;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const run = (input: unknown) => docsTool().execute(input, {} as never) as Promise<any>;
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('returns an error result instead of throwing when the service is unreachable', async () => {
		globalThis.fetch = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
		const out = await run({ topic: 'spring config damping' });
		expect(out.error).toContain('unavailable');
		expect(out.topic).toBe('spring config damping');
		// The agent must be told not to hammer it, or one outage becomes 75 tool steps.
		expect(out.hint).toContain('Do not retry');
	});

	it('turns a non-2xx (rate limit, 5xx) into the same soft failure', async () => {
		globalThis.fetch = (() => Promise.resolve(new Response('slow down', { status: 429 }))) as typeof fetch;
		const out = await run({ topic: 'Audio component volume' });
		expect(out.error).toContain('429');
		expect(out.library).toBeUndefined();
	});

	it('asks Remotion by default, in one request', async () => {
		const calls: string[] = [];
		globalThis.fetch = ((url: string) => {
			calls.push(String(url));
			return Promise.resolve(new Response('### interpolate\n```tsx\ninterpolate(frame, [0, 1], [0, 1])\n```'));
		}) as unknown as typeof fetch;
		const out = await run({ topic: 'interpolate clamp' });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain(encodeURIComponent('/remotion-dev/remotion'));
		expect(out.docs).toContain('interpolate');
	});
});

/** A tool nobody is told to call is dead weight — the instruction is the feature. */
describe('the two agents that write source know when to look things up', () => {
	for (const id of ['motion', 'content'] as const) {
		it(`${id} carries the documentation instruction`, () => {
			const head = buildAgentHead(id, 'it', 'demo', 'Demo');
			expect(head).toContain('search_library_docs');
			// Ours beats the docs: this is the half that keeps the videos ours.
			expect(head).toContain('HOW THE LIBRARY WORKS');
			expect(head).toContain('ours always wins');
		});
	}
});
