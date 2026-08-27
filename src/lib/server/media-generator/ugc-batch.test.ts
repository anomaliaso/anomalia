import { describe, expect, it } from 'vitest';
import {
	buildAssignmentLines,
	buildUgcBatchPlanPrompt,
	distributeProducts,
	distributeSlots,
	resolveUgcSeedanceMaterials
} from './ugc-batch';
import { rotateUgcFormats } from '$lib/ugc-formats';

describe('distributeSlots', () => {
	it('returns empty when count is 0', () => {
		expect(distributeSlots(0, ['a'])).toEqual([]);
	});

	it('returns nulls when no items', () => {
		expect(distributeSlots(5, [])).toEqual([null, null, null, null, null]);
	});

	it('assigns the same item to every slot when only one is selected', () => {
		expect(distributeSlots(4, ['a'])).toEqual(['a', 'a', 'a', 'a']);
	});

	it('splits two items ~50/50 across even clip counts', () => {
		expect(distributeSlots(4, ['p1', 'p2'])).toEqual(['p1', 'p1', 'p2', 'p2']);
	});

	it('splits three items proportionally across nine clips', () => {
		expect(distributeSlots(9, ['a', 'b', 'c'])).toEqual([
			'a',
			'a',
			'a',
			'b',
			'b',
			'b',
			'c',
			'c',
			'c'
		]);
	});

	it('covers remainder slots when count is not divisible', () => {
		expect(distributeSlots(5, ['x', 'y'])).toEqual(['x', 'x', 'x', 'y', 'y']);
	});

	it('spreads items when there are more items than clips', () => {
		expect(distributeSlots(2, ['a', 'b', 'c', 'd'])).toEqual(['a', 'c']);
	});
});

describe('distributeProducts', () => {
	it('aliases distributeSlots', () => {
		expect(distributeProducts(4, ['a', 'b'])).toEqual(distributeSlots(4, ['a', 'b']));
	});
});

describe('resolveUgcSeedanceMaterials', () => {
	it('defaults to generating a cover when nothing is supplied', () => {
		expect(resolveUgcSeedanceMaterials({})).toEqual({
			refVideos: [],
			refAudios: [],
			firstFrame: null,
			lastFrame: null,
			skipGeneratedCover: false
		});
	});

	it('keeps start/end frames and skips the generated cover', () => {
		const out = resolveUgcSeedanceMaterials({
			firstFrameUrl: 'https://x/start.jpg',
			lastFrameUrl: 'https://x/end.jpg'
		});
		expect(out.firstFrame).toBe('https://x/start.jpg');
		expect(out.lastFrame).toBe('https://x/end.jpg');
		expect(out.skipGeneratedCover).toBe(true);
	});

	it('accepts data-image frames', () => {
		const out = resolveUgcSeedanceMaterials({
			firstFrameUrl: 'data:image/jpeg;base64,abc'
		});
		expect(out.firstFrame).toBe('data:image/jpeg;base64,abc');
		expect(out.skipGeneratedCover).toBe(true);
	});

	it('treats reference videos as remake materials', () => {
		const out = resolveUgcSeedanceMaterials({
			referenceVideoUrls: ['https://x/a.mp4', 'not-a-url', 'https://x/b.mp4']
		});
		expect(out.refVideos).toEqual(['https://x/a.mp4', 'https://x/b.mp4']);
		expect(out.skipGeneratedCover).toBe(true);
	});

	it('keeps reference audio and skips the generated cover', () => {
		const out = resolveUgcSeedanceMaterials({
			referenceAudioUrls: ['https://x/voice.mp3']
		});
		expect(out.refAudios).toEqual(['https://x/voice.mp3']);
		expect(out.skipGeneratedCover).toBe(true);
	});

	it('drops last-frame-only from skip when there is no start frame or refs', () => {
		const out = resolveUgcSeedanceMaterials({
			lastFrameUrl: 'https://x/end.jpg'
		});
		expect(out.lastFrame).toBe('https://x/end.jpg');
		expect(out.firstFrame).toBeNull();
		expect(out.skipGeneratedCover).toBe(false);
	});
});

describe('buildAssignmentLines', () => {
	it('names the format of each slot so the planner cannot write ten of the same clip', () => {
		const lines = buildAssignmentLines(
			3,
			[null, null, null],
			[null, null, null],
			'Anomalia',
			rotateUgcFormats(3)
		).split('\n');
		expect(lines.length).toBe(3);
		expect(lines[0]).toMatch(/format problem_solution/);
		expect(lines[1]).toMatch(/format testimonial/);
		expect(new Set(lines.map((l) => l.split('format ')[1])).size).toBe(3);
	});

	it('stays as it was when no rotation is passed (seed path, single clip)', () => {
		expect(buildAssignmentLines(1, [null], [null], 'Anomalia')).toBe(
			'#1: feature Anomalia (no specific product pick); invent a concrete speaker look'
		);
	});
});

describe('buildUgcBatchPlanPrompt', () => {
	const brand = {
		name: 'Anomalia',
		about: '',
		category: '',
		audience: '',
		brandStyle: '',
		aiContext: '',
		offerings: [],
		language: 'italiano'
	};

	it('carries the platform rules and the contrast requirement into the fallback plan', () => {
		const prompt = buildUgcBatchPlanPrompt({
			count: 2,
			prompt: 'lancio della nuova collezione',
			productAssignments: [null, null],
			modelAssignments: [null, null],
			brand,
			formatPlan: rotateUgcFormats(2, { platform: 'tiktok' }),
			platform: 'tiktok'
		});
		expect(prompt).toMatch(/PIATTAFORMA TikTok/);
		expect(prompt).toMatch(/IL CONTRASTO/);
		expect(prompt).toMatch(/hook_visual/);
		expect(prompt).toMatch(/format unboxing/);
	});

	it('says the platform is unspecified rather than inventing one', () => {
		const prompt = buildUgcBatchPlanPrompt({
			count: 1,
			prompt: 'x',
			productAssignments: [null],
			modelAssignments: [null],
			brand
		});
		expect(prompt).toMatch(/PIATTAFORMA: non specificata/);
	});
});
