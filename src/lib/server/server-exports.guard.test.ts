import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * IL GUARDIANO CHE MANCAVA. Un `+server.ts` di SvelteKit può esportare SOLO i verbi HTTP (più
 * `config`, `prerender`, `trailingSlash`, `entries`, `fallback`, o qualunque nome che inizi con
 * `_`). Un export in più non è un avviso: il build fallisce in postbuild con «Invalid export», e
 * poiché succede DOPO vite build nessun test, typecheck o lint locale lo vede.
 *
 * È costato quattro deploy di produzione consecutivi in ERROR (24/8): una funzione estratta da
 * `sweep/+server.ts` per poterla testare ha bloccato ogni deploy per ore, mentre i commit
 * continuavano ad arrivare e sembrare spediti. La cura è tenere quelle funzioni in un modulo di
 * `$lib` — restano testabili e l'endpoint le importa.
 */
const ALLOWED = new Set([
	'GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS', 'HEAD',
	'fallback', 'prerender', 'trailingSlash', 'config', 'entries'
]);

function serverFiles(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir)) {
		const p = join(dir, e);
		if (statSync(p).isDirectory()) serverFiles(p, out);
		else if (e === '+server.ts') out.push(p);
	}
	return out;
}

describe('gli endpoint esportano solo ciò che SvelteKit accetta', () => {
	it('nessun +server.ts esporta un nome fuori contratto', () => {
		const bad: string[] = [];
		for (const file of serverFiles('src/routes')) {
			const src = readFileSync(file, 'utf8');
			// `export const X`, `export function X`, `export async function X`, `export let X`
			for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+(\w+)/gm)) {
				const name = m[1];
				if (!ALLOWED.has(name) && !name.startsWith('_')) bad.push(`${file} → ${name}`);
			}
			// `export { a, b }` — stessa regola
			for (const m of src.matchAll(/^export\s*\{([^}]+)\}/gm)) {
				for (const raw of m[1].split(',')) {
					const name = raw.split(/\s+as\s+/).pop()!.trim();
					if (name && !ALLOWED.has(name) && !name.startsWith('_')) bad.push(`${file} → ${name}`);
				}
			}
		}
		expect(bad, `export non ammessi (spostali in $lib): \n${bad.join('\n')}`).toEqual([]);
	});
});
