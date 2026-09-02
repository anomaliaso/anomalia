/**
 * Il poll dello stato del run distingue TRE risposte, non due. Confondere «il server ha
 * sbagliato» con «il turno è finito» cancella dallo schermo un lavoro che c'è ancora: il testo
 * è già in mano al client, e sparisce per una richiesta accessoria andata storta.
 */
import { describe, expect, it } from 'vitest';
import { pollOutcome } from './kit-run';

describe('pollOutcome', () => {
	it('200: il server manda il run', () => {
		expect(pollOutcome(200)).toBe('run');
	});

	it('204 e SOLO 204 vuol dire che il turno è finito', () => {
		expect(pollOutcome(204)).toBe('finished');
	});

	it('un errore del server NON è un turno finito: si tiene quello che si ha', () => {
		for (const status of [500, 502, 503, 401, 403, 404, 429]) {
			expect(pollOutcome(status)).toBe('keep');
		}
	});
});
