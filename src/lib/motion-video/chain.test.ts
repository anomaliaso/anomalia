import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MOTION_LIBRARY } from './library';
import { defaultMotionSource } from './source';
import { compileMotionSource } from './compile';
import {
	findDeadEntrances,
	findDurationMismatch,
	findFrozenBackplate,
	findLinearMotion,
	findStaticTails,
	formatDeadEntrances,
	formatDurationMismatch,
	formatEasingViolations,
	formatFrozenBackplate,
	formatStasisViolations
} from './easing';
import { findVoiceAudioRefs } from './voice-gate';
import { saveMotionVideo, getMotionVideo } from '$lib/server/motion-video/persist';
import { readSourceMeta } from '$lib/server/motion-video/render-tools';
import { assertMotionVoiceGate } from '$lib/server/motion-video/voice-gate';
import { createStoryboardGate, storyboardFrames } from '$lib/server/motion-video/storyboard';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * IL COLLAUDO DELLA CATENA MINIMA — crea → renderizza → allega, senza il modello in mezzo.
 *
 * PERCHE' ESISTE. Ogni anello aveva i suoi test e nessuno percorreva la catena: i cancelli
 * (easing.test.ts, voice-gate.test.ts), il ricettario (transitions-cookbook.test.ts), il tetto
 * aritmetico (output-tools.test.ts), la libreria voce per voce (library.test.ts). Tutti verdi, e
 * l'unico collaudo del prodotto intero restava una prova a mano in chat — con un modello in mezzo
 * che confonde le acque. Se la catena e' rotta sotto, nessuna riparazione del prompt si vede mai.
 *
 * Qui il sorgente e' una COSTANTE: il seme di `create_motion_video` senza `source` (la funzione
 * pura che lo produce) e una voce della libreria gia' cotta con il suo MP4. Nessuna chiamata a un
 * modello, nessuna VM, nessuna scrittura in produzione. Ogni `it` e' un anello, e il suo nome e'
 * la riga che si legge quando si rompe.
 *
 * QUELLO CHE HA GIA' TROVATO: `readSourceMeta` legge `durationInFrames` con una regex sui soli
 * numeri letterali, e 17 voci su 20 della libreria — quelle che l'agente e' istruito a COPIARE —
 * lo calcolano (`Math.round(BEAT * fps) * STEPS`). Il gate sulla voce dentro `renderMotionMp4`
 * giudicava quindi un video da 180 frame mentre ne uscivano 110: due secondi e mezzo di bugia,
 * cioe' esattamente lo spazio in cui una battuta viene mozzata senza che nessuno se ne accorga.
 * L'anello 4 e' il controllo che lo rifiuta.
 *
 * PERCHE' NON RENDERIZZA. Il render vero (`renderMotionMp4`) apre una microVM, scrive nel bucket
 * `media`, aggiorna `motion_videos` e scala i crediti del brand: e' una spesa e tre scritture in
 * produzione, cioe' l'opposto di quello che deve fare un test che gira a ogni `npm run test:unit`.
 * La prova che quel sorgente RENDERIZZA si versiona gia' — `bake-manifest.json`, scritto dalla
 * stessa VM del render di produzione, con l'impronta del sorgente cotto. Il secondo livello,
 * esplicito e a richiesta, e' il comando che ha scritto quel manifesto:
 *
 *     FORCE=1 npm run bake:motion-library -- posts/1-carousel-pullback
 *
 * cioe' l'anello 6 rifatto davvero, senza database e senza crediti. Non ne serve un secondo.
 */

/**
 * LA VOCE SOTTO COLLAUDO. E' quella piu' vicina alla catena vera — un carosello approvato che
 * diventa movimento — e calcola la propria durata, che e' la forma su cui l'anello 4 morde.
 */
const ENTRY_ID = 'posts/1-carousel-pullback';
const REPO = process.cwd();

const entry = MOTION_LIBRARY.find((e) => e.id === ENTRY_ID);
if (!entry) {
	throw new Error(
		`Il collaudo punta a "${ENTRY_ID}", che non e' piu' nella libreria. Voci presenti: ${MOTION_LIBRARY.map((e) => e.id).join(', ')}. Cambia ENTRY_ID in questo file, non la libreria.`
	);
}

/** Il seme: quello che `create_motion_video` scrive quando il modello NON passa un sorgente. */
const SEED = defaultMotionSource({
	brandName: 'Anomalia',
	accent: '#c485fe',
	colors: ['#c485fe', '#050505'],
	displayFont: 'Inter',
	bodyFont: 'Inter',
	logoUrl: ''
});

/** I due sorgenti noti che percorrono la catena. Nessuno dei due esce da un modello. */
const SUBJECTS: Array<{ name: string; source: string }> = [
	{ name: 'seme', source: SEED },
	{ name: ENTRY_ID, source: entry.code }
];

/**
 * `motion_videos` in memoria: insert → select, gli unici due verbi che la catena usa. Serve a far
 * passare la riga dai DUE lati veri (`saveMotionVideo` scrive, `getMotionVideo` rilegge) senza
 * toccare la produzione.
 */
