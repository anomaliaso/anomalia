import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateText, stepCountIs, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import {
	DEFAULT_CHAT_TURN_TOKEN_BUDGET,
	chatMaxTurns,
	chatTokenBudget,
	resolveChatTokenBudget,
	turnTokenBudgetNotice
} from './turn-limits';

/**
 * IL TETTO SUI TOKEN, PROVATO CONTRO L'SDK VERO — non contro un finto `{ steps }`.
 *
 * Il turno che ha motivato tutto questo: 1.201.249 token in ingresso, 582 secondi, e come unico
 * tetto il conteggio degli step. Qui il modello è un `MockLanguageModelV3` che chiama uno strumento a
 * ogni giro e dichiara un consumo fisso: il ciclo dell'AI SDK non finirebbe MAI da solo, quindi se
 * il turno si ferma è perché il predicato l'ha fermato. È l'unico modo di distinguere «il tetto
 * funziona» da «il finto modello aveva finito».
 */

/** Un modello che non smette mai: uno strumento per step, `perStep` token dichiarati ogni volta. */
function burningModel(perStepIn: number, perStepOut = 0) {
	let n = 0;
	return new MockLanguageModelV3({
		doGenerate: async () => ({
			content: [
				{ type: 'tool-call' as const, toolCallId: `call-${n++}`, toolName: 'burn', input: '{}' }
			],
			finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
			usage: {
				inputTokens: { total: perStepIn, noCache: perStepIn, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: perStepOut, text: perStepOut, reasoning: 0 }
			},
			warnings: []
		})
	});
}

const burn = tool({
	description: 'brucia token',
	inputSchema: z.object({}),
	execute: async () => ({ ok: true })
});

describe('chatTokenBudget dentro il ciclo dell’AI SDK', () => {
	it('ferma un turno che supera la soglia, prima del tetto sui passi', async () => {
		// 100k per step, soglia 250k: dopo lo step 3 la somma è 300k ≥ 250k → stop.
		const budget = chatTokenBudget(250_000);
		const model = burningModel(100_000);
		const res = await generateText({
			model,
			prompt: 'vai',
			tools: { burn },
			stopWhen: [stepCountIs(chatMaxTurns()), budget.reached]
		});

		expect(res.steps.length).toBe(3);
		expect(model.doGenerateCalls.length).toBe(3);
		expect(budget.exceeded).toBe(true);
		expect(budget.usedTokens).toBe(300_000);
		expect(budget.budget).toBe(250_000);
	});

	it('somma INGRESSO e USCITA di ogni step: sono i token fatturati, non quelli distinti', async () => {
		const budget = chatTokenBudget(150_000);
		// 10k in + 90k out per step: due step = 200k ≥ 150k. Contando il solo ingresso servirebbero
		// quindici step, e il tetto sui passi (4) arriverebbe prima — cioè nessun tetto.
		const res = await generateText({
			model: burningModel(10_000, 90_000),
			prompt: 'vai',
			tools: { burn },
			stopWhen: [stepCountIs(4), budget.reached]
		});
		expect(res.steps.length).toBe(2);
		expect(budget.usedTokens).toBe(200_000);
		expect(budget.exceeded).toBe(true);
	});

	it('un turno sotto la soglia non lo tocca: si ferma sui passi, e `exceeded` resta falso', async () => {
		const budget = chatTokenBudget(1_000_000);
		const res = await generateText({
			model: burningModel(1_000),
			prompt: 'vai',
			tools: { burn },
			stopWhen: [stepCountIs(4), budget.reached]
		});
		expect(res.steps.length).toBe(4);
		expect(budget.exceeded).toBe(false);
		expect(budget.usedTokens).toBe(4_000);
	});

	it('soglia 0 = spento, e il turno gira fino al tetto sui passi', async () => {
		const budget = chatTokenBudget(0);
		const res = await generateText({
			model: burningModel(5_000_000),
			prompt: 'vai',
			tools: { burn },
			stopWhen: [stepCountIs(3), budget.reached]
		});
		expect(res.steps.length).toBe(3);
		expect(budget.exceeded).toBe(false);
	});
});

