import { beforeEach, describe, expect, it, vi } from 'vitest';

const M = vi.hoisted(() => ({
	llmStructured: vi.fn(async () => ({
		format: 'launch clip',
		duration_s: 4,
		beats: [],
		transitions: [],
		easing: '',
		type_density: '',
		palette: '',
		logo_role: '',
		ui_elements: [],
		sound_off: '',
		adapt: [],
		summary: 'A launch clip.'
	})),
	llmVideoReviewerModel: vi.fn(() => 'anthropic/claude-sonnet-4'),
	fetchVideoBytes: vi.fn(async () => Buffer.from('source-video')),
	prepareReviewMedia: vi.fn(async () => ({
		duration: 4,
		videoMp4: Buffer.from('compact-video'),
		frames: [{ mimeType: 'image/jpeg', data: 'frame', label: 'frame 1' }]
	})),
	loadPostsDesignIndex: vi.fn(async () => [ENTRY]),
	loadPostsDesignDetail: vi.fn(async () => DETAIL)
}));

const ENTRY = {
	id: 'video-reference',
	slug: 'video-reference',
	url: 'https://posts.design/video-reference',
	platform: 'x',
	handleSlug: null,
	externalId: null,
	capturedAt: null,
	words: 'video reference'
};

const DETAIL = {
	...ENTRY,
	title: 'Video reference',
	brand: 'Reference brand',
	handle: null,
	category: 'launch',
	styleTags: [],
	hasVideo: true,
	text: null,
	sourceUrl: null,
	videoUrl: 'https://cdn.example.com/reference.mp4',
	imageUrl: null
};

vi.mock('$lib/server/ai-log', () => ({ getBrandContext: () => null }));
vi.mock('$lib/server/llm', () => ({
	llmConfigured: () => true,
	llmStructured: M.llmStructured,
	llmVideoReviewerModel: M.llmVideoReviewerModel,
	isGoogleGeminiModel: (id: string | undefined) => /^google\/gemini-/.test(id ?? '')
}));
vi.mock('$lib/server/posts-design', () => ({
	isPostsDesignEnabled: () => true,
	loadPostsDesignIndex: M.loadPostsDesignIndex,
	loadPostsDesignDetail: M.loadPostsDesignDetail
}));
vi.mock('$lib/server/video-fetch', () => ({
	fetchVideoBytes: M.fetchVideoBytes,
	prepareReviewMedia: M.prepareReviewMedia
}));
vi.mock('$lib/server/supabase-admin', () => ({
	createAdminClient: () => {
		throw new Error('no database in unit test');
	}
}));

const { studyMotionReference } = await import('./motion-references');

describe('studyMotionReference video capability', () => {
	beforeEach(() => {
		M.llmStructured.mockClear();
		M.llmVideoReviewerModel.mockReset();
		M.llmVideoReviewerModel.mockReturnValue('anthropic/claude-sonnet-4');
	});

	it('keeps the MP4 out of a reviewer model without video input', async () => {
		const result = await studyMotionReference({ idOrSlug: ENTRY.id });
		const call = M.llmStructured.mock.calls[0]?.[0];

		expect(result.ok).toBe(true);
		expect(call).toMatchObject({
			model: 'anthropic/claude-sonnet-4',
			images: [{ mediaType: 'image/jpeg', data: 'frame' }]
		});
		expect(call.file).toBeUndefined();
		expect(call.prompt).toContain('stills only');
	});

	it('passes the MP4 to a Gemini reviewer that supports video input', async () => {
		M.llmVideoReviewerModel.mockReturnValue('google/gemini-2.5-flash');

		await studyMotionReference({ idOrSlug: ENTRY.id });
		const call = M.llmStructured.mock.calls[0]?.[0];

		expect(call).toMatchObject({
			model: 'google/gemini-2.5-flash',
			file: { mediaType: 'video/mp4', data: Buffer.from('compact-video').toString('base64') }
		});
		expect(call.prompt).toContain('FULL CLIP is attached');
	});
});
