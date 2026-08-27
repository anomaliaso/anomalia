import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * STOP DEVE ESISTERE FINCHE` IL TURNO ESISTE.
 *
 * `loading` e` locale: e` vero solo mentre QUESTA scheda tiene aperta la richiesta in streaming.
 * Dopo un reload, su un altro dispositivo, o quando l'SSE si chiude mentre il run continua, e`
 * falso — e il run kit sul server e` vivissimo. La pagina quel fatto lo conosce (`orphanRun`) e
 * lo usa gia` per due cose: il transcript che mostra «sta generando» e `send()` che accoda. Il
 * terzo consumatore, il bottone di Stop, non e` mai stato avvisato.
 *
 * Risultato visto il 26/8: thread «generating response» da 37 minuti, nessun modo di fermarlo,
 * ogni messaggio nuovo in coda dietro un turno che l'utente non poteva toccare. Lo store era
 * gia` pronto — `cancelChatSession` gestisce il caso senza sessione locale e chiama il cancel
 * del server, e il suo commento dice «la pagina in quel caso mostra Stop». Mancava solo qui.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('il bottone Stop segue il turno sul SERVER, non lo stream di questa scheda', () => {
	it('la pagina del thread passa il run orfano al composer, non solo al transcript', () => {
		const page = read('./[thread]/+page.svelte');
		const composer = page.slice(page.indexOf('<ComposerDock'));
		expect(composer).toMatch(/remoteBusy=\{/);
	});

	it('ComposerDock inoltra quel fatto al prompt', () => {
		const dock = read('./components/ComposerDock.svelte');
		expect(dock).toContain('remoteBusy');
	});

	it('ChatPrompt disegna Stop anche quando lo stream locale non c’e` piu`', () => {
		const prompt = read('../../../../lib/components/ChatPrompt.svelte');
		const stop = prompt.slice(prompt.indexOf('ch-send ch-stop') - 200, prompt.indexOf('ch-send ch-stop'));
		expect(stop).toMatch(/loading \|\| remoteBusy/);
	});
});
