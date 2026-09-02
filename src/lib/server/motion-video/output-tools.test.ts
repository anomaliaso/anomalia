import { describe, expect, it, vi } from 'vitest';

// Giudice e persistenza finti, così il test guarda solo il contratto del tool result del render.
vi.mock('./persist', () => ({
	getMotionVideo: vi.fn(async () => ({
		id: 'video-1',
		source: 'export default function V() { return null; }',
		width: 1080,
		height: 1080
	})),
	updateMotionPreviewUrl: vi.fn(async () => ({ ok: true }))
}));
const stillsSpy = vi.fn(async ({ frames }: { frames: number[] }) => ({
	rendered: frames.map((frame) => ({ frame, png: Buffer.from(`png-${frame}`) })),
	failures: [] as Array<{ frame: number; error: string }>
}));
vi.mock('./render-tools', async () => {
	const actual = await vi.importActual<typeof import('./render-tools')>('./render-tools');
	return {
		...actual,
		renderMotionMp4: vi.fn(async () => ({ url: 'https://cdn.test/out.mp4', seconds: 42, bytes: 9_000_000 })),
		renderMotionStills: (...args: unknown[]) => stillsSpy(args[0] as { frames: number[] })
	};
});
// La VM c'è: senza questo lo storyboard si dichiarerebbe saltato e i test sotto guarderebbero
// il percorso sbagliato.
vi.mock('$lib/server/sandbox', () => ({ isSandboxConfigured: () => true }));
import {
	MAX_VIDEO_RENDERS_PER_DAY,
	MAX_VIDEO_RENDERS_PER_TURN,
	createMotionOutputTools,
	latestVoiceoverTakeUrl,
	motionRenderBudget,
	motionRendersToday,
	permanentMusicFailure
} from './output-tools';

/** Una catena Supabase finta: ogni filtro ritorna sé stessa, l'await risolve col conteggio. */
function fakeAiCallsClient(count: number | null, error: string | null = null) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const q: any = {
		eq: () => q,
		like: () => q,
		gte: () => q,
		then: (resolve: (v: unknown) => void) =>
			resolve(error ? { count: null, error: { message: error } } : { count, error: null })
	};
	return { from: () => ({ select: () => q }) } as never;
}

describe('motionRenderBudget — il tetto vive nel registro, non nella closure', () => {
	it('registro leggibile: tetto giornaliero per video, qualunque cosa dica il turno', () => {
		// Ogni slice di continuazione e ogni turno di patch della QC azzerava il contatore di
		// closure: 3 MP4 a sessione era la norma. Il conteggio dal registro non si azzera.
		expect(motionRenderBudget(MAX_VIDEO_RENDERS_PER_DAY, 0)).toMatchObject({
			blocked: true,
			scope: 'day'
		});
		expect(motionRenderBudget(MAX_VIDEO_RENDERS_PER_DAY - 1, 99)).toMatchObject({
			blocked: false,
			rendersLeft: 1,
			scope: 'day'
		});
	});

	it('registro illeggibile: ripiega sul vecchio tetto per turno invece di aprire il rubinetto', () => {
		expect(motionRenderBudget(null, MAX_VIDEO_RENDERS_PER_TURN)).toMatchObject({
			blocked: true,
			scope: 'turn'
		});
		expect(motionRenderBudget(null, 0).blocked).toBe(false);
	});

	it('la QC ha bisogno di un re-render: il tetto giornaliero lo lascia respirare', () => {
		// Bozza + due giri di QC + una correzione dell'utente devono starci.
		expect(MAX_VIDEO_RENDERS_PER_DAY).toBeGreaterThanOrEqual(4);
	});
});

describe('motionRendersToday', () => {
	it('conta le righe di addebito del giorno per QUESTO video', async () => {
		expect(await motionRendersToday(fakeAiCallsClient(3), 'b1', 'v1')).toBe(3);
	});
	it('registro rotto → null, mai zero: zero direbbe "via libera"', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await motionRendersToday(fakeAiCallsClient(null, 'boom'), 'b1', 'v1')).toBe(null);
		warn.mockRestore();
	});
});

