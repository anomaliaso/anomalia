import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createTestSupabase } from '$lib/testkit/supabase';
import { defaultMotionSource } from '$lib/motion-video/source';
import { createApplyTool, type ApplyToolDeps } from '../executor';
import { createMemoryBrandFs, createMemorySandbox, createMemoryStore, fakeContext } from '../testkit';

// Il render VERO gira in una VM — nei test si mocka il modulo server, come richiesto: si
// verifica CHE venga chiamato con l'id giusto e che il risultato propaghi preview_url, mai la VM
// vera. `readSourceMeta`/`defaultStillFrames`/`framesFromSeconds` restano reali (puri).
const renderMotionMp4 = vi.fn();
const renderMotionStills = vi.fn();
vi.mock('$lib/server/motion-video/render-tools', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/motion-video/render-tools')>();
	return { ...actual, renderMotionMp4, renderMotionStills };
});

const publishMotionStillArtifacts = vi.fn();
vi.mock('$lib/server/motion-video/still-artifacts', () => ({
	publishMotionStillArtifacts
}));

const generateVoiceOver = vi.fn();
const generateMusicBed = vi.fn();
vi.mock('$lib/server/gemini-audio', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/gemini-audio')>();
	return { ...actual, generateVoiceOver, generateMusicBed };
});

/**
 * IL TURNO DELEGATO — `motion_write` non scrive piu` TSX: passa il brief all'agente motion
 * (`run-turn.ts`), che ha il mestiere intero nel proprio system. Qui si mocka quel turno per
 * verificare il CONTRATTO del tool — cosa gli passa, cosa riporta indietro, cosa non riporta —
 * mai il modello vero.
 */
const runMotionVideoTurn = vi.fn();
vi.mock('$lib/server/motion-video/run-turn', () => ({ runMotionVideoTurn }));

const { createMotionPlugin, MOTION_PLUGIN_TOOLS, MOTION_AUDIO_MAP } = await import('./motion');

const BRAND_ID = 'b1';
const USER_ID = 'u1';

/** Sorgente valida che compila E passa i 5 gate di craft (misurato: dead/linear/duration/frozen/stalls tutti vuoti). */
const VALID_SOURCE = defaultMotionSource({
	brandName: 'Acme',
	accent: '#ff0000',
	colors: ['#ff0000', '#000000'],
	displayFont: null,
	bodyFont: null,
	logoUrl: null
});

/** L'esatta forma insegnata dal cookbook e che rompe al render: `slide` sta in '@remotion/transitions/slide', non nella radice. */
const BAD_IMPORT_SOURCE = `import React from 'react';
import { AbsoluteFill } from 'remotion';
import { slide } from '@remotion/transitions';

export const fps = 30;
export const durationInFrames = 90;
export const width = 1080;
export const height = 1080;

export default function MotionVideo() {
	return <AbsoluteFill />;
}
`;

function motionRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'v1',
		brand_id: BRAND_ID,
		user_id: USER_ID,
		title: 'Existing',
		source: VALID_SOURCE,
		preview_url: null,
		fps: 30,
		duration_in_frames: 180,
		width: 1080,
		height: 1080,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		...overrides
	};
}

beforeEach(() => {
	renderMotionMp4.mockReset();
	renderMotionStills.mockReset();
	publishMotionStillArtifacts.mockReset().mockResolvedValue([]);
});

describe('motion_edit — il gate di craft blocca prima di salvare', () => {
	it('un replace che inietta l’import sbagliato di @remotion/transitions non tocca la riga', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{
				name: 'motion_edit',
				args: {
					id: 'v1',
					op: 'replace',
					old_string: "import React from 'react';",
					new_string: "import React from 'react';\nimport { slide } from '@remotion/transitions';"
				}
			},
			fakeContext()
		);
		expect(res.isError).toBe(true);
		const text = (res.content[0] as { text: string }).text;
		expect(text).toContain('slide');
		expect(text).toContain('@remotion/transitions/slide');
		expect(kit.tables.get('motion_videos')![0].source).toBe(VALID_SOURCE);
	});
});

