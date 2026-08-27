/**
 * L'INTERRUTTORE DEL GIUDICE AUTOMATICO — quello che parte da solo si spegne, quello che una
 * persona chiede resta.
 *
 * Il taglio è alla CODA (`queueVideoReview`) e al giudizio in linea (`scoreFinishedClip`), non ai
 * dodici punti che li chiamano: è il motivo per cui fra un mese non ricompare un innesco scoperto.
 * `manual` / assenza di `auto` sono la porta di chi la review la chiede.
 *
 * In test `AUTO_VIDEO_REVIEW` non è impostata, quindi l'interruttore è nella posizione di
 * produzione: spento.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const reviewVideo = vi.fn(async () => ({
	ok: true as const,
	review: { standard: 'organic', verdict: 'ship', overall: 8, scores: {}, issues: [] }
}));

vi.mock('$lib/server/ai-log', () => ({
	withBrandContext: <T>(_brandId: string, fn: () => T) => fn(),
	logAiCall: vi.fn(),
	isCreditExempt: () => false
}));

import { AUTO_VIDEO_REVIEW_ENABLED } from './video-review';
import { queueVideoReview } from './video-review-store';
import { scoreFinishedClip } from './video-review-apply';

vi.mock('./video-review', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, reviewVideo: (...a: unknown[]) => reviewVideo(...(a as [])) };
});

const URL_OK = 'https://x.supabase.co/storage/v1/object/public/media/a/generated/clip.mp4';

function fakeSupabase() {
	const upserts: unknown[] = [];
	const builder = () => {
		const b: Record<string, unknown> = {};
		for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
		b.maybeSingle = async () => ({ data: null, error: null });
		b.upsert = async (payload: unknown) => {
			upserts.push(payload);
			return { error: null };
		};
		return b;
	};
	return { supabase: { from: builder } as unknown as SupabaseClient, upserts };
}

describe('AUTO_VIDEO_REVIEW_ENABLED', () => {
	it('is off unless the env var says otherwise', () => {
		expect(AUTO_VIDEO_REVIEW_ENABLED).toBe(false);
	});
});

describe('queueVideoReview', () => {
	it('refuses to queue anything on its own', async () => {
		const { supabase, upserts } = fakeSupabase();
		expect(await queueVideoReview(supabase, { brandId: 'b1', url: URL_OK })).toBe(false);
		expect(upserts).toHaveLength(0);
	});

	it('still queues what a person asked for', async () => {
		const { supabase, upserts } = fakeSupabase();
		expect(await queueVideoReview(supabase, { brandId: 'b1', url: URL_OK }, { manual: true })).toBe(true);
		expect(upserts).toHaveLength(1);
	});
});

describe('scoreFinishedClip', () => {
	it('skips the in-pipeline judge that drives a remake loop', async () => {
		const { supabase } = fakeSupabase();
		const res = await scoreFinishedClip(supabase, {
			brandId: 'b1',
			url: URL_OK,
			standard: 'organic',
			auto: true,
			opts: { standard: 'organic' }
		});
		expect(res).toEqual({ ok: false, error: 'auto_review_off' });
		expect(reviewVideo).not.toHaveBeenCalled();
	});

	it('still runs when a person asked for it (no auto flag)', async () => {
		const { supabase } = fakeSupabase();
		const res = await scoreFinishedClip(supabase, {
			brandId: 'b1',
			url: URL_OK,
			standard: 'organic',
			opts: { standard: 'organic' }
		});
		expect(res.ok).toBe(true);
		expect(reviewVideo).toHaveBeenCalledOnce();
	});
});
