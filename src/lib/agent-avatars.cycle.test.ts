import { describe, it, expect } from 'vitest';
import {
	LOADING_FACE_CYCLE,
	LOADING_FACE_MS,
	loadingFaceAt
} from '$lib/agent-avatars';

/**
 * Il ciclo di caricamento è già sparito una volta senza che nessun test se ne accorgesse:
 * l'avatar restava fermo su una faccia per tutto il turno. Questi test pinnano la parte pura
 * (`loadingFaceAt`) — se qualcuno rompe l'indice, azzera il passo o svuota il ciclo, qui
 * salta. Il timer che la chiama vive in AgentAvatar (`cycle`); reduced-motion lo spegne lì.
 */
describe('loading face cycle', () => {
	it('a istanti crescenti la faccia CAMBIA, nell\'ordine del ciclo', () => {
		const seen = LOADING_FACE_CYCLE.map((_, i) => loadingFaceAt(i * LOADING_FACE_MS));
		expect(seen).toEqual(LOADING_FACE_CYCLE);
		// E cambia davvero fra un passo e il successivo: il ciclo non ha pose ripetute adiacenti.
		for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
	});

	it('dentro una posa la faccia tiene, e a fine giro il ciclo riparte', () => {
		expect(loadingFaceAt(LOADING_FACE_MS * 0.5)).toBe(LOADING_FACE_CYCLE[0]);
		expect(loadingFaceAt(LOADING_FACE_MS * 1.5)).toBe(LOADING_FACE_CYCLE[1]);
		expect(loadingFaceAt(LOADING_FACE_MS * LOADING_FACE_CYCLE.length)).toBe(LOADING_FACE_CYCLE[0]);
	});

	it('il ritmo resta leggibile: una posa dura ~2-4s (il morph da 420ms ci sta comodo)', () => {
		expect(LOADING_FACE_MS).toBeGreaterThanOrEqual(2000);
		expect(LOADING_FACE_MS).toBeLessThanOrEqual(4000);
	});

	it('istanti negativi o strani non rompono mai il loop', () => {
		expect(LOADING_FACE_CYCLE).toContain(loadingFaceAt(-100));
		expect(LOADING_FACE_CYCLE).toContain(loadingFaceAt(1e12));
	});
});