describe('motion_edit — editing mirato del sorgente salvato', () => {
	const BG_LINE = "const bg = '#050505';";
	const BRAND_LINE = "const brand = 'Acme';";

	it("lo schema richiede id+op, le op sono 'replace' e 'grep', ed è agent-only", () => {
		const spec = MOTION_PLUGIN_TOOLS.find((t) => t.name === 'motion_edit')!;
		expect(spec.requiresMode).toBe('agent');
		expect(spec.inputSchema.required).toEqual(['id', 'op']);
		const props = spec.inputSchema.properties as Record<string, { enum?: string[] }>;
		expect(props.op.enum).toEqual(['replace', 'grep']);
		expect(spec.description).toMatch(/preferred/i);
	});

	it('grep elenca le righe col numero, senza guardare il maiuscolo/minuscolo', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const n = VALID_SOURCE.split('\n').findIndex((l) => l.includes("'Acme'")) + 1;
		const res = await plugin.execute(
			{ name: 'motion_edit', args: { id: 'v1', op: 'grep', pattern: "BRAND = 'ACME'" } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.matches).toBe(1);
		expect(out.lines[0]).toContain(`${n}: ${BRAND_LINE}`);
	});

	it('grep senza pattern fallisce', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'motion_edit', args: { id: 'v1', op: 'grep' } }, fakeContext());
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toContain('pattern');
	});

	it('replace su testo unico applica, salva con gli stessi gate e mantiene il titolo', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'motion_edit', args: { id: 'v1', op: 'replace', old_string: BG_LINE, new_string: "const bg = '#101010';" } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.status).toBe('source_saved_not_rendered');
		const rows = kit.tables.get('motion_videos')!;
		expect(rows[0].source).toContain("#101010'");
		expect(rows[0].source).not.toContain('#050505');
		expect(rows[0].title).toBe('Existing');
	});

	it('replace multi-occorrenza senza replace_all rifiuta col numero di occorrenze, la riga resta com’era', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const occurrences = VALID_SOURCE.split('BEAT_1').length - 1;
		const res = await plugin.execute(
			{ name: 'motion_edit', args: { id: 'v1', op: 'replace', old_string: 'BEAT_1', new_string: 'BEAT_X' } },
			fakeContext()
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toContain(`${occurrences} times`);
		expect(kit.tables.get('motion_videos')![0].source).toBe(VALID_SOURCE);
	});

	it('replace_all sostituisce tutte le occorrenze e salva', async () => {
		const seeded = VALID_SOURCE.replace(BG_LINE, `const label = 'todo';\nconst other = 'todo';\n${BG_LINE}`);
		const kit = createTestSupabase({ motion_videos: [motionRow({ source: seeded })] });
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{
				name: 'motion_edit',
				args: { id: 'v1', op: 'replace', old_string: 'todo', new_string: 'done', replace_all: true }
			},
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		const rows = kit.tables.get('motion_videos')!;
		expect(rows[0].source.match(/'done'/g)).toHaveLength(2);
		expect(rows[0].source).not.toContain('todo');
	});

	it('replace su un id inesistente fallisce', async () => {
		const kit = createTestSupabase();
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'motion_edit', args: { id: 'nope', op: 'replace', old_string: 'a', new_string: 'b' } },
			fakeContext()
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toContain('not found');
	});

	it('il gate gira sul SORGENTE RISULTANTE: un import rotto introdotto dalla replace blocca il salvataggio', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute(
			{ name: 'motion_edit', args: { id: 'v1', op: 'replace', old_string: BG_LINE, new_string: BAD_IMPORT_SOURCE } },
			fakeContext()
		);
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toContain('@remotion/transitions/slide');
		expect(kit.tables.get('motion_videos')![0].source).toBe(VALID_SOURCE);
	});
});

