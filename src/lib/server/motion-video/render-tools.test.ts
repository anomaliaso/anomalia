import { describe, expect, it } from 'vitest';
import {
	MAX_STILLS_PER_RENDER,
	budgetWithin,
	defaultStillFrames,
	framesFromSeconds,
	readSourceMeta
} from './render-tools';

describe('defaultStillFrames', () => {
	it('non guarda mai il primo né l’ultimo fotogramma', () => {
		// Sono i due che nascondono un difetto di animazione: all'inizio non si è mosso niente,
		// alla fine è già tutto a posto.
		const frames = defaultStillFrames(180, 4);
		expect(frames.length).toBe(4);
		expect(Math.min(...frames)).toBeGreaterThan(0);
		expect(Math.max(...frames)).toBeLessThan(180);
	});

	it('li distribuisce sulla clip, in ordine e senza doppioni', () => {
		const frames = defaultStillFrames(300, 4);
		expect(frames).toEqual([...frames].sort((a, b) => a - b));
		expect(new Set(frames).size).toBe(frames.length);
	});

	it('non supera mai il tetto per chiamata', () => {
		expect(defaultStillFrames(900, 99).length).toBeLessThanOrEqual(MAX_STILLS_PER_RENDER);
	});

	it('regge una clip più corta del numero di fotogrammi chiesti', () => {
		const frames = defaultStillFrames(2, 4);
		expect(frames.length).toBeGreaterThan(0);
		for (const f of frames) {
			expect(f).toBeGreaterThanOrEqual(0);
			expect(f).toBeLessThan(2);
		}
	});
});

describe('framesFromSeconds', () => {
	it('converte i secondi in fotogrammi al fps della clip', () => {
		expect(framesFromSeconds([0, 1, 2], 30, 180)).toEqual([0, 30, 60]);
	});

	it('taglia oltre la fine invece di chiedere un fotogramma che non esiste', () => {
		// L'ultimo indice valido di una clip da 180 è 179: un `still` fuori range fallisce e basta.
		expect(framesFromSeconds([100], 30, 180)).toEqual([179]);
	});

	it('scarta i valori non finiti e i doppioni, e ordina', () => {
		expect(framesFromSeconds([2, 1, 1, NaN, Infinity], 30, 180)).toEqual([30, 60]);
	});

	it('non supera il tetto per chiamata', () => {
		const many = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
		expect(framesFromSeconds(many, 30, 180).length).toBeLessThanOrEqual(MAX_STILLS_PER_RENDER);
	});
});

describe('readSourceMeta', () => {
	const fallback = { fps: 30, durationInFrames: 180 };

	it('legge fps e durata dagli export del contratto TSX', () => {
		const src = `export const fps = 60;\nexport const durationInFrames = 300;\nexport default function X() {}`;
		expect(readSourceMeta(src, fallback)).toEqual({ fps: 60, durationInFrames: 300 });
	});

	it('cade sul fallback quando il sorgente è a metà', () => {
		// Meglio renderizzare con la durata del picker che rifiutare: in create mode la bozza non è
		// ancora completa e il modello vuole comunque guardare cosa ha scritto.
		expect(readSourceMeta('export default function X() {}', fallback)).toEqual(fallback);
	});

	it('ignora valori non validi invece di propagarli', () => {
		const src = 'export const fps = 0;\nexport const durationInFrames = 240;';
		expect(readSourceMeta(src, fallback)).toEqual({ fps: 30, durationInFrames: 240 });
	});

	/**
	 * LA DURATA CALCOLATA — la regex non la vede, e il gate sulla voce giudicava il numero sbagliato.
	 *
	 * Misurato il 23/08/2026: 17 voci su 20 della libreria di animazioni (quelle che l'agente è
	 * istruito a COPIARE) scrivono `export const durationInFrames = Math.round(BEAT * fps) * STEPS`.
	 * Su tutte e diciassette la regex falliva e vinceva il fallback, che dentro `renderMotionMp4` è
	 * il letterale 180: `assertMotionVoiceGate` misurava un video da 6s mentre dalla VM ne usciva
	 * uno da 3,67s, cioè due secondi e mezzo in cui una battuta viene mozzata senza che il gate che
	 * esiste per impedirlo dica niente.
	 */
	it('esegue il modulo quando la durata è calcolata, invece di cadere sul fallback', () => {
		const src = [
			'export const fps = 30;',
			'const BEAT = 1.2;',
			'const STEPS = 5;',
			'export const durationInFrames = Math.round(BEAT * fps) * STEPS;',
			'export default function X() { return null; }'
		].join('\n');
		expect(readSourceMeta(src, fallback)).toEqual({ fps: 30, durationInFrames: 180 });
		// E con un fallback diverso dai default del compilatore, per provare che il 180 qui sopra
		// è il valore CALCOLATO (36 × 5) e non il fallback che gli somiglia.
		expect(readSourceMeta(src, { fps: 24, durationInFrames: 999 })).toEqual({
			fps: 30,
			durationInFrames: 180
		});
	});

	it("non inventa i default del compilatore quando l'export non c'è proprio", () => {
		// `agent.ts` passa la durata scelta nel picker (15s = 450 frame). Una bozza a metà che
		// compila ma non dichiara ancora i suoi numeri deve rendere QUELLA durata, non 180.
		const src = 'export default function X() { return null; }';
		expect(readSourceMeta(src, { fps: 30, durationInFrames: 450 })).toEqual({
			fps: 30,
			durationInFrames: 450
		});
	});
});

describe('budgetWithin', () => {
	// Installazione 600s + render 480s = 1080s dentro un affitto da 900: la macchina si spegneva
	// a metà, i 900 secondi si pagavano lo stesso e non usciva nessun file.
	const LEASE = 900_000;
	const UPLOAD_MARGIN = 45_000;
	const MIN_RENDER_SLICE = 120_000;

	it('tiene installazione e render dentro lo stesso affitto', () => {
		const install = budgetWithin(LEASE, 5_000, UPLOAD_MARGIN + MIN_RENDER_SLICE, 600_000);
		const render = budgetWithin(LEASE, 5_000 + install, UPLOAD_MARGIN, 480_000);
		expect(install + render + UPLOAD_MARGIN).toBeLessThanOrEqual(LEASE);
	});

	it('lascia al render ciò che l’installazione non si è preso, mai di più del suo tetto', () => {
		// Macchina calda: il progetto è in cache, il render ha tutto il suo tetto.
		expect(budgetWithin(LEASE, 20_000, UPLOAD_MARGIN, 480_000)).toBe(480_000);
		// Macchina fredda con un'installazione da 342s, come quelle viste in produzione.
		expect(budgetWithin(LEASE, 350_000, UPLOAD_MARGIN, 480_000)).toBe(480_000);
		// Installazione al suo tetto: il render prende ciò che resta, non 480.
		expect(budgetWithin(LEASE, 610_000, UPLOAD_MARGIN, 480_000)).toBe(245_000);
	});

	it('non torna mai un budget negativo', () => {
		expect(budgetWithin(LEASE, 950_000, UPLOAD_MARGIN, 480_000)).toBe(0);
	});
});
