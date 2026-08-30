/**
 * Il deploy di produzione è fallito due volte di fila su `patch-package cannot apply`, mentre la
 * CI restava verde: la CI usa `npm ci`, che CANCELLA `node_modules` prima di installare, e Vercel
 * usava `npm install`, che riusa l'albero ripristinato dalla cache. Su un albero già patchato (o
 * patchato per un'altra versione) patch-package si rifiuta — lo dice il suo stesso messaggio,
 * «Try removing node_modules and trying again».
 *
 * Che la produzione costruisca con lo stesso comando che la CI ha provato non è un dettaglio di
 * configurazione: è la differenza fra «i test passano» e «il prodotto si costruisce».
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { installCommand?: string };

describe('vercel.json', () => {
	it('installa col lockfile, come la CI, non con npm install', () => {
		expect(vercel.installCommand).toBe('npm ci');
	});
});