describe('motion_render', () => {
	it('id inesistente → errore che insegna, nessuna chiamata al renderer', async () => {
		const kit = createTestSupabase();
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'motion_render', args: { id: 'nope' } }, fakeContext());
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toContain('not found');
		expect(renderMotionMp4).not.toHaveBeenCalled();
	});

	it('chiama il renderer VERO col l’id giusto e propaga preview_url — la VM è mockata (mutazione 3)', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		renderMotionMp4.mockResolvedValue({ url: 'https://cdn.test/v1.mp4', bytes: 4_200_000, seconds: 42 });
		const remainingMs = () => 420_000;
		const signal = new AbortController().signal;
		const plugin = createMotionPlugin({
			supabase: kit.client,
			brandId: BRAND_ID,
			userId: USER_ID,
			remainingMs
		});
		const res = await plugin.execute({ name: 'motion_render', args: { id: 'v1' } }, fakeContext({ signal }));

		expect(renderMotionMp4).toHaveBeenCalledTimes(1);
		expect(renderMotionMp4.mock.calls[0][0]).toMatchObject({
			brandId: BRAND_ID,
			videoId: 'v1',
			source: VALID_SOURCE,
			remainingMs,
			abortSignal: signal
		});

		expect(res.isError).toBeFalsy();
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.preview_url).toBe('https://cdn.test/v1.mp4');
		expect(out.render_seconds).toBe(42);
		const rows = kit.tables.get('motion_videos') ?? [];
		expect(rows[0].preview_url).toBe('https://cdn.test/v1.mp4');
	});

	it('un fallimento del renderer torna intero, non riassunto', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		renderMotionMp4.mockRejectedValue(new Error('remotion render failed: TypeError at frame 47'));
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'motion_render', args: { id: 'v1' } }, fakeContext());
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toBe('remotion render failed: TypeError at frame 47');
	});

	it('la morte della VM dice di riprovare lo stesso id, non di inventarne uno nuovo', async () => {
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		renderMotionMp4.mockRejectedValue(
			new Error(
				'The render VM shut down while a command was running (Sandbox stream was closed). In-flight sandbox commands are not resumed. The source is already saved — retry the render on the SAME video id from a fresh turn. Do not create a new composition: a new id still hits this brand\'s VM and does not overwrite the old gallery MP4 anyway.'
			)
		);
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'motion_render', args: { id: 'v1' } }, fakeContext());
		expect(res.isError).toBe(true);
		const text = (res.content[0] as { text: string }).text;
		expect(text).toContain('SAME video id');
		expect(text).toContain('Do not create a new composition');
		expect(kit.tables.get('motion_videos')?.[0].preview_url).toBeNull();
	});
});

describe('motion_list', () => {
	it('elenca id, titolo, stato derivato da preview_url', async () => {
		const kit = createTestSupabase({
			motion_videos: [motionRow({ id: 'v1', preview_url: null }), motionRow({ id: 'v2', preview_url: 'https://x/y.mp4' })]
		});
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'motion_list', args: {} }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.videos).toHaveLength(2);
		expect(out.videos.find((v: { id: string }) => v.id === 'v1').status).toBe('source_saved_not_rendered');
		expect(out.videos.find((v: { id: string }) => v.id === 'v2').status).toBe('rendered');
	});

	it('ogni voce porta la data e il path dove il sorgente si legge davvero', async () => {
		const kit = createTestSupabase({
			motion_videos: [motionRow({ id: 'v1', created_at: '2026-03-04T10:00:00Z', updated_at: '2026-03-05T11:00:00Z' })]
		});
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'motion_list', args: {} }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.videos[0].created_at).toBe('2026-03-04T10:00:00Z');
		expect(out.videos[0].updated_at).toBe('2026-03-05T11:00:00Z');
		expect(out.videos[0].source_path).toBe('artifacts/motion/v1.md');
	});

	it('la descrizione del tool dice dove si legge il codice e con cosa si riscrive', () => {
		const spec = MOTION_PLUGIN_TOOLS.find((t) => t.name === 'motion_list')!;
		expect(spec.description).toContain('artifacts/motion/<id>.md');
		expect(spec.description).toContain('brand_read');
		expect(spec.description).toContain('motion_write');
	});
});

