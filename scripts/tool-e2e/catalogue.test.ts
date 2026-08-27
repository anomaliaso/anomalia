/**
 * Il catalogo decide cosa il banco ESEGUE contro un brand vero. Un tool che scrive finito per
 * sbaglio fra le letture non dà un rosso: crea un post nel calendario di un cliente e lo dichiara
 * verde. Queste sono le tre regole che rendono impossibile quell'errore.
 */
import { describe, expect, it } from 'vitest';
import { NEVER, READ_ONLY, WRITES } from './catalogue';

const reads = Object.keys(READ_ONLY);

describe('il catalogo dei tool non si contraddice', () => {
	it('nessun tool sta in due liste: la sorte di ognuno è una sola', () => {
		const doppi = reads.filter((r) => WRITES.includes(r) || NEVER.includes(r));
		const anche = WRITES.filter((w) => NEVER.includes(w));
		expect([...doppi, ...anche]).toEqual([]);
	});

	it('nessuna lettura si chiama come un verbo che scrive', () => {
		const sospetti = reads.filter((r) =>
			/^(create|update|delete|remove|write|replace|generate|render|make|publish|send|sync|run|set)_/.test(r)
		);
		expect(sospetti).toEqual([]);
	});

	it('ogni lettura porta il suo input: `null` è una scelta, `undefined` una dimenticanza', () => {
		for (const [name, probe] of Object.entries(READ_ONLY)) {
			expect(probe === null || typeof probe === 'object', name).toBe(true);
		}
	});
});
