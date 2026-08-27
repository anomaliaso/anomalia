import { describe, expect, it } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { ModelMessage } from 'ai';
import { harnessGenerateText } from './run';

const historyWithSummary: ModelMessage[] = [
	{ role: 'system', content: 'RIASSUNTO DEI TURNI PRECEDENTI: il brand vende scarpe.' },
	{ role: 'user', content: 'quanti post ho in bozza?' }
];

const okModel = (seen: unknown[]) =>
	new MockLanguageModelV3({
		doGenerate: async (opts) => {
			seen.push(opts.prompt);
			return {
				finishReason: { unified: 'stop' as const, raw: 'stop' },
				usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
				content: [{ type: 'text' as const, text: 'ok' }],
				warnings: []
			};
		}
	});

describe('un messaggio di sistema nella storia non uccide il turno', () => {
	it('un chiamante che non passa la flag ottiene comunque un turno vivo', async () => {
		const seen: unknown[] = [];
		const result = await harnessGenerateText<{ text: string }>(
			{ brandId: 'b1', userId: 'u1', agent: 'chat_queue', surface: 'chat' },
			{ model: okModel(seen), system: 'sistema del turno', messages: historyWithSummary }
		);

		expect(result.text).toBe('ok');
		expect(JSON.stringify(seen[0])).toContain('RIASSUNTO DEI TURNI PRECEDENTI');
	});

	it('un chiamante che chiede il rifiuto lo ottiene', async () => {
		const seen: unknown[] = [];
		await expect(
			harnessGenerateText(
				{ brandId: 'b1', userId: 'u1', agent: 'chat_queue', surface: 'chat' },
				{
					model: okModel(seen),
					system: 'sistema del turno',
					messages: historyWithSummary,
					allowSystemInMessages: false
				}
			)
		).rejects.toThrow(/System messages are not allowed/);
	});
});

/**
 * IL 26/8: tre motion di fila morti prima del primo step con «Tool choice must be auto».
 *
 * Lo step forzato esiste per un difetto MISURATO su grok-4-6 — 28.6% dei turni di produzione
 * chiusi a parole, zero strumenti — ma `tool_choice` diverso da `auto` non e` universale:
 * z-ai/glm-5.3-flash su openrouter risponde 400 e il turno muore intero.
 *
 * I due fallimenti non pesano uguale. Non forzare lascia un turno che risponde a parole: brutto,
 * recuperabile, e l'utente puo` insistere. Forzare dove non si puo` uccide il turno prima che
 * cominci. Quindi l'elenco dice chi lo SUPPORTA, non chi lo rifiuta: un modello nuovo perde una
 * protezione invece di non partire.
 */
describe('lo step forzato solo dove il modello lo accetta', () => {
	const brief = [{ role: 'user' as const, content: 'genera un video di lancio' }];

	it('grok — il modello che ha prodotto il difetto — resta forzato', async () => {
		const { forcedFirstStepTools } = await import('./run');
		const forced = forcedFirstStepTools(
			{ surface: 'chat', agent: 'motion', model: 'grok-4-6' },
			brief,
			['motion_write', 'reply']
		);
		expect(forced).toContain('motion_write');
	});

	it('glm su openrouter NON viene forzato: quel 400 costa il turno intero', async () => {
		const { forcedFirstStepTools } = await import('./run');
		expect(
			forcedFirstStepTools(
				{ surface: 'chat', agent: 'motion', model: 'z-ai/glm-5.3-flash' },
				brief,
				['motion_write', 'reply']
			)
		).toEqual([]);
	});

	it('un modello mai visto non viene forzato', async () => {
		const { forcedFirstStepTools } = await import('./run');
		expect(
			forcedFirstStepTools(
				{ surface: 'chat', agent: 'motion', model: 'qualcuno/modello-nuovo' },
				brief,
				['motion_write']
			)
		).toEqual([]);
	});
});
