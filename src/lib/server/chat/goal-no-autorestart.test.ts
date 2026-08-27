/**
 * LA MODALITÀ GOAL NON RIPARTE DA SOLA.
 *
 * L'obiettivo aperto era una ragione per rilanciare l'agente in silenzio: fino a `GOAL_MAX_LAPS`
 * giri, più uno «a vuoto» concesso quando un giro non chiudeva niente. Decisione del 25/8: non si
 * fa più. Un obiettivo aperto è una ragione per DIRLO alla persona, non per ripartire senza che
 * l'abbia chiesto — spendendo modello, credito e tempo mentre guarda una card che si aggiorna.
 *
 * Resta `out_of_time`: quella non è modalità goal, è il muro dei 300 secondi del serverless. Un
 * turno tagliato a metà deve poter finire il lavoro che aveva già cominciato.
 */
import { describe, expect, it } from 'vitest';
import { decideGoalContinuation } from './goal';

const apertO = {
	id: 'g1',
	statement: 'pubblica tre post',
	laps: 0,
	criteria: [
		{ id: 'c1', text: 'primo', status: 'done', note: null },
		{ id: 'c2', text: 'secondo', status: 'open', note: null }
	]
};

const base = {
	goal: apertO as never,
	closedThisTurn: 1,
	timeRanOut: false,
	loopStalled: false,
	aborted: false,
	failed: false,
	depth: 0,
	maxDepth: 4
};

describe('un obiettivo aperto non rilancia l\'agente', () => {
	it('criteri aperti e progresso fatto: si ferma e torna alla persona', () => {
		const d = decideGoalContinuation(base);
		expect(d.continue).toBe(false);
		expect(d.handBack).toBe(true);
	});

	it('un giro senza progresso non si ritenta: era il caso peggiore, spendeva senza avanzare', () => {
		const d = decideGoalContinuation({ ...base, goal: { ...apertO, laps: 1 } as never, closedThisTurn: 0 });
		expect(d.continue).toBe(false);
	});

	it('obiettivo raggiunto: si ferma, come prima', () => {
		const met = { ...apertO, criteria: apertO.criteria.map((c) => ({ ...c, status: 'done' })) };
		expect(decideGoalContinuation({ ...base, goal: met as never }).continue).toBe(false);
	});

	// Il muro del serverless non e' modalita' goal: un turno tagliato a meta' deve poter finire.
	it('il tempo scaduto continua a riprendere: quello e\' il muro, non l\'obiettivo', () => {
		const d = decideGoalContinuation({ ...base, timeRanOut: true });
		expect(d.continue).toBe(true);
		expect(d.reason).toBe('out_of_time');
	});
});
