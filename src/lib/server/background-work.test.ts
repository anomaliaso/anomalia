import { describe, expect, it, vi } from 'vitest';
import { runInBackground } from './background-work';

describe('il lavoro di fondo avviene, e non fa aspettare', () => {
	it('non blocca chi chiama', async () => {
		let done = false;
		const t = Date.now();
		runInBackground(async () => {
			await new Promise((r) => setTimeout(r, 120));
			done = true;
		}, 'test');
		// Il punto dell'esercizio: la chiamata torna PRIMA che il lavoro finisca.
		expect(Date.now() - t).toBeLessThan(60);
		expect(done).toBe(false);
		await new Promise((r) => setTimeout(r, 200));
		expect(done, 'il lavoro deve comunque avvenire').toBe(true);
	});

	it('un fallimento nel fondo non diventa un rifiuto non gestito', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		runInBackground(async () => {
			throw new Error('boom');
		}, 'test');
		await new Promise((r) => setTimeout(r, 50));
		// Se questo diventasse un unhandled rejection, in produzione ucciderebbe il processo che
		// stava rispondendo — cioè il contrario di quello che questo modulo esiste per fare.
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