describe('il plugin si risolve per nome dall’executor', () => {
	function baseDeps(overrides: Partial<ApplyToolDeps> = {}): ApplyToolDeps {
		return {
			brandFs: createMemoryBrandFs(),
			sandbox: createMemorySandbox(),
			sandboxRef: null,
			memory: createMemoryStore(),
			plugins: [],
			...overrides
		};
	}

	it('createApplyTool smista motion_write sul plugin, non su unknownToolError', async () => {
		const kit = createTestSupabase();
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		expect(plugin.tools.map((t) => t.name)).toEqual([
			...MOTION_PLUGIN_TOOLS.map((t) => t.name),
			...Object.keys(MOTION_AUDIO_MAP)
		]);

		const apply = createApplyTool(baseDeps({ plugins: [plugin] }));
		const res = await apply({ name: 'motion_write', args: {} }, fakeContext());
		// Smistato al plugin: il rifiuto e` quello di motion_write sul brief mancante, non
		// `unknownToolError`. Con un brief vero partirebbe un turno di modello.
		expect((res.content[0] as { text: string }).text).toContain('brief');
	});

	it('un nome sconosciuto resta un errore che nomina i tool disponibili', async () => {
		const kit = createTestSupabase();
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const apply = createApplyTool(baseDeps({ plugins: [plugin] }));
		const res = await apply({ name: 'motion_teleport', args: {} }, fakeContext());
		expect(res.isError).toBe(true);
		expect((res.content[0] as { text: string }).text).toContain('motion_write');
	});
});

describe('voce e musica — le craft specs le vogliono accese di default, quindi il mestiere le monta', () => {
	beforeEach(() => {
		generateVoiceOver.mockReset().mockResolvedValue({
			voice: 'narrator',
			fullUrl: 'https://cdn.test/voiceover/take-1.wav',
			fullDurationSeconds: 4,
			gaps: [{ atSeconds: 2, durationSeconds: 0.4 }]
		});
		generateMusicBed.mockReset().mockResolvedValue({ url: 'https://cdn.test/music/bed-1.wav', seconds: 30 });
	});

	function audioPlugin() {
		const kit = createTestSupabase({
			brands: [{ id: BRAND_ID, name: 'Acme', plan: 'starter', timezone: 'Europe/Rome', content_prefs: {} }]
		});
		return createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID, threadId: 't1', locale: 'it' });
	}

	it('i tre tool sono montati accanto a write/render', () => {
		const names = audioPlugin().tools.map((t) => t.name);
		expect(names).toContain('motion_voiceover');
		expect(names).toContain('motion_cut_voiceover');
		expect(names).toContain('motion_music');
	});

	it('motion_voiceover registra sul serio e torna url + durata in fotogrammi (non un video muto)', async () => {
		const res = await audioPlugin().execute(
			{ name: 'motion_voiceover', args: { lines: ['Prima riga', 'Seconda riga'] } },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(generateVoiceOver).toHaveBeenCalledTimes(1);
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.url).toBe('https://cdn.test/voiceover/take-1.wav');
		expect(out.duration_frames).toBe(120);
		expect(out.pauses).toEqual([{ at_seconds: 2, length_seconds: 0.4 }]);
	});

	it('motion_cut_voiceover senza take rifiuta invece di inventare un url', async () => {
		const res = await audioPlugin().execute({ name: 'motion_cut_voiceover', args: { at_seconds: [2] } }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.error).toBe('no_take');
		expect(out.url).toBeUndefined();
	});
});