describe('render_motion_video — la guardia consulta il registro prima di aprire la VM', () => {
	it('al tetto giornaliero rifiuta senza nemmeno leggere la riga del video', async () => {
		const tools = createMotionOutputTools({
			supabase: fakeAiCallsClient(MAX_VIDEO_RENDERS_PER_DAY) as never,
			brandId: 'b1',
			fps: () => 30
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await (tools.render_motion_video as any).execute(
			{ video_id: 'video-1' },
			{ toolCallId: 't', messages: [] }
		);
		expect(res.error).toBe('render_budget_spent');
		expect(res.hint).toContain('day');
	});
});


/**
 * Il PRIMO render_motion_video di ogni versione del sorgente torna lo STORYBOARD, non l'MP4 (vedi
 * storyboard.ts): questi test guardano quello che succede DOPO, cioè al secondo giro. Il primo
 * giro è asserito qui una volta sola, così ogni test sotto resta su ciò che gli interessa.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPastStoryboard(tools: any, input: Record<string, unknown> = { video_id: 'video-1' }) {
	const first = await tools.render_motion_video.execute(input, { toolCallId: 'sb', messages: [] });
	expect(first.retry).toBe('storyboard_first');
	expect(first.error).toBeUndefined();
	return await tools.render_motion_video.execute(input, { toolCallId: 't', messages: [] });
}

describe('render_motion_video — lo storyboard prima della VM', () => {
	it('il primo render torna le scene, NON l’MP4 — e i PNG arrivano davvero al modello', async () => {
		stillsSpy.mockClear();
		const tools = createMotionOutputTools({
			supabase: fakeAiCallsClient(0) as never,
			brandId: 'b1',
			fps: () => 30,
			remainingMs: () => 600_000
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const first = await (tools.render_motion_video as any).execute(
			{ video_id: 'video-1' },
			{ toolCallId: 'sb', messages: [] }
		);
		expect(first.retry).toBe('storyboard_first');
		expect(first.error).toBeUndefined();
		expect(first.url).toBeUndefined();
		expect(first.scenes).toBeGreaterThan(0);
		expect(stillsSpy).toHaveBeenCalledTimes(1);
		// I fotogrammi devono arrivare al MODELLO, non solo nel JSON: senza questo la VM è pagata
		// e il giudizio è alla cieca (stessa sonda di render-tools.ts).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = (tools.render_motion_video as any).toModelOutput({ toolCallId: 'sb', output: first });
		expect(out.type).toBe('content');
		expect(out.value.some((p: { type: string }) => p.type === 'image-data')).toBe(true);
		// …a OGNI chiamata: l'SDK ne fa più di una per lo stesso toolCallId.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((tools.render_motion_video as any).toModelOutput({ toolCallId: 'sb', output: first }).type).toBe(
			'content'
		);
	});

	it('il secondo giro sulla stessa sorgente rende davvero: guardare si fa una volta', async () => {
		const tools = createMotionOutputTools({
			supabase: fakeAiCallsClient(0) as never,
			brandId: 'b1',
			fps: () => 30,
			remainingMs: () => 600_000
		});
		const res = await renderPastStoryboard(tools);
		expect(res.url).toBe('https://cdn.test/out.mp4');
	});
});

describe('render_motion_video — il gate sulla voce rifiuta PRIMA della VM', () => {
	it('un MotionVoiceGateError torna come voice_gate_failed con il rimedio, non come render_failed', async () => {
		const { renderMotionMp4 } = await import('./render-tools');
		const { MotionVoiceGateError } = await import('./voice-gate');
		vi.mocked(renderMotionMp4).mockRejectedValueOnce(
			new MotionVoiceGateError(
				['il pezzo t-p3.wav è TRONCATO a metà parola'],
				'LA VOCE NON CI STA NEL VIDEO — si allunga il video, MAI si taglia la voce.'
			)
		);
		const tools = createMotionOutputTools({
			supabase: fakeAiCallsClient(0) as never,
			brandId: 'b1',
			fps: () => 30
		});
		const res = await renderPastStoryboard(tools);
		expect(res.error).toBe('voice_gate_failed');
		expect(res.must_fix).toBe(true);
		expect(res.violations[0]).toContain('TRONCATO');
		expect(res.fix_brief).toContain('si allunga il video');
	});
});

describe('permanentMusicFailure — classi, non stringhe esatte', () => {
	it('config/ambiente = permanente: il retry comprerebbe lo stesso errore', () => {
		for (const msg of [
			'models/lyria-x answered 404. NOT_FOUND',
			'answered 422. INVALID_ARGUMENT',
			'If this model id is wrong for the current Gemini suite, set GEMINI_MUSIC_MODEL.',
			'GEMINI_API_KEY is not configured — no audio can be generated.'
		]) {
			expect(permanentMusicFailure(msg), msg).toBe(true);
		}
	});
	it('passeggero = ritentabile', () => {
		for (const msg of ['answered 429. RESOURCE_EXHAUSTED', 'answered 503. UNAVAILABLE', 'fetch failed']) {
			expect(permanentMusicFailure(msg), msg).toBe(false);
		}
	});
});

describe('cut_voiceover attraverso le slice', () => {
	function fakeStorageClient(files: Array<{ name: string }>) {
		return {
			storage: {
				from: () => ({
					list: async () => ({ data: files, error: null }),
					getPublicUrl: (path: string) => ({ data: { publicUrl: `https://media.example/${path}` } })
				})
			}
		} as never;
	}

	it('lo schema accetta labels: un taglio via url può ancora etichettare i pezzi', async () => {
		const tools = createMotionOutputTools({
			supabase: fakeStorageClient([]) as never,
			brandId: 'b1',
			fps: () => 30
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const schema = (tools.cut_voiceover as any).inputSchema;
		expect(() =>
			schema.parse({ at_seconds: [1.5], url: 'https://x/full.wav', labels: ['riga 1', 'riga 2'] })
		).not.toThrow();
	});

	it('senza take in QUESTA slice ritrova quello dello storage — mai "record again"', async () => {
		// `lastTake` è stato di closure e muore con la slice: il vecchio hint istruiva a
		// riregistrare, ed era l'origine dei take doppi (una seconda registrazione è una seconda voce).
		const tools = createMotionOutputTools({
			supabase: fakeStorageClient([{ name: 'zz-clip-3.wav' }, { name: 'abc-full.wav' }]) as never,
			brandId: 'b1',
			fps: () => 30
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await (tools.cut_voiceover as any).execute(
			{ at_seconds: [1] },
			{ toolCallId: 't', messages: [] }
		);
		expect(res.error).toBe('no_take_in_this_slice');
		expect(res.take_url).toBe('https://media.example/b1/voiceover/abc-full.wav');
		expect(res.hint).toContain('Do NOT record');
	});

	it('nessun take da nessuna parte: allora sì, si registra', async () => {
		const tools = createMotionOutputTools({
			supabase: fakeStorageClient([]) as never,
			brandId: 'b1',
			fps: () => 30
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await (tools.cut_voiceover as any).execute(
			{ at_seconds: [1] },
			{ toolCallId: 't', messages: [] }
		);
		expect(res.error).toBe('no_take');
	});

	it('latestVoiceoverTakeUrl prende solo i take interi, non i pezzi già tagliati', async () => {
		expect(
			await latestVoiceoverTakeUrl(fakeStorageClient([{ name: 'a-clip-1.wav' }]) as never, 'b1')
		).toBe(null);
	});
});

describe('audio senza tetto — provare non si paga a slot', () => {
	it('voce e musica si generano quante volte servono', async () => {
		vi.doMock(import('$lib/server/gemini-audio'), async (importOriginal) => ({
			...(await importOriginal()),
			generateVoiceOver: (async () => ({
				voice: 'calm',
				fullUrl: 'https://cdn.test/voiceover/take.wav',
				fullDurationSeconds: 4,
				gaps: []
			})) as never,
			generateMusicBed: (async () => ({ url: 'https://cdn.test/music/bed.wav', durationSeconds: 30 })) as never
		}));
		vi.resetModules();
		const { createMotionOutputTools: make } = await import('./output-tools');
		const tools = make({ supabase: {} as never, brandId: 'b1', fps: () => 30 });

		for (let attempt = 1; attempt <= 3; attempt++) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const voice = await (tools.generate_voiceover as any).execute(
				{ lines: [`riga ${attempt}`] },
				{ toolCallId: 't', messages: [] }
			);
			expect(voice.error, `voce ${attempt}`).toBeUndefined();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const music = await (tools.generate_music as any).execute(
				{ prompt: `pads ${attempt}`, seconds: 10 },
				{ toolCallId: 't', messages: [] }
			);
			expect(music.error, `musica ${attempt}`).toBeUndefined();
		}

		vi.doUnmock('$lib/server/gemini-audio');
		vi.resetModules();
	});

	it('un fallimento passeggero non toglie niente: il tentativo dopo parte', async () => {
		let calls = 0;
		vi.doMock(import('$lib/server/gemini-audio'), async (importOriginal) => ({
			...(await importOriginal()),
			generateVoiceOver: (async () => {
				calls += 1;
				if (calls < 3) throw new Error('kie timed out');
				return { voice: 'calm', fullUrl: 'https://cdn.test/voiceover/take.wav', fullDurationSeconds: 4, gaps: [] };
			}) as never
		}));
		vi.resetModules();
		const { createMotionOutputTools: make } = await import('./output-tools');
		const tools = make({ supabase: {} as never, brandId: 'b1', fps: () => 30 });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const run = () => (tools.generate_voiceover as any).execute({ lines: ['ciao'] }, { toolCallId: 't', messages: [] });
		expect((await run()).error).toBe('voiceover_failed');
		expect((await run()).error).toBe('voiceover_failed');
		expect((await run()).url).toBe('https://cdn.test/voiceover/take.wav');

		vi.doUnmock('$lib/server/gemini-audio');
		vi.resetModules();
	});
});

describe('generate_music — il permanente spegne la musica, il passeggero no', () => {
	it('dopo un 404 il tentativo successivo non ricompra lo stesso errore', async () => {
		vi.doMock(import('$lib/server/gemini-audio'), async (importOriginal) => ({
			...(await importOriginal()),
			generateMusicBed: (async () => {
				throw new Error('models/x answered 404. NOT_FOUND. set GEMINI_MUSIC_MODEL.');
			}) as never
		}));
		vi.resetModules();
		const { createMotionOutputTools: make } = await import('./output-tools');
		const tools = make({ supabase: {} as never, brandId: 'b1', fps: () => 30 });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const first = await (tools.generate_music as any).execute(
			{ prompt: 'minimal pads', seconds: 10 },
			{ toolCallId: 't', messages: [] }
		);
		expect(first.error).toBe('music_failed');
		expect(first.retryable).toBe(false);
		expect(first.hint).toContain('retrying cannot fix it');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const second = await (tools.generate_music as any).execute(
			{ prompt: 'different pads', seconds: 10 },
			{ toolCallId: 't', messages: [] }
		);
		expect(second.error).toBe('music_unavailable');
		vi.doUnmock('$lib/server/gemini-audio');
		vi.resetModules();
	});
});