describe('resolveChatTokenBudget', () => {
	it('senza variabile prende il default misurato', () => {
		expect(resolveChatTokenBudget(undefined)).toBe(DEFAULT_CHAT_TURN_TOKEN_BUDGET);
		expect(resolveChatTokenBudget('')).toBe(DEFAULT_CHAT_TURN_TOKEN_BUDGET);
	});

	it('un numero lo prende, e 0 spegne il tetto', () => {
		expect(resolveChatTokenBudget('250000')).toBe(250_000);
		expect(resolveChatTokenBudget('0')).toBe(0);
	});

	/**
	 * Una variabile scritta male non deve togliere in silenzio il tetto: `CHAT_TURN_TOKEN_BUDGET=un
	 * milione` diventerebbe NaN, e un NaN in un confronto `>=` è sempre falso — cioè nessun tetto,
	 * senza che niente lo dica. Si torna al default.
	 */
	it('un valore non numerico o negativo ricade sul default, non su “nessun tetto”', () => {
		expect(resolveChatTokenBudget('un milione')).toBe(DEFAULT_CHAT_TURN_TOKEN_BUDGET);
		expect(resolveChatTokenBudget('-1')).toBe(DEFAULT_CHAT_TURN_TOKEN_BUDGET);
		// `Infinity` è il caso che un semplice `n >= 0` lascerebbe passare: un budget infinito non
		// è un budget grande, è nessun budget — e nessuna riga di log lo direbbe.
		expect(resolveChatTokenBudget('Infinity')).toBe(DEFAULT_CHAT_TURN_TOKEN_BUDGET);
	});

	/**
	 * Il default esce dai dati veri (`ai_calls`, label 'chat', 21 giorni, 275 turni, 2026-08-23):
	 * p90 478.534, p95 741.882, p99 1.776.626. Deve stare sopra il p95 — o taglierebbe lavoro
	 * legittimo — e sotto il p99, o non prenderebbe mai la coda che esiste per prendere.
	 */
	it('il default sta fra il p95 e il p99 del traffico misurato', () => {
		expect(DEFAULT_CHAT_TURN_TOKEN_BUDGET).toBeGreaterThan(741_882);
		expect(DEFAULT_CHAT_TURN_TOKEN_BUDGET).toBeLessThan(1_776_626);
	});
});

describe('la riga che l’utente legge', () => {
	it('dice i numeri, in entrambe le lingue, e non promette una ripresa', () => {
		const en = turnTokenBudgetNotice('en', 1_201_249, 1_000_000);
		expect(en).toContain('1.2M');
		expect(en).toContain('1.0M');
		expect(en).not.toMatch(/background/i);
		const it_ = turnTokenBudgetNotice('it', 1_201_249, 1_000_000);
		expect(it_).toContain('1.2M');
		expect(it_).toMatch(/budget/i);
	});
});

/**
 * IL CABLAGGIO. Un tetto su una superficie sola è mezzo tetto, e la regressione tipica è un motore
 * nuovo che se lo dimentica o un merge che perde la riga. Si legge il sorgente, come già fanno
 * ask-user-blocking.test.ts e unattended.test.ts.
 */
const ENGINES = [
	'src/lib/server/chat/queue.ts',
	'src/routes/api/v1/chat/respond/run/+server.ts'
];

describe('il tetto è montato su ogni motore di chat', () => {
	it.each(ENGINES)('%s ha tokenBudget.reached DENTRO stopWhen', (path) => {
		const src = readFileSync(path, 'utf8');
		const stop = src.indexOf('stopWhen:');
		expect(stop).toBeGreaterThan(-1);
		// Nello stesso blocco `stopWhen`, non da qualche altra parte nel file.
		expect(src.slice(stop, src.indexOf(']', stop))).toContain('tokenBudget.reached');
		expect(src).toContain('chatTokenBudget()');
	});

	it.each([ENGINES[0], ENGINES[1]])('%s dice all’utente e nei log perché si è fermato', (path) => {
		const src = readFileSync(path, 'utf8');
		expect(src).toContain('turnTokenBudgetNotice(');
		expect(src).toMatch(/token budget stop/);
		// Ed è il PRIMO ramo della catena, mai uno intermedio: un turno lungo abbastanza da bruciare
		// un milione di token ha quasi sempre finito anche il tempo, quindi messo sotto
		// `deadline.expired` non uscirebbe mai e l'utente leggerebbe «ho finito il tempo» per un
		// turno fermato dal costo.
		expect(src).toContain('if (tokenBudget.exceeded) {');
		expect(src).not.toContain('else if (tokenBudget.exceeded)');
		expect(src).toMatch(/if \(tokenBudget\.exceeded\) \{[\s\S]{0,800}?else if \(loopGuard\.stalled\)/);
	});

	/**
	 * E i due motori che sanno rimettersi in coda da soli NON lo fanno dopo un tetto sui token:
	 * riprendere un turno fermato per costo raddoppia esattamente il costo che il tetto ferma.
	 */
	it.each([ENGINES[0]])('%s non si auto-continua dopo il tetto', (path) => {
		const src = readFileSync(path, 'utf8');
		const should = src.indexOf('const shouldContinue');
		expect(should).toBeGreaterThan(-1);
		expect(src.slice(should, should + 320)).toContain('!tokenBudget.exceeded');
	});
});
