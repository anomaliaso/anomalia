import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Misurato il 2/9 su due build identici a meno di Sentry: il client Sentry vale **123,4 KB gzip
 * del percorso critico** della pagina chat (611,4 → 488,0), e 74,4 di quei KB stanno dentro
 * `entry/app.js`, cioè il file che ogni pagina dell'app carica prima di disegnare qualsiasi cosa.
 * Sono 329 moduli `@sentry/*`, tirati dentro da un `import` statico.
 *
 * L'unica cosa che li tiene fuori dal critico è che l'import resti DINAMICO. Un `import` statico
 * rimesso qui dentro — anche solo per un tipo, se non è `import type` — li riporta tutti nel
 * chunk d'ingresso senza che nessuno se ne accorga.
 */
describe('hooks.client: Sentry non entra nel chunk di ingresso', () => {
	const src = readFileSync(new URL('./hooks.client.ts', import.meta.url), 'utf8');

	it("non ha import statici da @sentry: solo l'import dinamico", () => {
		const statics = src.match(/^import\s+(?!type\b)[^;]*from\s+['"]@sentry\/[^'"]+['"]/gm) ?? [];
		expect(statics).toEqual([]);
		expect(src).toMatch(/\bimport\(['"]@sentry\/sveltekit['"]\)/);
	});

	it("gli errori della finestra prima del caricamento non si perdono", () => {
		expect(src).toContain('rememberError');
		expect(src).toContain('drainErrors');
	});
});