function fakeMotionVideos() {
	const rows: Record<string, Record<string, unknown>> = {};
	let n = 0;
	const from = (table: string) => {
		expect(table).toBe('motion_videos');
		return {
			insert: (payload: Record<string, unknown>) => ({
				select: () => ({
					maybeSingle: async () => {
						const id = `row-${++n}`;
						rows[id] = { id, preview_url: null, ...payload };
						return { data: rows[id], error: null };
					}
				})
			}),
			select: () => {
				const filters: Record<string, unknown> = {};
				const q = {
					eq: (col: string, val: unknown) => {
						filters[col] = val;
						return q;
					},
					maybeSingle: async () => {
						const hit = Object.values(rows).find((r) =>
							Object.entries(filters).every(([k, v]) => r[k] === v)
						);
						return { data: hit ?? null, error: null };
					}
				};
				return q;
			}
		};
	};
	return { supabase: { from } as unknown as SupabaseClient, rows };
}

describe('la catena minima: crea → renderizza → allega', () => {
	it.each(SUBJECTS.map((s) => [s.name, s] as const))(
		'anello 1/7 — SORGENTE (%s): una costante nota, nessun modello in mezzo',
		(_name, s) => {
			expect(s.source.length).toBeGreaterThan(2_000);
			// Il contratto che il Root della VM impone: `import MotionVideo from './Video'`
			// (render-tools.ts ROOT_TSX). Senza export default il render muore con un componente
			// `undefined` — e compilare non lo direbbe.
			expect(s.source, 'manca `export default`: il Root della VM importa il default').toMatch(
				/export\s+default\b/
			);
		}
	);

	it.each(SUBJECTS.map((s) => [s.name, s] as const))(
		'anello 2/7 — COMPILA (%s): il TSX diventa un componente con i suoi numeri',
		(_name, s) => {
			const compiled = compileMotionSource(s.source);
			expect(typeof compiled.component).toBe('function');
			expect(compiled.fps).toBeGreaterThan(0);
			expect(compiled.durationInFrames).toBeGreaterThan(0);
			expect(compiled.width).toBeGreaterThan(0);
			expect(compiled.height).toBeGreaterThan(0);
		}
	);

	it('anello 3/7 — LA RIGA: quello che il render rilegge e\' quello che e\' stato compilato', async () => {
		const { supabase } = fakeMotionVideos();
		const compiled = compileMotionSource(entry.code);
		const saved = await saveMotionVideo(supabase, {
			brandId: 'b1',
			userId: 'u1',
			title: 'collaudo',
			source: entry.code,
			meta: {
				fps: compiled.fps,
				durationInFrames: compiled.durationInFrames,
				width: compiled.width,
				height: compiled.height
			}
		});
		expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
		if (!saved.ok) return;

		// Il render rilegge la riga con getMotionVideo (output-tools.ts render_motion_video).
		const row = await getMotionVideo(supabase, 'b1', String(saved.row.id));
		expect(row, 'la riga appena scritta non si rilegge').toBeTruthy();
		expect(row!.source).toBe(entry.code);
		expect(row!.fps).toBe(compiled.fps);
		expect(row!.duration_in_frames).toBe(compiled.durationInFrames);
		// Appena creata NON ha un MP4: e' il render a scriverlo, ed e' la distinzione su cui il
		// 22/08 un turno ha dichiarato «MP4 render: pronto» con `preview_url` NULL.
		expect(row!.preview_url ?? null).toBeNull();
	});

	it.each(SUBJECTS.map((s) => [s.name, s] as const))(
		'anello 4/7 — I NUMERI (%s): i cancelli giudicano il video che uscira\' davvero',
		(_name, s) => {
			const compiled = compileMotionSource(s.source);
			// `readSourceMeta` e' l'unica cosa che dice ai cancelli quanto dura il video, dentro
			// `renderMotionMp4`. Se non concorda con il modulo ESEGUITO, il gate sulla voce
			// giudica un video che non esiste — e passa una battuta che verra' mozzata.
			const read = readSourceMeta(s.source, { fps: 30, durationInFrames: 180 });
			expect(read.fps, 'fps letto ≠ fps eseguito').toBe(compiled.fps);
			expect(
				read.durationInFrames,
				`durata letta ${read.durationInFrames} ≠ durata eseguita ${compiled.durationInFrames}: il gate sulla voce giudicherebbe un video piu' lungo/corto di quello che esce dalla VM`
			).toBe(compiled.durationInFrames);
		}
	);

	it.each(SUBJECTS.map((s) => [s.name, s] as const))(
		'anello 5/7 — I CANCELLI (%s): storyboard prima della spesa, voce e movimento prima della VM',
		async (_name, s) => {
			const compiled = compileMotionSource(s.source);

			// (a) Il primo render_motion_video NON rende: rimanda uno storyboard. Al secondo passa.
			const gate = createStoryboardGate();
			expect(gate.shouldStoryboard(s.source), 'il primo render dovrebbe fermarsi allo storyboard').toBe(true);
			gate.record(s.source);
			expect(gate.shouldStoryboard(s.source), 'il secondo render deve passare').toBe(false);
			const frames = storyboardFrames(s.source, compiled.durationInFrames);
			expect(frames.length).toBeGreaterThan(0);
			for (const f of frames) {
				expect(f, `fotogramma ${f} fuori dal video (0..${compiled.durationInFrames})`).toBeLessThan(
					compiled.durationInFrames
				);
			}

			// (b) I cancelli deterministici che rifiutano prima di aprire la VM.
			expect(formatEasingViolations(findLinearMotion(s.source))).toBe('');
			expect(formatStasisViolations(findStaticTails(s.source), compiled.fps)).toBe('');
			expect(formatDeadEntrances(findDeadEntrances(s.source))).toBe('');
			expect(formatDurationMismatch(findDurationMismatch(s.source), compiled.fps)).toBe('');
			expect(formatFrozenBackplate(findFrozenBackplate(s.source))).toBe('');

			// (c) Il gate sulla voce, con i numeri VERI dell'anello 4. Questi due sorgenti sono
			// muti, quindi il verdetto atteso e' `voiced:false` — cioe' il gate arriva in fondo e
			// non trova niente da controllare, che e' diverso da non essere stato chiamato. Un
			// sorgente con `<Audio>` qui leggerebbe dei WAV: fuori dalla portata di un test
			// offline, ed e' cio' che voice-gate.test.ts copre con i suoi campioni.
			const verdict = await assertMotionVoiceGate({
				supabase: fakeMotionVideos().supabase,
				brandId: 'b1',
				source: s.source,
				fps: compiled.fps,
				durationInFrames: compiled.durationInFrames
			});
			expect(findVoiceAudioRefs(s.source)).toHaveLength(0);
			expect(verdict).toEqual({ voiced: false, checkedClips: 0 });
		}
	);

	it(`anello 6/7 — MP4: "${ENTRY_ID}" ha renderizzato, e il manifesto dice con quale sorgente`, () => {
		const manifest = JSON.parse(
			readFileSync(join(REPO, 'src/lib/motion-video/library/bake-manifest.json'), 'utf8')
		) as Record<string, { renders: boolean; sourceHash: string; kb: number }>;
		const rec = manifest[ENTRY_ID];
		const bake = `FORCE=1 npm run bake:motion-library -- ${ENTRY_ID}`;
		expect(rec, `nessuna prova di render per ${ENTRY_ID} — esegui: ${bake}`).toBeTruthy();
		expect(rec.renders).toBe(true);
		expect(rec.kb, 'MP4 troppo piccolo per essere un video').toBeGreaterThan(50);
		// L'impronta e' cio' che impedisce al manifesto di invecchiare in una bugia: se il sorgente
		// e' cambiato dopo l'ultima cottura, questo anello non e' piu' provato.
		const hash = createHash('sha256').update(entry.code, 'utf8').digest('hex').slice(0, 16);
		expect(
			rec.sourceHash,
			`il sorgente e' cambiato dopo l'ultima cottura — l'MP4 provato non e' questo. Esegui: ${bake}`
		).toBe(hash);
		// E se la macchina ha cotto davvero, si guarda il file.
		const mp4 = join(REPO, entry.dir, 'preview.mp4');
		if (existsSync(mp4)) expect(statSync(mp4).size).toBeGreaterThan(50_000);
	});

	/**
	 * L'ANELLO CHE NON C'E'.
	 *
	 * Verificato in produzione il 23/08/2026: `select count(*) from posts where media_url ilike
	 * '%motion%'` torna 0 su 483 post, e `information_schema.columns` non ha nessuna colonna di
	 * `posts` che punti a `motion_videos`. Nessun tool accetta un url arbitrario per `media_url`:
	 * `render_motion_video` scrive `motion_videos.preview_url` e finisce li'.
	 *
	 * Quindi la catena si ferma UN ANELLO PRIMA della consegna: si puo' fare un video, non si puo'
	 * pubblicarlo. Questo test non finge che passi — asserisce che l'anello manca, cosi' il giorno
	 * in cui qualcuno lo costruisce e' questo test a cadere e a chiedere di essere riscritto in
	 * positivo. Costruirlo e' una scelta di prodotto, non di codice: va dal proprietario.
	 */
	it("anello 7/7 — ALLEGARE A UN POST: NON ESISTE, e il collaudo lo dichiara invece di fingere", () => {
		const persist = readFileSync(
			join(REPO, 'src/lib/server/motion-video/persist.ts'),
			'utf8'
		);
		const output = readFileSync(
			join(REPO, 'src/lib/server/motion-video/output-tools.ts'),
			'utf8'
		);
		// Il giorno in cui una di queste due asserzioni cade, l'anello e' stato costruito: si
		// riscrive questo test per verificarlo davvero, non lo si cancella.
		expect(
			/from\(['"]posts['"]\)/.test(persist) || /from\(['"]posts['"]\)/.test(output),
			"ALLEGA COSTRUITO: qualcosa scrive su `posts` dal lato motion — riscrivi questo anello in positivo"
		).toBe(false);
		expect(
			/media_url/.test(output),
			'ALLEGA COSTRUITO: output-tools tocca media_url — riscrivi questo anello in positivo'
		).toBe(false);
	});
});
