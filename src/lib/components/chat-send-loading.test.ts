import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * SUBMIT NON PUO` RESTARE MUTO.
 *
 * Sulla home del brand (la chat "Hire an agent") il primo invio deve nascere un thread:
 * fra lo svuotamento della textarea e la fine di `createThread` passano 1-2s in cui il
 * bottone diventa microfono, non appare nessun spinner, e l'unica cosa visibile e` la
 * progress bar di navigazione — che parte SOLO dopo che il thread esiste. In quel lasso
 * l'utente crede di non aver inviato nulla.
 *
 * Il gap lo chiude ChatColumn con uno stato `sending` vero dall'invio fino a che la
 * sessione (`primeChatSession`) non prende il turno, e ChatPrompt lo mostra: niente
 * microfono, la rotella al posto del piano.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('il primo invio mostra la rotella finche` il thread non esiste', () => {
	it('ChatColumn accende uno stato sending prima di creare il thread e lo spegne dopo', () => {
		const column = read('./ChatColumn.svelte');
		const on = column.indexOf('sending = true');
		const off = column.indexOf('sending = false');
		const send = column.indexOf('prepareOptimisticSend(brandSlug');
		expect(on).toBeGreaterThan(-1);
		expect(off).toBeGreaterThan(on);
		expect(on).toBeLessThan(send);
	});

	it('ChatColumn passa quello stato al composer', () => {
		const column = read('./ChatColumn.svelte');
		const prompt = column.slice(column.indexOf('<ChatPrompt'));
		expect(prompt).toMatch(/sending=\{sending\}/);
	});

	it('ChatPrompt non mostra il microfono mentre l’invio e` in volo', () => {
		const prompt = read('./ChatPrompt.svelte');
		const mic = prompt.slice(prompt.indexOf('const showMic'));
		expect(mic).toMatch(/!sending/);
	});

	it('ChatPrompt disegna la rotella al posto del piano mentre l’invio e` in volo', () => {
		const prompt = read('./ChatPrompt.svelte');
		const branch = prompt.indexOf('{:else if sending}');
		const mic = prompt.indexOf('ch-send ch-mic');
		expect(branch).toBeGreaterThan(-1);
		expect(branch).toBeLessThan(mic);
	});

	it('ChatPrompt monta il file picker solo dopo l’hydration', () => {
		const prompt = read('./ChatPrompt.svelte');
		const ready = prompt.indexOf('let hydrated = $state(false)');
		const mount = prompt.indexOf('hydrated = true');
		const picker = prompt.indexOf('bind:this={fileEl}');
		const guard = prompt.lastIndexOf('{#if hydrated}', picker);

		expect(ready).toBeGreaterThan(-1);
		expect(mount).toBeGreaterThan(ready);
		expect(guard).toBeGreaterThan(mount);
		expect(guard).toBeLessThan(picker);
	});
});
