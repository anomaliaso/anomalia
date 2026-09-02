import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { consolidateMessages } from './transcript';

/**
 * Il difetto dell'1/9, pagato due volte in un'ora: chiavare il transcript sull'id del messaggio
 * sembra l'ovvio miglioramento — con la chiave posizionale Svelte riusa il componente di un turno
 * per un turno diverso — e invece SPEGNE la lista.
 *
 * Il carico del thread può contenere due righe con lo STESSO id: un checkpoint parziale e la sua
 * versione finale arrivano entrambi nella proiezione (osservato su una cronologia vera: stesso id,
 * stesso testo, due tool contro dieci). Su una chiave duplicata Svelte non disegna il blocco: il
 * transcript resta vuoto, senza un errore a schermo — verificato nel browser, stessa pagina, la
 * sola riga della chiave cambiata.
 *
 * Si potrà chiavare sull'identità quando il consolidamento produrrà una chiave sua, unica per
 * riga. Fino ad allora questa riga resta com'è, e questo test lo ricorda.
 */
describe('transcript: la chiave della lista', () => {
	const src = readFileSync(new URL('./TranscriptList.svelte', import.meta.url), 'utf8');

	it('è la posizione, non l`id del messaggio', () => {
		expect(src).toContain('{#each messages as msg, i (i)}');
		expect(src).not.toMatch(/\{#each messages as msg, i \(msg\.id/);
	});

	it('il consolidamento non promette id unici: due righe possono condividerlo', () => {
		const same = 'msg-1';
		const rows = consolidateMessages([
			{ id: same, role: 'assistant', content: 'Capisco la richiesta', tool_calls: [] },
			{ id: same, role: 'assistant', content: 'Capisco la richiesta', tool_calls: [] }
		] as Parameters<typeof consolidateMessages>[0]);

		const ids = rows.map((r) => r.id);
		expect(new Set(ids).size).toBeLessThan(ids.length);
	});
});
