import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * DOVE SI PAGA DEVE ESISTERE. Ogni redirect, ogni href e ogni prompt che manda l'utente a
 * pagare nomina una rotta: se quella rotta non sta su disco, il cliente che vuole abbonarsi
 * vede un 404 — e un 404 sul percorso dei soldi non lo intercetta nessun test di unità,
 * perché il codice che ci punta compila benissimo.
 *
 *   throw redirect(303, `/app/${slug}/activate`)  ->  src/routes/app/[brand]/activate/
 *   goto(`/app/${slug}/upgrade?plan=pro`)         ->  src/routes/app/[brand]/upgrade/
 *
 * Le rotte sono escluse dall'export open (scripts/export-oss.mjs): questo test gira sul
 * repository commerciale, che è quello da cui si costruisce la produzione.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCANNED = ['src', 'cli'];
const SKIPPED_DIRS = new Set(['node_modules', '.svelte-kit', 'build', 'dist']);

const PAYWALL_DESTINATION = /\/app\/[^\s'"`]*?\/(activate|upgrade)\b/g;
const ROUTE_DIR = (name: string) => join('src', 'routes', 'app', '[brand]', name);

function sources(): string[] {
	const found: string[] = [];

	for (const top of SCANNED) {
		const root = join(REPO_ROOT, top);
		if (!existsSync(root)) continue;

		for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
			if (!entry.isFile()) continue;
			if (entry.parentPath.split(/[\\/]/).some((p) => SKIPPED_DIRS.has(p))) continue;
			if (!/\.(ts|svelte)$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue;

			found.push(join(entry.parentPath, entry.name));
		}
	}

	return found;
}

function referencesByRoute(): Map<string, string[]> {
	const byRoute = new Map<string, string[]>([
		['activate', []],
		['upgrade', []]
	]);

	for (const file of sources()) {
		const text = readFileSync(file, 'utf8');

		for (const [, route] of text.matchAll(PAYWALL_DESTINATION)) {
			byRoute.get(route)?.push(file.slice(REPO_ROOT.length));
		}
	}

	return byRoute;
}

function routeExists(name: string): boolean {
	const dir = join(REPO_ROOT, ROUTE_DIR(name));
	if (!existsSync(dir)) return false;

	return ['+page.server.ts', '+page.svelte', '+server.ts'].some((f) => existsSync(join(dir, f)));
}

describe('il percorso di pagamento non porta a un 404', () => {
	const byRoute = referencesByRoute();

	// Se la scansione si rompe la mappa si svuota e il test passerebbe a vuoto: questo lo impedisce.
	it('il codice manda davvero gli utenti su activate e upgrade', () => {
		expect(byRoute.get('activate')!.length).toBeGreaterThan(0);
		expect(byRoute.get('upgrade')!.length).toBeGreaterThan(0);
	});

	it.each([...byRoute.keys()])('/app/[brand]/%s esiste su disco', (route) => {
		const referrers = byRoute.get(route)!;

		expect(routeExists(route), `${ROUTE_DIR(route)} manca, ma ci puntano: ${referrers.join(', ')}`).toBe(true);
	});
});
