import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');
const reads = (f: string) => readFileSync(join(root, f), 'utf8');

const STREAMING = ['lib/server/media-generator/agent.ts', 'lib/server/motion-video/agent.ts'];

// `harness/index` riesporta `harness/run`, che importa `chat/model` e `chat/controller`: chi
// prende la traccia dall'indice si porta dentro la chat e `$lib/agent` senza usarli. I moduli
// foglia non li toccano, e questo test è l'unica cosa che impedisce di «riordinare» l'import.
describe('i due agenti in streaming guidano l SDK', () => {
	it.each(STREAMING)('%s chiama streamText e non passa dall indice del framework', (file) => {
		const src = reads(file);
		expect(src).toMatch(/streamText\(\{/);
		expect(src).not.toContain('harnessStreamText');
		expect(src).not.toMatch(/from '\$lib\/server\/harness'/);
		expect(src).toMatch(/from '\$lib\/server\/harness\/session'/);
		expect(src).toMatch(/from '\$lib\/server\/harness\/persist'/);
	});

	/**
	 * MISURATO, NON DEDOTTO — 2026-09-04.
	 *
	 * `surface: 'chat'` accendeva due rami: il controllore in ombra e lo strumento forzato al
	 * primo step. Il secondo passa da `acceptsForcedToolChoice(model)`, che vuole un id di modello
	 * con dentro `grok`. Questi due risolvono il modello dal centralino
	 * (`google/gemini-3.8-flash` con la configurazione di oggi): su dodici richieste tipiche il
	 * ramo è scattato **0 volte**, mentre lo stesso elenco su un id grok scatta 5 volte — cioè la
	 * regex discrimina, ma non ci si arriva mai. Il controllore in ombra vuole
	 * `CHAT_CONTROLLER=shadow`, che non è impostato da nessuna parte.
	 *
	 * E se ci si fosse arrivati sarebbe stato peggio: `FORCED_STEP_EXCLUDE` toglie
	 * `ask_user_questions` dallo step forzato, e motion video ce l'ha — forzare uno strumento
	 * mentre gli si toglie l'unico modo di fare una domanda è il difetto, non la protezione.
	 *
	 * Quindi `batch`, che è la verità: nessuno dei due è un turno di chat.
	 */
	it.each(STREAMING)('%s dichiara la superficie batch', (file) => {
		expect(reads(file)).toMatch(/surface: 'batch'/);
		expect(reads(file)).not.toMatch(/surface: 'chat'/);
	});
});

// Quello che il coordinatore deve sapere prima di portarsi via la chat: `harness/run.ts` e
// `harness/index.ts` non hanno più nessun chiamante fuori dalle rotte chat.
describe('chi chiama ancora l involucro', () => {
	it('solo le rotte chat', () => {
		const callers = [
			'routes/api/v1/chat/respond/run/+server.ts',
			'routes/app/[brand]/chat/+server.ts'
		];
		for (const c of callers) {
			expect(reads(c)).toMatch(/harness(Generate|Stream)Text/);
		}
	});
});
