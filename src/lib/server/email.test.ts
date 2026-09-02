/**
 * La posta è l'unica cosa che arriva a una persona: un test che la manda non fa rumore in un log,
 * squilla nella casella di qualcuno. E rende sospette anche le segnalazioni vere.
 */
import { describe, expect, it, vi } from 'vitest';
import { sendEmail } from './email';

describe('sendEmail sotto test', () => {
	it('non parte, e non esplode per una chiave mancante', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		await expect(
			sendEmail({ to: 'ops@anomalia.so', subject: 'prova', html: '<p>prova</p>' })
		).resolves.toBeUndefined();

		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
