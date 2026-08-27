import { describe, expect, it } from 'vitest';
import { parseMotionToolHits, parseMotionToolOutput } from './tool-output';

describe('parseMotionToolOutput', () => {
	it('accepts a write_source object with ok + source', () => {
		const hit = parseMotionToolOutput(
			{
				ok: true,
				mode: 'create',
				video_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
				title: 'Launch',
				source: 'export default function MotionVideo() { return null }'
			},
			'write_source'
		);
		expect(hit?.mode).toBe('create');
		expect(hit?.source).toContain('MotionVideo');
		expect(hit?.videoId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
	});

	it('parses stringified JSON tool output', () => {
		const hit = parseMotionToolOutput(
			JSON.stringify({
				ok: true,
				mode: 'edit',
				video_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
				source: 'const x = 1'
			})
		);
		expect(hit?.mode).toBe('edit');
		expect(hit?.source).toBe('const x = 1');
	});

	it('unwraps { value: { ok, source } } envelopes', () => {
		const hit = parseMotionToolOutput({
			type: 'json',
			value: { ok: true, mode: 'create', source: 'abc' }
		});
		expect(hit?.source).toBe('abc');
	});

	it('ignores read_source even when it includes source', () => {
		expect(
			parseMotionToolOutput(
				{ mode: 'create', title: 'Draft', source: 'seed' },
				'read_source'
			)
		).toBeNull();
	});

	it('ignores grep_source hits', () => {
		expect(
			parseMotionToolOutput(
				{
					mode: 'create',
					matches: [{ index: 0, line: 1, column: 1, preview: 'hello' }],
					total: 1
				},
				'grep_source'
			)
		).toBeNull();
	});

	it('ignores generate_image asset mints', () => {
		expect(
			parseMotionToolOutput(
				{
					success: true,
					image_url: 'https://cdn.example/asset.png',
					did_not_change_post: true
				},
				'generate_image'
			)
		).toBeNull();
	});

	it('accepts replace_source with ok + video_id and no source body', () => {
		const hit = parseMotionToolOutput(
			{
				ok: true,
				mode: 'edit',
				video_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
				title: 'Launch',
				replaced: 2,
				source_chars: 1200
			},
			'replace_source'
		);
		expect(hit).toEqual({
			mode: 'edit',
			videoId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
			title: 'Launch',
			source: undefined
		});
	});

	it('keeps set_title hits without source', () => {
		const hit = parseMotionToolOutput(
			{ ok: true, mode: 'create', title: 'New label' },
			'set_title'
		);
		expect(hit).toEqual({ mode: 'create', title: 'New label', videoId: undefined, source: undefined });
	});

	it('accepts mutating tools that forgot ok: true', () => {
		const hit = parseMotionToolOutput(
			{ mode: 'create', source: 'full tsx' },
			'write_source'
		);
		expect(hit?.source).toBe('full tsx');
	});

	it('collects every video_id from multi-tile replace_source results', () => {
		const payload = {
			ok: true,
			patched: 2,
			total: 2,
			results: [
				{
					ok: true,
					mode: 'edit',
					video_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
					title: 'A',
					replaced: 1
				},
				{
					ok: true,
					mode: 'edit',
					video_id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
					title: 'B',
					replaced: 1
				}
			]
		};
		expect(parseMotionToolHits(payload, 'replace_source').map((h) => h.videoId)).toEqual([
			'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
			'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee'
		]);
		expect(parseMotionToolOutput(payload, 'replace_source')?.videoId).toBe(
			'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
		);
	});

	it('skips failed tiles in a partial multi-tile replace', () => {
		const hits = parseMotionToolHits(
			{
				ok: false,
				patched: 1,
				total: 2,
				incomplete: true,
				results: [
					{
						ok: true,
						mode: 'edit',
						video_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
						replaced: 1
					},
					{
						ok: false,
						video_id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
						error: 'old_str not found'
					}
				]
			},
			'replace_source'
		);
		expect(hits).toEqual([
			{
				mode: 'edit',
				videoId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
				title: undefined,
				source: undefined
			}
		]);
	});
});


describe('chat-registry tool names', () => {
	// A thread started in the workbench can be reopened in the chat, where the motion agent answers
	// with the id-taking variants of the same tools. Both must drive the gallery.
	it('treats write_motion_source as a mutation even without a mode field', () => {
		const hits = parseMotionToolHits(
			{ ok: true, video_id: '11111111-2222-3333-4444-555555555555', title: 'Launch', source_chars: 1200 },
			'write_motion_source'
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].videoId).toBe('11111111-2222-3333-4444-555555555555');
		expect(hits[0].title).toBe('Launch');
		expect(hits[0].mode).toBe('create');
	});

	it('does the same for replace_motion_source and create_motion_video', () => {
		for (const name of ['replace_motion_source', 'create_motion_video']) {
			const hits = parseMotionToolHits({ ok: true, video_id: 'v1', title: 'T' }, name);
			expect(hits, name).toHaveLength(1);
		}
	});

	it('ignores the reads and the reference wall, which persist nothing', () => {
		for (const name of [
			'read_motion_source',
			'grep_motion_source',
			'list_motion_videos',
			'search_motion_references',
			'study_motion_reference'
		]) {
			expect(parseMotionToolHits({ ok: true, video_id: 'v1', title: 'T' }, name), name).toEqual([]);
		}
	});
});
