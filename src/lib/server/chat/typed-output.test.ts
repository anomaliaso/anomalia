import { describe, expect, it } from 'vitest';
import { Output, generateText, stepCountIs, tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

/**
 * PERCHÉ IL CONTRATTO DI CONSEGNA TIPATO (`Output.object`) NON È IN CHAT.
 *
 * La domanda era: un turno che dichiara una consegna può essere costretto a portare l'id
 * dell'artefatto in un CAMPO invece che in una frase? `Output` esiste davvero nel nostro `ai` v6 e
 * funziona. La risposta è comunque no, per tre fatti — due dell'SDK, uno del guasto.
 *
 * 1. `responseFormat` NON è dell'ultimo passo: l'SDK lo attacca a OGNI chiamata del ciclo
 *    (`node_modules/ai/dist/index.mjs:4646` per generateText, `:7634` per streamText). Questo test
 *    lo misura: il passo 0 di un ciclo con strumenti riceve già `{ type: 'json' }`. In chat vuol
 *    dire settantacinque passi in modalità JSON, cioè niente prosa da trasmettere all'utente su una
 *    superficie che trasmette markdown mentre il turno gira.
 *
 * 2. Non esiste un punto dove RIFIUTARE. Il ciclo dell'AI SDK prosegue solo se l'ultimo passo ha
 *    prodotto chiamate a strumenti; un passo di solo testo chiude il turno comunque, e `stopWhen`
 *    può solo fermare prima, mai prolungare (già scritto e verificato in goal-tools.ts). `Output`
 *    cambia il FORMATO di quel testo, non la possibilità di rimandare indietro il turno.
 *
 * 3. Uno schema vincola la FORMA, non la verità. I casi misurati in production-claim.ts sono un
 *    modello che copia in una frase un URL MP4 vero, letto da `list_motion_videos` nello stesso
 *    turno, e un modello che spunta un criterio dopo che lo strumento gli ha detto di no. Un campo
 *    `artifact_id: string` obbligatorio si riempie con lo stesso URL copiato dalla stessa lettura.
 *    L'unica ancora che non si può falsificare sono gli OUTPUT DEGLI STRUMENTI di quel turno — che
 *    `production-claim.ts` legge già (`turnHasArtifactProof`, `refusedAndNotRetried`, `wroteNothing`).
 *
 * Quindi `Output` aggiungerebbe una cosa sola: uno slot leggibile a macchina al posto di una regex
 * sulla prosa (production-claim.ts ammette che «la lista non finisce mai»). E quella cosa, in questo
 * repo, ha già la sua forma compatibile con lo streaming e col ciclo: un tool `finish` con schema
 * zod, come `finish` in image-agent.ts — l'input di una
 * chiamata a strumento È validato dallo schema, È un passo, e il suo risultato è terreno solido che
 * le guardie leggono già.
 *
 * QUESTO TEST NON PROTEGGE DEL CODICE NOSTRO: protegge la DECISIONE. Se un aggiornamento di `ai`
 * rendesse `output` valido solo sull'ultimo passo, il fatto 1 cade e la domanda va riaperta.
 */
describe('Output.object dentro un ciclo con strumenti', () => {
	it('mette il formato JSON su OGNI passo, non solo sull’ultimo', async () => {
		let n = 0;
		const model = new MockLanguageModelV3({
			doGenerate: async () => {
				n++;
				const usage = {
					inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 1, text: 1, reasoning: 0 }
				};
				if (n < 3) {
					return {
						content: [
							{ type: 'tool-call' as const, toolCallId: `c${n}`, toolName: 'w', input: '{}' }
						],
						finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
						usage,
						warnings: []
					};
				}
				return {
					content: [{ type: 'text' as const, text: '{"delivered":true,"artifact_id":"abc"}' }],
					finishReason: { unified: 'stop' as const, raw: 'stop' },
					usage,
					warnings: []
				};
			}
		});

		await generateText({
			model,
			prompt: 'vai',
			tools: {
				w: tool({ description: 'w', inputSchema: z.object({}), execute: async () => ({ ok: 1 }) })
			},
			stopWhen: [stepCountIs(10)],
			output: Output.object({
				schema: z.object({ delivered: z.boolean(), artifact_id: z.string() })
			})
		});

		expect(model.doGenerateCalls.length).toBe(3);
		// Il passo 0 è un passo che chiama uno strumento, e riceve già lo schema come responseFormat.
		expect(model.doGenerateCalls[0].responseFormat?.type).toBe('json');
		expect(model.doGenerateCalls[1].responseFormat?.type).toBe('json');
	});
});
