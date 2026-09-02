import { beforeEach, describe, expect, it } from 'vitest';
import { __resetErrorBufferForTests, drainErrors, rememberError } from './sentry-buffer';

/**
 * Sentry non parte più al caricamento del modulo: arriva a idle, o alla prima interazione. In
 * mezzo c'è una finestra in cui un errore non ha ancora nessuno che lo raccolga — ed è proprio
 * la finestra in cui l'app si idrata, cioè dove gli errori interessanti succedono. Questa coda
 * li tiene da parte e li rigioca quando il client è pronto.
 *
 * Le due proprietà che contano: niente si perde prima, niente si duplica dopo (una volta che
 * Sentry è agganciato, i suoi handler globali vedono già tutto da soli).
 */
describe('la coda degli errori prima che Sentry arrivi', () => {
	beforeEach(() => __resetErrorBufferForTests());

	it('tiene quello che è successo prima e lo restituisce in ordine', () => {
		rememberError('primo');
		rememberError('secondo');
		expect(drainErrors()).toEqual(['primo', 'secondo']);
	});

	it('dopo lo svuotamento non accumula più: da lì in poi guarda Sentry', () => {
		rememberError('prima');
		drainErrors();
		rememberError('dopo');
		expect(drainErrors()).toEqual([]);
	});

	it('non cresce senza limite se la pagina va in loop di errori', () => {
		for (let i = 0; i < 500; i++) rememberError(i);
		expect(drainErrors().length).toBeLessThanOrEqual(20);
	});
});
