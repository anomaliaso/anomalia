import { describe, expect, it, vi } from 'vitest';
import type { UgcClipPlan } from './ugc-batch';

vi.mock('$env/dynamic/private', () => ({ env: {} as Record<string, string | undefined> }));

const M = vi.hoisted(() => ({
	renderPostImage: vi.fn(),
	uploadPostImage: vi.fn(),
	renderVideo: vi.fn()
}));

vi.mock(import('$lib/server/content-preview'), async (importOriginal) => ({
	...(await importOriginal()),
	renderPostImage: M.renderPostImage as never,
	uploadPostImage: M.uploadPostImage as never
}));

vi.mock(import('$lib/server/video'), async (importOriginal) => ({
	...(await importOriginal()),
	renderVideo: M.renderVideo as never
}));

vi.mock(import('$lib/server/brand-context'), async (importOriginal) => ({
	...(await importOriginal()),
	fetchImagePart: (async (url: string) => ({
		inlineData: { mimeType: 'image/png', data: url }
	})) as never
}));

vi.mock(import('$lib/server/ai-log'), async (importOriginal) => ({
	...(await importOriginal()),
	logAiCall: (() => {}) as never,
	withBrandContext: (async (_brandId: string, fn: () => Promise<unknown>) => fn()) as never
}));

vi.mock(import('./persist'), async (importOriginal) => ({
	...(await importOriginal()),
	insertMediaGeneratorItem: (async () => ({ row: { id: 'item' } })) as never
}));

vi.mock(import('./brand-grounding'), async (importOriginal) => ({
	...(await importOriginal()),
	loadUgcBrandGrounding: (async () => ({
		name: 'Demo Brand',
		about: '',
		category: 'software',
		audience: '',
		brandStyle: '',
		aiContext: '',
		offerings: [],
		language: ''
	})) as never
}));

vi.mock(import('./ugc-plan-agent'), async (importOriginal) => ({
	...(await importOriginal()),
	planUgcClipsWithTools: (async () => ({
		clips: Array.from({ length: 3 }, (_, i) => ({
			hook: `hook ${i}`,
			body: `body ${i}`,
			cta: `cta ${i}`,
			setting: `room ${i}`
		})),
		mediaUrls: [],
		toolsUsed: ['read_brand']
	})) as never
}));

vi.mock(import('./ugc-craft'), async (importOriginal) => ({
	...(await importOriginal()),
	craftUgcShotBrief: (async (input: { baseBrief: string }) => input.baseBrief) as never
}));

vi.mock(import('./ugc-agent'), async (importOriginal) => ({
	...(await importOriginal()),
	runUgcOrchestrator: (async () => ({ steps: 0, summary: '' })) as never
}));

const { streamUgcBatchResponse } = await import('./ugc-batch');

const CAST_PROMPT_HEAD = 'CASTING PORTRAIT';

function primeRenderers() {
	let renders = 0;
	for (const m of Object.values(M)) {
		m.mockReset();
	}
	M.renderPostImage.mockImplementation(async (_ai: unknown, prompt: string) => {
		renders += 1;
		const label = prompt.startsWith(CAST_PROMPT_HEAD) ? `cast${renders}` : `frame${renders}`;
		return `data:image/png;base64,${label}`;
	});
	M.uploadPostImage.mockImplementation(
		async (_supabase: unknown, _userId: string, dataUrl: string) =>
			`https://cdn.test/${dataUrl.split(',')[1]}.png`
	);
	M.renderVideo.mockImplementation(async () => ({ url: 'https://cdn.test/clip.mp4' }));
}

async function runBatch(resumePlans?: UgcClipPlan[]) {
	primeRenderers();
	const res = streamUgcBatchResponse({
		supabase: {} as never,
		userId: 'user-1',
		brandId: 'brand-1',
		prompt: 'three clips about the product',
		videoCount: 3,
		resumePlans
	});
	await res.text();
}

function resumedClip(index: number, castPortraitUrl: string): UgcClipPlan {
	return {
		index,
		product: null,
		model: null,
		script: { hook: 'hook', body: 'body', cta: 'cta' },
		setting: 'kitchen',
		format: null,
		hookVisual: null,
		castPortraitUrl
	};
}

function faceRefsPerClip(): string[][] {
	return M.renderVideo.mock.calls.map(
		(c) => (c[3] as { referenceImageUrls?: string[] }).referenceImageUrls ?? []
	);
}

function castRenders(): unknown[] {
	return M.renderPostImage.mock.calls.filter((c) => String(c[1]).startsWith(CAST_PROMPT_HEAD));
}

describe('UGC batch senza persona esplicita', () => {
	it('rende un solo ritratto di casting e lo passa come volto a ogni clip', async () => {
		await runBatch();

		expect(castRenders()).toHaveLength(1);

		const faceRefs = faceRefsPerClip();
		expect(faceRefs).toHaveLength(3);
		for (const refs of faceRefs) {
			expect(refs).toContain('https://cdn.test/cast1.png');
		}
	});

	it('la continuazione riprende il volto del piano invece di rifarne uno', async () => {
		const face = 'https://cdn.test/face-from-the-first-slice.png';
		await runBatch([resumedClip(1, face), resumedClip(2, face)]);

		expect(castRenders()).toHaveLength(0);

		const faceRefs = faceRefsPerClip();
		expect(faceRefs).toHaveLength(2);
		for (const refs of faceRefs) {
			expect(refs).toContain(face);
		}
	});
});
