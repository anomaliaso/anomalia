import { describe, expect, it, vi } from 'vitest';

/**
 * Il rimborso del budget di studio sul LANCIO (non solo sul `!res.ok`).
 *
 * Prima solo il fallimento dichiarato restituiva lo studio: un'eccezione (rete, storage) bruciava
 * il budget senza che il modello avesse visto niente. `attempts` invece non si rimborsa mai — è
 * lui che ferma i retry infiniti su un id rotto.
 */

let studyBehaviour: 'throw' | 'ok' = 'throw';

vi.mock(import('$lib/server/posts-design'), async (importOriginal) => ({
	...(await importOriginal()),
	isPostsDesignEnabled: (() => true) as never
}));

vi.mock(import('$lib/server/motion-references'), async (importOriginal) => {
	const original = await importOriginal();
	return {
		...original,
		studyMotionReference: (async () => {
			if (studyBehaviour === 'throw') throw new Error('reference storage unreachable');
			return {
				ok: true,
				reference: {
					id: 'ref-1',
					cached: false,
					watched: true,
					title: 'Acme launch',
					handle: null,
					style_tags: [],
					post_text: null,
					is_video: true,
					captured_at: null,
					reference_url: 'https://posts.design/x',
					source_url: 'https://x',
					brand: 'Acme',
					category: 'launch',
					spec: {
						format: 'card',
						duration_s: 8,
						aspect: '1:1',
						beats: [],
						transitions: [],
						easing: '',
						type_density: '',
						palette: '',
						logo_role: '',
						ui_elements: [],
						sound_off: '',
						adapt: [],
						summary: ''
					}
				},
				media: null
			};
		}) as never
	};
});

describe('study_motion_reference — rimborso sul lancio', () => {
	it('i lanci rimborsano lo studio, e `attempts` chiude comunque la porta', async () => {
		const { createMotionReferenceTools } = await import('./reference-tools');
		const { MAX_STUDIES_PER_TURN } = await import('$lib/server/motion-references');
		const tools = createMotionReferenceTools({ modelId: 'gemini-3-flash' });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const exec = (id: string) =>
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(tools.study_motion_reference as any).execute(
				{ reference_id: id },
				{ toolCallId: 't', messages: [] }
			);

		// Tutti i lanci fino al tetto di tentativi tornano l'errore, mai budget_spent.
		for (let i = 0; i < MAX_STUDIES_PER_TURN * 2 - 1; i++) {
			const res = await exec(`ref-${i}`);
			expect(res.error).toContain('unreachable');
		}
		// L'ultimo tentativo disponibile RIESCE: il rimborso ha lasciato budget di studio vero.
		studyBehaviour = 'ok';
		const ok = await exec('ref-good');
		expect(ok.reference_id).toBe('ref-1');
		// E ora il tetto di tentativi è pieno: si costruisce da ciò che si ha.
		const capped = await exec('ref-late');
		expect(capped.error).toBe('watch_budget_spent');
	});
});
