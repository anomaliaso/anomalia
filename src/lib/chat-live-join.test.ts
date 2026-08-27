import { describe, expect, it } from 'vitest';
import { emptyStreamState } from './chat-stream-events';
import { applyLiveChunk, applyLiveSnapshot, type PendingChunk } from './chat-live-join';

/**
 * L'incidente del 26/8: chat riaperta a turno già partito, e la risposta esce mescolata —
 * «Il nastro è risultato troppoo compress per poterlo tagliare una frase batt peruta con
 * certzaez». Il testo del database era pulito: a mescolarlo era il CLIENT, che appendeva gli
 * incrementi del canale Realtime sopra lo snapshot assoluto del poll senza sapere se i due si
 * toccassero. Chi si aggancia a metà turno non è mai allineato, e un chunk perso dal canale
 * (broadcast best-effort) lascia un buco che il chunk dopo cuce sopra la parola sbagliata.
 */
describe('chat live join — due sorgenti, una sola posizione', () => {
	const chunk = (delta: string) => ({ type: 'text-delta', delta });

	it('un chunk che non continua dove siamo NON si applica: niente giunzione a metà parola', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		applyLiveSnapshot(state, pending, { text: 'Il nastro è risultato troppo ' });

		applyLiveChunk(state, pending, chunk('compress'), { text: 999, reasoning: 0 });

		expect(state.text).toBe('Il nastro è risultato troppo ');
	});

	it('il chunk che continua esattamente dove siamo si applica subito', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		applyLiveSnapshot(state, pending, { text: 'Il nastro ' });

		applyLiveChunk(state, pending, chunk('è compresso'), { text: 10, reasoning: 0 });

		expect(state.text).toBe('Il nastro è compresso');
	});

	it('lo snapshot che colma il buco fa entrare i chunk rimasti in attesa, in ordine', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		applyLiveSnapshot(state, pending, { text: 'Il nastro ' });

		applyLiveChunk(state, pending, chunk('con certezza'), { text: 29, reasoning: 0 });
		applyLiveChunk(state, pending, chunk(' e netto'), { text: 41, reasoning: 0 });
		expect(state.text).toBe('Il nastro ');

		applyLiveSnapshot(state, pending, { text: 'Il nastro tagliato a battuta ' });

		expect(state.text).toBe('Il nastro tagliato a battuta con certezza e netto');
		expect(pending).toHaveLength(0);
	});

	it('un chunk già visto, arrivato in ritardo, non raddoppia il testo', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		applyLiveChunk(state, pending, chunk('registro '), { text: 0, reasoning: 0 });
		applyLiveChunk(state, pending, chunk('di nuovo'), { text: 9, reasoning: 0 });

		applyLiveChunk(state, pending, chunk('registro '), { text: 0, reasoning: 0 });

		expect(state.text).toBe('registro di nuovo');
	});

	it('lo snapshot non riporta mai indietro il testo che il canale ha già portato avanti', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		applyLiveChunk(state, pending, chunk('registro di nuovo'), { text: 0, reasoning: 0 });

		applyLiveSnapshot(state, pending, { text: 'registro' });

		expect(state.text).toBe('registro di nuovo');
	});

	it('gli eventi che non toccano il testo (tool) si applicano sempre', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		applyLiveSnapshot(state, pending, { text: 'sto lavorando' });

		applyLiveChunk(
			state,
			pending,
			{ type: 'tool-input-available', toolCallId: 't1', toolName: 'shell', input: { cmd: 'ls' } },
			{ text: 999, reasoning: 0 }
		);

		expect(state.tools.map((t) => t.toolName)).toEqual(['shell']);
	});

	it('il ragionamento ha la sua posizione: un delta disallineato non lo mescola', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		applyLiveSnapshot(state, pending, { reasoning: 'Devo capire ' });

		applyLiveChunk(state, pending, { type: 'reasoning-delta', delta: 'quanto dura' }, { text: 0, reasoning: 40 });
		expect(state.reasoning).toBe('Devo capire ');

		applyLiveChunk(state, pending, { type: 'reasoning-delta', delta: 'la clip' }, { text: 0, reasoning: 12 });
		expect(state.reasoning).toBe('Devo capire la clip');
	});

	it('senza posizione (server vecchio) il chunk si applica come prima', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		applyLiveChunk(state, pending, chunk('vecchio server'), undefined);

		expect(state.text).toBe('vecchio server');
	});

	it('un buco che non si chiude mai non fa crescere la coda senza fine', () => {
		const state = emptyStreamState();
		const pending: PendingChunk[] = [];
		for (let i = 0; i < 3000; i++) {
			applyLiveChunk(state, pending, chunk('x'), { text: 1000 + i, reasoning: 0 });
		}

		expect(pending.length).toBeLessThanOrEqual(1000);
	});
});
