/**
 * LE SPEC NON MANDANO NESSUNO DOVE NON C'È NIENTE.
 *
 * Le istruzioni dei cinque specialisti nominavano `work/history/`, `brand/strategy.md`,
 * `work/weeks/`, `web/audit.md`, `how/MAKE-GRAPHICS.md`, `brand/people/`, `assets/talents/`,
 * `web/pages/`: otto percorsi che l'albero del brand (`AGENT_FILES` + i due path dinamici) non ha
 * mai avuto. L'agente li apriva, non li trovava, e bruciava un passo per scoprirlo.
 *
 * Le spec vivono in `packages/agent-contracts`, che non può importare `$lib` — quindi il
 * controllo incrociato sta QUI, dove entrambi i lati sono visibili. Import RELATIVO di proposito:
 * `@anomalia/agent-contracts` si risolve dal node_modules del checkout principale, quindi da un
 * worktree leggerebbe le spec di un'altra copia.
 */
import { describe, expect, it } from 'vitest';
import { SPECIALISTS } from '../../../packages/agent-contracts/src/specs';
import { BRAND_FILE_PATHS, filePathsFor } from '$lib/server/chat/agent-files';

/**
 * I percorsi che non stanno in AGENT_FILES perché sono LETTURE (vedi agent-files.ts). I file del
 * brand si DERIVANO da `BRAND_FILE_PATHS`: scritti a mano qui, la lista è divergita al primo
 * `brand/strategy.md` aggiunto di là, e tre spec buone sono state dichiarate rotte per giorni.
 */
const DYNAMIC = [...BRAND_FILE_PATHS, 'runs/'];

/** Un token fra backtick è un percorso se ha uno slash o un'estensione — gli altri sono tool. */
const looksLikeAPath = (t: string) => t.includes('/') || /\.(md|html|tsx|json)$/.test(t);

describe('le spec degli specialisti nominano solo percorsi che esistono', () => {
	for (const spec of SPECIALISTS) {
		it(`${spec.id}: ogni percorso citato è nell'albero del brand`, () => {
			const known = [...filePathsFor(spec.id, { all: true }), ...DYNAMIC];
			const cited = [...spec.instructions.matchAll(/`([^`]+)`/g)]
				.map((m) => m[1].replace(/[…\s]+$/, ''))
				.filter(looksLikeAPath);
			for (const path of cited) {
				expect(
					known.some((k) => k === path || k.startsWith(path)),
					`${spec.id} manda a "${path}", che non esiste nell'albero`
				).toBe(true);
			}
		});
	}

	it('il controllo morde davvero: un percorso inventato fallisce', () => {
		const known = [...filePathsFor('analyst', { all: true }), ...DYNAMIC];
		const invented = 'brand/piano-che-non-esiste.md';
		expect(known.some((k) => k === invented || k.startsWith(invented))).toBe(false);
	});
});
