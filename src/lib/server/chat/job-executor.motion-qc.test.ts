/**
 * Il caso `motion_video_qc` dell'executor: la QC fuori banda che REVIEW E RIMEDIA.
 *
 * Prima un verdetto fix/kill sul percorso chat produceva un flag e zero remake; e sotto i 90s di
 * budget la review saltava in silenzio (il trailer del 21/8 non è mai stato guardato). Questo job
 * è quello che chiude entrambe le falle: gira `scoreAndMaybeRewriteMotion` — il loop dei banchi,
 * riusato — e l'esito rientra nel thread via tool-job-report.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/brand-context', () => ({ genaiClient: () => ({}) }));
vi.mock('$lib/server/motion-video/qc', () => ({
	scoreAndMaybeRewriteMotion: vi.fn(async () => ({
		ok: true,
		applied: true,
		rewrite_from: 'craft',
		craft: { verdict: 'fix', overall: 5.2 },
		review: null
	}))
}));

import { scoreAndMaybeRewriteMotion } from '$lib/server/motion-video/qc';
import { EXECUTABLE_TOOL_JOBS, executeChatToolJob } from './job-executor';

function fakeSupabase(brand: { id: string; name: string } | null) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const q: any = { eq: () => q, maybeSingle: async () => ({ data: brand }) };
	return { from: () => ({ select: () => q }) } as never;
}

const cancel = { signal: new AbortController().signal, assertActive: async () => {} } as never;

describe('motion_video_qc nel job executor', () => {
	it('è nella allowlist: il drain può reclamarlo (senza, la riga invecchiava fino al reaper)', () => {
		expect(EXECUTABLE_TOOL_JOBS).toContain('motion_video_qc');
	});

	it('esegue il loop di QC dei banchi — review + remake — e riporta verdetto e correzione', async () => {
		const result = await executeChatToolJob(
			fakeSupabase({ id: 'b1', name: 'Anomalia' }),
			'b1',
			'u1',
			'motion_video_qc',
			{ video_id: 'video-1' },
			cancel
		);
		expect(scoreAndMaybeRewriteMotion).toHaveBeenCalledWith(
			expect.objectContaining({
				brand: { id: 'b1', name: 'Anomalia' },
				videoId: 'video-1',
				apply: true
			})
		);
		expect(result).toMatchObject({
			video_id: 'video-1',
			applied: true,
			rewrite_from: 'craft',
			craft: { verdict: 'fix', overall: 5.2 }
		});
	});

	it('senza video_id si ferma con un errore leggibile, non con un done vuoto', async () => {
		const result = await executeChatToolJob(
			fakeSupabase({ id: 'b1', name: 'Anomalia' }),
			'b1',
			'u1',
			'motion_video_qc',
			{},
			cancel
		);
		expect(result.error).toContain('video_id');
	});

	it('un giro senza verdetto (no_preview) rientra come lavoro NON fatto', async () => {
		vi.mocked(scoreAndMaybeRewriteMotion).mockResolvedValueOnce({
			ok: false,
			applied: false,
			craft: null,
			review: null,
			error: 'no_preview'
		} as never);
		const result = await executeChatToolJob(
			fakeSupabase({ id: 'b1', name: 'Anomalia' }),
			'b1',
			'u1',
			'motion_video_qc',
			{ video_id: 'video-1' },
			cancel
		);
		expect(result).toEqual({ error: 'no_preview' });
	});
});
