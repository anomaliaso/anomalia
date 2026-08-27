import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * IL GUARDIANO — un pacchetto di `packages/` non è l'app: non può importare `$lib/*` (esiste
 * solo dentro SvelteKit) né `$env/*` (idem, più le variabili non ci arriverebbero comunque fuori
 * dal runtime dell'app). Il lotto 2b ha invertito ogni dipendenza reale in una DEP del
 * costruttore/factory (vedi `agent-adapters/src/{brand-fs,memory-postgres,vercel-sandbox,
 * graphical-bootstrap}.ts` e `runtime/{ai-runtime,models}.ts`) — questo test è la prova che
 * l'inversione regge, non solo oggi ma a ogni commit futuro: un solo import residuo lo fa fallire.
 */
const PACKAGES_DIR = fileURLToPath(new URL('.', import.meta.url));
const FORBIDDEN = [/from\s+['"]\$lib\//, /from\s+['"]\$env\//, /import\(\s*['"]\$lib\//, /import\(\s*['"]\$env\//];

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules') continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listTsFiles(full));
		} else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
			out.push(full);
		}
	}
	return out;
}

function packageSrcDirs(): string[] {
	return readdirSync(PACKAGES_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => join(PACKAGES_DIR, e.name, 'src'))
		.filter((p) => {
			try {
				return statSync(p).isDirectory();
			} catch {
				return false;
			}
		});
}

describe('packages/* non importa $lib o $env', () => {
	const files = packageSrcDirs().flatMap(listTsFiles);

	it('ha trovato file .ts da controllare (il test non passa vuoto per errore)', () => {
		expect(files.length).toBeGreaterThan(10);
	});

	it.each(files.map((f) => [f.slice(PACKAGES_DIR.length), f] as const))('%s', (_label, file) => {
		const content = readFileSync(file, 'utf-8');
		const hit = FORBIDDEN.find((re) => re.test(content));
		expect(hit, `${file} importa $lib/$env — un pacchetto non può, vedi la dep-injection in agent-adapters`).toBeUndefined();
	});
});
