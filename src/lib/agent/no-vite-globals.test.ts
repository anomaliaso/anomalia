import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * IL WORKER NON GIRA DENTRO VITE.
 *
 * `bun run worker:start` esegue un bundle esbuild su Node puro: li` `import.meta.env` non
 * esiste, e leggerne un campo e` un TypeError che uccide il turno prima di cominciare. Il 26/8
 * `live.ts` aveva UNA riga — una scappatoia per i test sul globale di Vite —
 * e ogni singolo job di chat drenato dal worker moriva li`: due job in dieci ore, entrambi
 * «Cannot read properties of undefined (reading 'MODE')». Dal fuori si vedeva una coda che non
 * avanzava mai.
 *
 * La forma `glob` invece e` shimmata dal build (build-worker.mjs) e resta lecita.
 *
 * Questo test guarda la CLASSE, non quella riga: qualunque nuovo uso di quel globale sotto
 * `agent/` o `server/` tornerebbe a rompere il worker nello stesso modo, e in silenzio.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WATCHED = ['lib/agent', 'lib/server'];

function tsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...tsFiles(full));
		else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
	}
	return out;
}

describe('niente globali di Vite nel codice che il worker impacchetta', () => {
	it('nessun `import.meta.env` sotto lib/agent e lib/server', () => {
		const guilty: string[] = [];
		for (const base of WATCHED) {
			const dir = join(ROOT, base);
			try {
				if (!statSync(dir).isDirectory()) continue;
			} catch {
				continue;
			}
			for (const file of tsFiles(dir)) {
				if (/import\.meta\.env/.test(readFileSync(file, 'utf8'))) guilty.push(file.slice(ROOT.length));
			}
		}
		expect(guilty, 'usa process.env: il worker gira fuori da Vite').toEqual([]);
	});
});
