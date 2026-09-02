import { describe, expect, it, vi } from 'vitest';

const { withStallTimeout, CONVERT_STALL_TIMEOUT_MS } = await import('./raster-image-client');

describe('withStallTimeout — un browser API appesa diventa un errore visibile', () => {
	it('una promessa che non risolve mai rifiuta entro il tetto di stall', async () => {
		vi.useFakeTimers();
		const p = withStallTimeout(new Promise<never>(() => {}), 'canvas.toBlob');
		const outcome = p.then(
			() => 'resolved',
			(e: Error) => `rejected: ${e.message}`
		);
		await vi.advanceTimersByTimeAsync(CONVERT_STALL_TIMEOUT_MS + 1);
		expect(await outcome).toBe('rejected: convert_stalled: canvas.toBlob');
		vi.useRealTimers();
	});

	it('una promessa che risolve passa indenne', async () => {
		await expect(withStallTimeout(Promise.resolve('ok'), 'x')).resolves.toBe('ok');
	});
});