describe('motion_stills — i fotogrammi finiscono in chat, non solo negli occhi del modello', () => {
	it('pubblica un artefatto per frame, ancorato alla chiamata, e lo dichiara nel risultato', async () => {
		const png = Buffer.from('png-bytes');
		renderMotionStills.mockResolvedValue({
			rendered: [{ frame: 30, png }, { frame: 90, png }],
			failures: []
		});
		publishMotionStillArtifacts.mockResolvedValue([
			{ id: 'a1', title: 'Existing · frame 30', file_name: 'still-f30.png', kind: 'image', bytes: 9, url: 'https://cdn.test/f30.png' },
			{ id: 'a2', title: 'Existing · frame 90', file_name: 'still-f90.png', kind: 'image', bytes: 9, url: 'https://cdn.test/f90.png' }
		]);
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		const plugin = createMotionPlugin({
			supabase: kit.client,
			brandId: BRAND_ID,
			userId: USER_ID,
			threadId: 't1'
		});
		const res = await plugin.execute(
			{ name: 'motion_stills', args: { id: 'v1' }, id: 'call-stills' },
			fakeContext()
		);
		expect(res.isError).toBeFalsy();
		expect(publishMotionStillArtifacts).toHaveBeenCalledTimes(1);
		expect(publishMotionStillArtifacts.mock.calls[0][0]).toMatchObject({
			brandId: BRAND_ID,
			userId: USER_ID,
			threadId: 't1',
			toolCallId: 'call-stills',
			title: 'Existing'
		});
		expect(publishMotionStillArtifacts.mock.calls[0][0].frames).toHaveLength(2);
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.shown_in_chat).toBe(true);
		expect(out.artifacts).toEqual([
			{ id: 'a1', url: 'https://cdn.test/f30.png', title: 'Existing · frame 30' },
			{ id: 'a2', url: 'https://cdn.test/f90.png', title: 'Existing · frame 90' }
		]);
		expect(out.media).toEqual([
			{ url: 'https://cdn.test/f30.png', caption: 'Existing · frame 30' },
			{ url: 'https://cdn.test/f90.png', caption: 'Existing · frame 90' }
		]);
		const images = res.content.filter((c) => c.type === 'image');
		expect(images).toHaveLength(2);
	});

	it('senza thread i PNG restano per il modello e shown_in_chat è false', async () => {
		renderMotionStills.mockResolvedValue({
			rendered: [{ frame: 0, png: Buffer.from('x') }],
			failures: []
		});
		publishMotionStillArtifacts.mockResolvedValue([]);
		const kit = createTestSupabase({ motion_videos: [motionRow()] });
		const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
		const res = await plugin.execute({ name: 'motion_stills', args: { id: 'v1' } }, fakeContext());
		const out = JSON.parse((res.content[0] as { text: string }).text);
		expect(out.shown_in_chat).toBe(false);
		expect(out.artifacts).toEqual([]);
		expect(res.content.some((c) => c.type === 'image')).toBe(true);
	});
});

/**
 * IL BRIEF ENTRA, LA COMPOSIZIONE ESCE.
 *
 * L'agente kit scriveva la TSX da se`, con sei righe di spec e il ricettario dietro un file che
 * nessun cancello lo obbligava a leggere: usciva una composizione in una botta sola, senza
 * reference e senza rifinitura. Ora `motion_write` prende un brief in prosa e lo passa all'agente
 * motion, che quel mestiere ce l'ha nel system a ogni turno — insieme al rifiuto della one-shot
 * che qui non e` mai esistito.
 */
