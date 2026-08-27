import { describe, expect, it, vi } from 'vitest';
import { swallow } from './swallow';

describe('swallow', () => {
	it('non rilancia mai', () => {
		expect(() => swallow('test reason', new Error('boom'))).not.toThrow();
		expect(() => swallow('test reason')('boom')).not.toThrow();
		expect(() => swallow('test reason')(null)).not.toThrow();
		expect(() => swallow('test reason', undefined)).not.toThrow();
	});

	it('logga motivo e messaggio dell\'errore', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			swallow('fetch products', new Error('timeout'));
			expect(errorSpy).toHaveBeenCalledTimes(1);
			const logged = String(errorSpy.mock.calls[0]?.join(' '));
			expect(logged).toContain('fetch products');
			expect(logged).toContain('timeout');
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('la forma curried gestisce il catch di una promessa', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await expect(
				Promise.reject(new Error('gone'))
					.catch(swallow('best effort'))
					.then(() => 'resolved')
			).resolves.toBe('resolved');
			const logged = String(errorSpy.mock.calls[0]?.join(' '));
			expect(logged).toContain('best effort');
			expect(logged).toContain('gone');
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('gestisce errori non-Error senza lanciare', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			swallow('string failure', 'plain string');
			swallow('object failure', { code: 42 });
			expect(errorSpy).toHaveBeenCalledTimes(2);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it('funziona anche senza Sentry configurato', () => {
		expect(() => swallow('no sentry', new Error('unconfigured'))).not.toThrow();
		expect(() => swallow('no sentry')(new Error('unconfigured'))).not.toThrow();
	});
});
