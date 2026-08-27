/**
 * I due difetti che questa rotta ha spedito, e che nessun test copriva.
 *
 * 1. Il render non scriveva `preview_url` da nessuna parte: tornava l'url al browser, che se lo
 *    teneva in memoria fino al primo `invalidateAll()`. La galleria restava vuota, la QC leggeva
 *    `no_preview` e non girava mai, e lo storage si riempiva di MP4 che nessuna riga citava.
 * 2. Non c'era nessun `gateCredits`: un brand a saldo zero apriva VM all'infinito, e
 *    `withSandboxBilling` gli addebitava il tempo DOPO averlo speso.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { defaultMotionSource } from '$lib/motion-video/source';

const renderMotionMp4 = vi.fn();
const updateMotionPreviewUrl = vi.fn();
const queueVideoReview = vi.fn();
const kickVideoReviewWork = vi.fn();
const gateCredits = vi.fn();
let sandboxConfigured = true;

class FakeCreditsExhaustedError extends Error {
	constructor() {
		super('credits exhausted');
		this.name = 'CreditsExhaustedError';
	}
}

vi.mock('$lib/server/motion-video/render-tools', () => ({
	renderMotionMp4: (...args: unknown[]) => renderMotionMp4(...args)
}));
vi.mock('$lib/server/motion-video/persist', () => ({
	updateMotionPreviewUrl: (...args: unknown[]) => updateMotionPreviewUrl(...args)
}));
vi.mock('$lib/server/video-review-store', () => ({
	queueVideoReview: (...args: unknown[]) => queueVideoReview(...args),
	kickVideoReviewWork: (...args: unknown[]) => kickVideoReviewWork(...args)
}));
vi.mock('$lib/server/sandbox', () => ({
	isSandboxConfigured: () => sandboxConfigured
}));
vi.mock('$lib/server/credits', () => ({
	CreditsExhaustedError: FakeCreditsExhaustedError,
	gateCredits: (...args: unknown[]) => gateCredits(...args)
}));
vi.mock('$lib/server/ai-log', () => ({
	withBrandContext: (_id: string, fn: () => unknown) => fn()
}));

const { POST } = await import('./+server');

const SOURCE = defaultMotionSource({ brandName: 'Acme' });
const BRAND = { id: 'brand-1', slug: 'acme' };

const supabase = {
	from: () => ({
		select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: BRAND }) }) })
	})
};

function post(body: unknown) {
	const url = 'https://anomalia.so/app/acme/motion-video/render';
	const event = {
		request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
		params: { brand: 'acme' },
		locals: { supabase, safeGetSession: async () => ({ user: { id: 'u1' }, session: {} }) }
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return Promise.resolve((POST as any)(event)).catch((e: unknown) => {
		if (isHttpError(e)) return new Response(String(e.body?.message ?? ''), { status: e.status });
		throw e;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	sandboxConfigured = true;
	gateCredits.mockResolvedValue(undefined);
	renderMotionMp4.mockResolvedValue({ url: 'https://cdn/new.mp4', bytes: 12, seconds: 3 });
	updateMotionPreviewUrl.mockResolvedValue({ ok: true, row: {} });
	queueVideoReview.mockResolvedValue(true);
	kickVideoReviewWork.mockResolvedValue(undefined);
});

describe('motion-video render route', () => {
	it('writes the rendered url onto the row — the client is not trusted with that', async () => {
		const res = await post({ source: SOURCE, videoId: 'v1' });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ url: 'https://cdn/new.mp4', attached: true });
		expect(updateMotionPreviewUrl).toHaveBeenCalledWith(
			supabase,
			BRAND.id,
			'v1',
			'https://cdn/new.mp4'
		);
	});

	it('overwrites the previous preview even when the canvas did not change', async () => {
		// `saveMotionVideo` azzera `preview_url` solo su un cambio di misura: se il render non
		// riscrivesse la riga, un re-render della stessa composizione lascerebbe la galleria e la
		// QC puntate sull'MP4 di prima.
		await post({ source: SOURCE, videoId: 'v1' });
		renderMotionMp4.mockResolvedValue({ url: 'https://cdn/second.mp4', bytes: 12, seconds: 3 });
		await post({ source: SOURCE, videoId: 'v1' });
		expect(updateMotionPreviewUrl).toHaveBeenLastCalledWith(
			supabase,
			BRAND.id,
			'v1',
			'https://cdn/second.mp4'
		);
	});

	it('queues the ads-standard review that the deleted preview endpoint used to queue', async () => {
		await post({ source: SOURCE, videoId: 'v1' });
		expect(queueVideoReview).toHaveBeenCalledWith(supabase, {
			brandId: BRAND.id,
			url: 'https://cdn/new.mp4',
			standard: 'ads'
		});
		expect(kickVideoReviewWork).toHaveBeenCalled();
	});

	it('refuses to open a VM when credits are exhausted', async () => {
		gateCredits.mockRejectedValue(new FakeCreditsExhaustedError());
		const res = await post({ source: SOURCE, videoId: 'v1' });
		expect(res.status).toBe(402);
		expect(await res.json()).toEqual({ error: 'credits_exhausted' });
		expect(renderMotionMp4).not.toHaveBeenCalled();
	});

	it('gates the credits before spending a single second of machine', async () => {
		await post({ source: SOURCE, videoId: 'v1' });
		expect(gateCredits).toHaveBeenCalledWith(BRAND.id);
		expect(gateCredits.mock.invocationCallOrder[0]).toBeLessThan(
			renderMotionMp4.mock.invocationCallOrder[0]
		);
	});

	it('says the export is unavailable instead of hard-failing without a sandbox', async () => {
		sandboxConfigured = false;
		const res = await post({ source: SOURCE, videoId: 'v1' });
		expect(res.status).toBe(503);
		expect((await res.json()).error).toBe('render_unavailable');
		expect(gateCredits).not.toHaveBeenCalled();
		expect(renderMotionMp4).not.toHaveBeenCalled();
	});

	it('rejects a source that does not compile before anything is spent', async () => {
		const res = await post({ source: 'export const nope = (', videoId: 'v1' });
		expect(res.status).toBe(400);
		expect(gateCredits).not.toHaveBeenCalled();
		expect(renderMotionMp4).not.toHaveBeenCalled();
	});
});