describe('motion_write — il brief entra, la composizione esce', () => {




	/**
	 * IL LAVORO LUNGO NON BLOCCA PIU` L'AGENTE.
	 *
	 * Un turno delegato misurato oggi: 37 minuti per UNA chiamata di tool. Tenere l'agente
	 * fermo li` dentro significa nessun avanzamento visibile, nessun modo di intervenire, e un
	 * turno di chat che muore contro il muro mentre il lavoro e` a meta`. Ora `motion_write`
	 * ACCODA un job designer — la stessa macchina che la pagina usa da sempre, con il suo
	 * avanzamento scritto in diretta su `chat_jobs.partial` — e torna subito il suo id.
	 */
	describe('accoda invece di bloccare', () => {
		it('torna un job_id e NON esegue il turno nel frattempo', async () => {
			const kit = createTestSupabase();
			const plugin = createMotionPlugin({
				supabase: kit.client,
				brandId: BRAND_ID,
				userId: USER_ID,
				origin: 'https://app.test'
			});
			const res = await plugin.execute(
				{ name: 'motion_write', args: { brief: 'trailer di lancio, tre beat' } },
				fakeContext()
			);
			expect(res.isError).toBeFalsy();
			const out = JSON.parse((res.content[0] as { text: string }).text);
			expect(out.job_id).toBeTruthy();
			expect(out.status).toBe('queued');
			// Il turno vero lo fa il drain, non questa chiamata.
			expect(runMotionVideoTurn).not.toHaveBeenCalled();
		});

		it('la riga accodata e` PENDING, o il drain non la raccoglie mai', async () => {
			const kit = createTestSupabase();
			const plugin = createMotionPlugin({
				supabase: kit.client, brandId: BRAND_ID, userId: USER_ID, origin: 'https://app.test'
			});
			await plugin.execute({ name: 'motion_write', args: { brief: 'un lancio' } }, fakeContext());
			const rows = kit.tables.get('chat_jobs') ?? [];
			expect(rows).toHaveLength(1);
			expect(rows[0].status).toBe('pending');
			expect(rows[0].tool_name).toBe('motion_video');
			expect((rows[0].input_params as Record<string, unknown>).prompt).toContain('un lancio');
			expect((rows[0].input_params as Record<string, unknown>).origin).toBe('https://app.test');
		});

		it('senza origin non accoda promesse che nessuno drenera`', async () => {
			const kit = createTestSupabase();
			const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
			const res = await plugin.execute({ name: 'motion_write', args: { brief: 'x' } }, fakeContext());
			expect(res.isError).toBe(true);
			expect(kit.tables.get('chat_jobs') ?? []).toHaveLength(0);
		});
	});

	/**
	 * E L'AGENTE DEVE POTER GUARDARE. Un job che nessuno puo` interrogare e` un lavoro promesso
	 * e mai piu` visto: senza questo, l'unico modo di sapere com'e` finita sarebbe indovinare.
	 */
	describe('motion_check — l’avanzamento si legge, non si indovina', () => {
		it('riporta lo stato, i tool in corso e cosa e` stato scritto finora', async () => {
			const kit = createTestSupabase({
				chat_jobs: [
					{
						id: 'j1',
						brand_id: BRAND_ID,
						user_id: USER_ID,
						tool_name: 'designer_motion',
						status: 'running',
						input_params: { prompt: 'un lancio' },
						partial: {
							text: 'sto costruendo il secondo beat',
							tools: [{ toolCallId: 'a', toolName: 'write_source', status: 'done' }],
							at: Date.now()
						},
						created_at: '2026-08-26T10:00:00Z'
					}
				]
			});
			const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
			const res = await plugin.execute({ name: 'motion_check', args: { job_id: 'j1' } }, fakeContext());
			expect(res.isError).toBeFalsy();
			const out = JSON.parse((res.content[0] as { text: string }).text);
			expect(out.status).toBe('running');
			expect(out.progress).toContain('secondo beat');
			expect(out.tools).toContain('write_source:done');
		});

		/**
		 * La causa non deve morire nel job. Prima che il lavoro fosse accodato questo lo diceva
		 * `motion_write`; adesso il turno vero gira altrove, quindi l'unico posto dove l'agente
		 * puo` leggere PERCHE` e` finita male e` qui — o torna a dire «riprova» su un guasto che
		 * nessuna riformulazione ripara.
		 */
		it('un job fallito porta la causa, e non manda a renderizzare', async () => {
			const kit = createTestSupabase({
				chat_jobs: [
					{
						id: 'j2', brand_id: BRAND_ID, user_id: USER_ID, tool_name: 'motion_video',
						status: 'failed', error: "Invalid value at 'inline_data' (data)",
						partial: { text: '', tools: [] }, created_at: 'x'
					}
				]
			});
			const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
			const res = await plugin.execute({ name: 'motion_check', args: { job_id: 'j2' } }, fakeContext());
			const out = JSON.parse((res.content[0] as { text: string }).text);
			expect(out.status).toBe('failed');
			expect(out.error).toContain('inline_data');
			expect(out.next_step).not.toBe('motion_render');
		});

		it('un job di un altro brand non si legge', async () => {
			const kit = createTestSupabase({
				chat_jobs: [{ id: 'j9', brand_id: 'altro', user_id: USER_ID, tool_name: 'designer_motion', status: 'running', created_at: 'x' }]
			});
			const plugin = createMotionPlugin({ supabase: kit.client, brandId: BRAND_ID, userId: USER_ID });
			const res = await plugin.execute({ name: 'motion_check', args: { job_id: 'j9' } }, fakeContext());
			expect(res.isError).toBe(true);
		});
	});

	/**
	 * IL 26/8: tre turni morti in un secondo su un errore del provider Gemini
	 * (`inline_data.data` oggetto invece che scalare) e il tool ha risposto «no composition»
	 * senza la causa. `onError` la cattura, ma `toUIMessageStreamResponse` non la rilancia al
	 * chiamante: senza questo passaggio la ragione vive solo in `ai_calls`, e chi deve decidere
	 * cosa fare dopo non ce l'ha.
	 */

});
