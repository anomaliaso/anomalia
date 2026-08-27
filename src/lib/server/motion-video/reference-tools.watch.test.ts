/**
 * Il buco visto NEI DATI (agent_sessions, 2026-08-21): 4 studi su 7 in produzione erano
 * watch="spec_only" scelto dal modello — il compositore non riceveva un solo pixel della
 * reference e scriveva la TSX dal riassunto. Questi test fissano la coercizione: su una
 * sessione con vision lo studio porta SEMPRE i frame; spec_only resta solo per i caller
 * che non possono ricevere media (attachMedia=false).
 */
import { describe, expect, it, vi } from 'vitest';

type StudyOpts = { idOrSlug: string; withMedia?: boolean };
const studyCalls: StudyOpts[] = [];

vi.mock('$lib/server/motion-references', () => ({
	MAX_SEARCH_RESULTS: 8,
	MAX_STUDIES_PER_TURN: 3,
	buildabilityOf: () => ({ reachable: 1, total: 1 }),
	formatMotionReferenceSpec: () => 'SPEC',
	searchMotionReferences: vi.fn(async () => ({ references: [] })),
	studyMotionReference: vi.fn(async (opts: StudyOpts) => {
		studyCalls.push(opts);
		return {
			ok: true,
			reference: {
				id: opts.idOrSlug,
				brand: 'Linear',
				category: 'launch',
				watched: 'video',
				cached: false,
				reference_url: 'https://posts.design/x',
				source_url: 'https://x.com/x',
				spec: {
					format: 'announcement',
					duration_s: 10,
					beats: [],
					transitions: [],
					type_density: '',
					palette: ''
				}
			},
			media: opts.withMedia
				? {
						medium: 'video',
						durationS: 10,
						frames: [
							{ mimeType: 'image/jpeg', data: 'QUFB', label: 'frame 1' },
							{ mimeType: 'image/jpeg', data: 'QkJC', label: 'frame 2' }
						]
					}
				: null
		};
	})
}));
vi.mock('$lib/server/posts-design', () => ({ isPostsDesignEnabled: () => true }));
vi.mock('$lib/server/gemini', () => ({ geminiTransport: () => 'google' }));

import { createMotionReferenceTools, type ReferenceStudy } from './reference-tools';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (tools: Record<string, any>, input: Record<string, unknown>, callId: string) =>
	tools.study_motion_reference.execute(input, { toolCallId: callId });

describe('study_motion_reference — watch coercion', () => {
	it('spec_only chosen by the model is upgraded to frames on a vision session', async () => {
		const studies: ReferenceStudy[] = [];
		const tools = createMotionReferenceTools({
			brandName: 'B',
			modelId: 'gemini-3.7-flash',
			onReferenceStudied: (_id, s) => s && studies.push(s)
		});
		const res = await exec(tools, { reference_id: 'ref-a', watch: 'spec_only' }, 't1');
		expect(res.attached).toBe('frames');
		expect(res.watch_upgraded).toContain('spec_only');
		// La chiamata sotto ha chiesto i media davvero…
		expect(studyCalls.at(-1)?.withMedia).toBe(true);
		// …e i frame arrivano al canale prepareStep (messaggio utente su ogni step successivo).
		expect(studies[0]?.frames.length).toBeGreaterThan(0);
	});

	it('without vision (attachMedia=false) the study stays text-only, declared', async () => {
		const tools = createMotionReferenceTools({ brandName: 'B', attachMedia: false });
		const res = await exec(tools, { reference_id: 'ref-b', watch: 'frames' }, 't2');
		expect(res.attached).toBe('nothing');
		expect(studyCalls.at(-1)?.withMedia).toBe(false);
		expect(res.clip_refused).toContain('cannot receive media');
	});
});
