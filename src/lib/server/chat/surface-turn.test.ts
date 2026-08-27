import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	assistantPartsFromStream,
	closeSurfaceTurn,
	collectSurfaceReply,
	surfaceThreadTitle,
	MAX_PERSISTED_PAYLOAD_CHARS,
	MAX_PERSISTED_PAYLOAD_TOTAL
} from './surface-turn';
import { saveMessages } from './persistence';

describe('surfaceThreadTitle', () => {
	it('uses the first non-empty line of the brief — what a human scans in the sidebar', () => {
		expect(surfaceThreadTitle('\n\n  Video di lancio degli Agents\nsecondo paragrafo', 'Motion')).toBe(
			'Video di lancio degli Agents'
		);
	});

	it('falls back when the brief has no usable line', () => {
		expect(surfaceThreadTitle('   \n\n', 'Motion video')).toBe('Motion video');
	});

	it('never writes a title longer than the column expects', () => {
		expect(surfaceThreadTitle('x'.repeat(300), 'Motion').length).toBe(80);
	});
});

describe('collectSurfaceReply', () => {
	const sse = (events: unknown[]) =>
		new ReadableStream<string>({
			start(c) {
				for (const e of events) c.enqueue(`data: ${JSON.stringify(e)}\n\n`);
				c.close();
			}
		});

	it('accumulates the assistant text off the stream', async () => {
		const collected = collectSurfaceReply();
		await collected.consumeSseStream({
			stream: sse([
				{ type: 'text-delta', delta: 'Ho costruito ' },
				{ type: 'text-delta', delta: 'la composizione.' }
			])
		});
		expect(collected.state().text).toContain('Ho costruito');
		expect(collected.state().text).toContain('la composizione.');
	});

	it('loses the transcript, never the turn, when the stream is garbage', async () => {
		const collected = collectSurfaceReply();
		await expect(
			collected.consumeSseStream({
				stream: new ReadableStream<string>({
					start(c) {
						c.enqueue('data: {not json\n\n');
						c.close();
					}
				})
			})
		).resolves.toBeUndefined();
	});
});

describe('the maker surfaces record their turns', () => {
	const reads = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

	it('Motion opens a thread before the turn and closes it with the reply', () => {
		const src = reads('../../../routes/app/[brand]/motion-video/+server.ts');
		const open = src.indexOf('openSurfaceTurn(');
		const close = src.indexOf('closeSurfaceTurn(');
		expect(open).toBeGreaterThan(-1);
		expect(close).toBeGreaterThan(open);
		expect(src).toContain("surface: 'motion'");
		expect(src).toContain("agent: 'motion'");
		// A composition that did not exist yet gets its thread keyed once it is saved.
		expect(src).toContain('keySurfaceTurn(');
	});

	it('the Media Generator and the UGC run do the same, each with its own agent', () => {
		const src = reads('../../../routes/app/[brand]/media-generator/+server.ts');
		expect(src).toContain("surface: 'media'");
		expect(src).toContain("agent: 'media'");
		expect(src).toContain("surface: 'ugc'");
		expect(src).toContain("agent: 'ugc'");
		expect(src).toContain('collectSurfaceReply(');
	});
});

describe('the global sidebar', () => {
	it('lists surface threads alongside the ordinary ones', () => {
		// listThreads hides only per-post editor threads (post_id). A maker thread has no post_id,
		// so it shows up in the sidebar with everything else — which is the whole point.
		const src = readFileSync(new URL('./persistence.ts', import.meta.url), 'utf8');
		const fn = src.slice(src.indexOf('export async function listThreads'));
		const body = fn.slice(0, fn.indexOf('\n}'));
		expect(body).toContain(".is('post_id', null)");
		expect(body).not.toContain("'surface'");
	});
});


describe('assistantPartsFromStream', () => {
	// The real trace that exposed the bug: every line the agent writes before a tool call, glued
	// into one run-on paragraph with the calls themselves missing.
	const REAL = {
		text:
			'Studio un riferimento di lancio su posts.design.' +
			'Leggo i dettagli del brand studio.' +
			'Scrivo la composizione Remotion completa.' +
			'Imposto il titolo nella gallery.',
		tools: [
			{ toolCallId: 'a', toolName: 'study_motion_reference', textLen: 48 },
			{ toolCallId: 'b', toolName: 'read_brand_kit', textLen: 82 },
			{ toolCallId: 'c', toolName: 'write_source', textLen: 123 },
			{ toolCallId: 'd', toolName: 'set_title', textLen: 156 }
		]
	};

	it('slots each call back between the lines that introduced it', () => {
		const parts = assistantPartsFromStream(REAL);
		expect(parts.map((p) => (p.type === 'text' ? 'text' : p.toolName))).toEqual([
			'text',
			'study_motion_reference',
			'text',
			'read_brand_kit',
			'text',
			'write_source',
			'text',
			'set_title'
		]);
		expect(parts[0]).toEqual({ type: 'text', text: 'Studio un riferimento di lancio su posts.design.' });
	});

	it('never loses a character of the transcript', () => {
		const joined = assistantPartsFromStream(REAL)
			.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
			.map((p) => p.text)
			.join('');
		expect(joined).toBe(REAL.text);
	});

	it('keeps a trailing reply after the last call', () => {
		const parts = assistantPartsFromStream({
			text: 'Faccio una cosa.Fatto: ecco il video.',
			tools: [{ toolCallId: 'a', toolName: 'write_source', textLen: 'Faccio una cosa.'.length }]
		});
		expect(parts.at(-1)).toEqual({ type: 'text', text: 'Fatto: ecco il video.' });
	});

	it('handles a turn that was all tools and no prose', () => {
		const parts = assistantPartsFromStream({
			text: '',
			tools: [{ toolCallId: 'a', toolName: 'finish', textLen: 0 }]
		});
		expect(parts).toEqual([{ type: 'tool-call', toolCallId: 'a', toolName: 'finish', input: {} }]);
	});

	it('handles prose with no tools, and an empty turn', () => {
		expect(assistantPartsFromStream({ text: 'Solo testo.', tools: [] })).toEqual([
			{ type: 'text', text: 'Solo testo.' }
		]);
		expect(assistantPartsFromStream({ text: '', tools: [] })).toEqual([]);
	});

	it('survives a textLen past the end of the transcript', () => {
		const parts = assistantPartsFromStream({
			text: 'breve',
			tools: [{ toolCallId: 'a', toolName: 'x', textLen: 9999 }]
		});
		expect(parts).toEqual([
			{ type: 'text', text: 'breve' },
			{ type: 'tool-call', toolCallId: 'a', toolName: 'x', input: {} }
		]);
	});

	it('orders calls by where they fired, not by arrival', () => {
		const parts = assistantPartsFromStream({
			text: 'unodue',
			tools: [
				{ toolCallId: 'b', toolName: 'second', textLen: 6 },
				{ toolCallId: 'a', toolName: 'first', textLen: 3 }
			]
		});
		expect(parts.filter((p) => p.type === 'tool-call').map((p) => (p as { toolName: string }).toolName)).toEqual([
			'first',
			'second'
		]);
	});
});

describe('the QC briefs are all mandatory', () => {
	it('the fidelity brief is named in the apply clause', () => {
		// The clause listed only MOTION CRAFT QC and SELLABILITY QC, so a REFERENCE FIDELITY brief
		// was not covered: the agent answered a 4/10 fidelity with prose, called finish, and the
		// source never changed. The QC loop then stopped on qc_apply_noop.
		const src = readFileSync(
			new URL('../motion-video/agent.ts', import.meta.url),
			'utf8'
		);
		expect(src).toContain('REFERENCE FIDELITY FAILED');
		expect(src).toContain('ANY QC brief');
		expect(src).toContain('calling finish without one is the same failure');
	});
});

/**
 * I PARAMETRI E IL RISULTATO nella riga salvata.
 *
 * Difetto trovato in produzione: riaprendo un thread della pagina Motion — o passando alla chat —
 * le chip dei tool c'erano ma non si apriva niente. `assistantPartsFromStream` scriveva
 * `input: {}` e nessun output, buttando via due campi che lo stato dello stream aveva già.
 */
describe('assistantPartsFromStream — payload', () => {
	const call = (over: Record<string, unknown> = {}) => ({
		toolCallId: 'c1',
		toolName: 'render_stills',
		textLen: 0,
		...over
	});

	it('salva i parametri con cui il tool è partito', () => {
		const parts = assistantPartsFromStream({
			text: 'rendo',
			tools: [call({ input: { at_seconds: [1, 2] } })] as never
		});
		const t = parts.find((p) => p.type === 'tool-call') as { input: unknown };
		expect(t.input).toEqual({ at_seconds: [1, 2] });
	});

	it('salva quello che il tool ha risposto', () => {
		const parts = assistantPartsFromStream({
			text: 'rendo',
			tools: [call({ output: { rendered_frames: [30, 60] } })] as never
		});
		const t = parts.find((p) => p.type === 'tool-call') as { output: unknown };
		expect(t.output).toEqual({ rendered_frames: [30, 60] });
	});

	it('una chiamata mai tornata non porta un output finto', () => {
		const parts = assistantPartsFromStream({ text: 'x', tools: [call()] as never });
		const t = parts.find((p) => p.type === 'tool-call') as Record<string, unknown>;
		expect('output' in t).toBe(false);
	});

	it('tronca i payload enormi invece di ricaricarli interi a ogni riapertura', () => {
		const huge = { report: 'x'.repeat(MAX_PERSISTED_PAYLOAD_CHARS * 3) };
		const parts = assistantPartsFromStream({
			text: 'x',
			tools: [call({ output: huge })] as never
		});
		const t = parts.find((p) => p.type === 'tool-call') as { output: string };
		expect(typeof t.output).toBe('string');
		// Troncato E dichiarato: un risultato tagliato si legge, uno sparito no.
		expect(t.output).toMatch(/…\[\+\d+\]$/);
	});

	it('un payload che non si serializza non fa fallire il salvataggio del turno', () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const parts = assistantPartsFromStream({
			text: 'x',
			tools: [call({ output: cyclic })] as never
		});
		const t = parts.find((p) => p.type === 'tool-call') as { output: unknown };
		expect(t.output).toBe('[unserializable]');
	});

	it('porta anche il messaggio di errore, quando c’è', () => {
		const parts = assistantPartsFromStream({
			text: 'x',
			tools: [call({ errorText: 'voiceover_failed' })] as never
		});
		const t = parts.find((p) => p.type === 'tool-call') as { errorText: string };
		expect(t.errorText).toBe('voiceover_failed');
	});
});

/**
 * IL TETTO COMPLESSIVO, e la ragione per cui esiste.
 *
 * Il tetto per chiamata da solo non bastava: quaranta chiamate da quattromila caratteri fanno
 * centosessantamila, la riga non entrava, il salvataggio falliva e — con un solo tentativo dentro
 * un catch — l'INTERA risposta dell'agente spariva. L'utente riapriva il thread della pagina Motion
 * e ci trovava solo la propria domanda.
 */
describe('assistantPartsFromStream — tetto complessivo', () => {
	const many = (n: number, size: number) =>
		Array.from({ length: n }, (_, i) => ({
			toolCallId: `c${i}`,
			toolName: 'delegate_task',
			textLen: 0,
			output: { report: 'x'.repeat(size) }
		}));

	it('un turno lungo non produce una riga sconfinata', () => {
		const parts = assistantPartsFromStream({ text: 'lavoro', tools: many(40, 3_000) as never });
		const size = JSON.stringify(parts).length;
		// `* 2` era il margine che copriva il conto sbagliato: si contava `.length` della stringa e
		// si salvava il JSON, dove ogni virgoletta ne vale due. Ora il costo è quello serializzato,
		// e l'unico sforamento legittimo è lo scheletro delle chip — nome e id, che non si buttano.
		const chipSkeleton = parts.length * 120;
		expect(size).toBeLessThan(MAX_PERSISTED_PAYLOAD_TOTAL + chipSkeleton);
	});

	it('le stringhe si contano come vengono salvate, non crude', () => {
		// Una stringa fatta di sole virgolette raddoppia nel JSON: contata cruda, un tetto di 24k
		// produceva righe da 48k, cioè non era un tetto.
		const nasty = '"'.repeat(MAX_PERSISTED_PAYLOAD_CHARS - 1);
		const parts = assistantPartsFromStream({
			text: '',
			tools: Array.from({ length: 12 }, (_, i) => ({
				toolCallId: `c${i}`,
				toolName: 'delegate_task',
				textLen: 0,
				output: nasty
			})) as never
		});
		expect(JSON.stringify(parts).length).toBeLessThan(
			MAX_PERSISTED_PAYLOAD_TOTAL + parts.length * 120
		);
	});

	/**
	 * L'ERRORE, che nessuno contava.
	 *
	 * Un turno Motion con quaranta deleghe fallite scriveva 40 × 2.000 caratteri di `errorText` in
	 * una riga che il tetto credeva sotto i ventiquattromila: esattamente la riga sconfinata che il
	 * tetto esiste per impedire, dall'unico campo fuori dal conto. Il test che c'era passava perché
	 * non impostava mai `errorText`.
	 */
	it('anche i messaggi di errore passano dal tetto', () => {
		const failures = Array.from({ length: 40 }, (_, i) => ({
			toolCallId: `c${i}`,
			toolName: 'delegate_task',
			textLen: 0,
			errorText: 'e'.repeat(2_000)
		}));
		const parts = assistantPartsFromStream({ text: 'lavoro', tools: failures as never });
		expect(parts.filter((p) => p.type === 'tool-call')).toHaveLength(40);
		expect(JSON.stringify(parts).length).toBeLessThan(
			MAX_PERSISTED_PAYLOAD_TOTAL + parts.length * 120
		);
	});

	it('la trascrizione si scala dal budget: resta intera, e lascia meno spazio ai payload', () => {
		const longReply = 'x'.repeat(MAX_PERSISTED_PAYLOAD_TOTAL);
		const parts = assistantPartsFromStream({
			text: longReply,
			tools: [{ toolCallId: 'c0', toolName: 'delegate_task', textLen: 0, output: { r: 'y'.repeat(100) } }] as never
		});
		// Il testo non si tocca mai — è la risposta.
		expect(parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('')).toBe(longReply);
		// Ma il payload non entra più: il tetto vale per la riga intera.
		expect((parts.find((p) => p.type === 'tool-call') as { output?: unknown }).output).toBeUndefined();
	});

	it('il budget si spende come un prefisso: dopo il primo che non entra, nessuno', () => {
		// Prima si saltava quello troppo grande e si continuava, così la chip 12 poteva essere nuda
		// e la 13 piena. Una traccia che si legge come lavoro interrotto, non come spazio finito.
		const parts = assistantPartsFromStream({
			text: '',
			tools: [...many(8, MAX_PERSISTED_PAYLOAD_CHARS), { toolCallId: 'last', toolName: 't', textLen: 0, output: { r: 'piccolo' } }] as never
		});
		const calls = parts.filter((p) => p.type === 'tool-call') as Array<{ output?: unknown }>;
		// Il primo che non entra chiude il rubinetto: da lì in poi nessuno, nemmeno chi ci starebbe.
		const firstDropped = calls.findIndex((c) => c.output === undefined);
		expect(firstDropped).toBeGreaterThan(0);
		for (const c of calls.slice(firstDropped)) expect(c.output).toBeUndefined();
		expect(calls.at(-1)!.output).toBeUndefined();
	});

	it('un input lasciato fuori dal tetto si omette, non diventa `{}`', () => {
		// `{}` vuol dire "il tool non prende parametri". Scriverlo per un input troncato via faceva
		// concludere a chi apriva la chip che l'agente avesse chiamato il tool senza argomenti.
		const parts = assistantPartsFromStream({
			text: '',
			tools: [
				...many(8, MAX_PERSISTED_PAYLOAD_CHARS),
				{ toolCallId: 'late', toolName: 't', textLen: 0, input: { q: 'una domanda vera' } },
				{ toolCallId: 'none', toolName: 't', textLen: 0 }
			] as never
		});
		const calls = parts.filter((p) => p.type === 'tool-call') as Array<Record<string, unknown>>;
		const late = calls.find((c) => c.toolCallId === 'late')!;
		const none = calls.find((c) => c.toolCallId === 'none')!;
		expect('input' in late).toBe(false);
		expect(none.input).toEqual({});
	});

	it('le chip ci sono TUTTE anche quando i payload non entrano', () => {
		// Perdere il payload è un peccato; perdere la traccia di cosa è stato chiamato è un buco.
		const parts = assistantPartsFromStream({ text: 'lavoro', tools: many(40, 3_000) as never });
		expect(parts.filter((p) => p.type === 'tool-call')).toHaveLength(40);
	});

	it('il budget si spende dall’inizio del turno, dove si capisce cosa ha deciso', () => {
		const parts = assistantPartsFromStream({ text: 'lavoro', tools: many(40, 3_000) as never });
		const calls = parts.filter((p) => p.type === 'tool-call') as Array<{ output?: unknown }>;
		expect(calls[0].output).toBeDefined();
		expect(calls[calls.length - 1].output).toBeUndefined();
	});

	it('payloadBudget 0 dà chip nude — è il gradino di ripiego del salvataggio', () => {
		const parts = assistantPartsFromStream(
			{ text: 'lavoro', tools: many(3, 100) as never },
			{ payloadBudget: 0 }
		);
		const calls = parts.filter((p) => p.type === 'tool-call') as Array<{ output?: unknown }>;
		expect(calls).toHaveLength(3);
		for (const c of calls) expect(c.output).toBeUndefined();
	});

	it('un turno normale non viene toccato dal tetto', () => {
		// Il tetto è una rete, non una potatura: sei chiamate con output veri restano intatte.
		const parts = assistantPartsFromStream({ text: 'ok', tools: many(6, 200) as never });
		const calls = parts.filter((p) => p.type === 'tool-call') as Array<{ output?: unknown }>;
		for (const c of calls) expect(c.output).toBeDefined();
	});
});


/**
 * LA SCALA DI RIPIEGO, che era codice morto.
 *
 * `saveMessages` faceva `if (error) console.error(...)` e tirava dritto: postgrest-js non lancia,
 * trasforma anche una connessione caduta in `{ error }`. Quindi il primo gradino "riusciva"
 * sempre, `closeSurfaceTurn` tornava contento, e l'utente riapriva il thread trovandoci solo la
 * propria domanda — esattamente il caso per cui la scala era stata scritta. Nessun test la
 * copriva, ed è per questo che è stata spedita così.
 */
describe('closeSurfaceTurn — la scala di ripiego', () => {
	/** Un client che risponde all'insert secondo un copione, e registra cosa gli è stato scritto. */
	const fakeSupabase = (plan: Array<{ error?: string }> = [], onTouch?: () => void) => {
		const inserts: Array<Array<Record<string, unknown>>> = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const client: any = {
			from: (table: string) => {
				if (table !== 'chat_messages') {
					return {
						update: () => ({
							eq: async () => {
								onTouch?.();
								return {};
							}
						})
					};
				}
				return {
					insert: (rows: Array<Record<string, unknown>>) => {
						inserts.push(rows);
						const step = plan[inserts.length - 1];
						return {
							select: async () =>
								step?.error
									? { data: null, error: { message: step.error } }
									: { data: rows.map((_, i) => ({ id: `r${i}` })), error: null }
						};
					}
				};
			}
		};
		return { client, inserts };
	};

	const thread = { id: 't1' } as never;
	const state = {
		text: 'Ho costruito la composizione.',
		tools: [{ toolCallId: 'a', toolName: 'write_source', textLen: 0, output: { ok: true } }]
	} as never;

	it('saveMessages ALZA quando la riga non entra, invece di loggare e tirare dritto', async () => {
		const { client } = fakeSupabase([{ error: 'value too long for type character varying' }]);
		await expect(
			saveMessages(client, 'b1', 'u1', [{ role: 'user', content: 'ciao' }], 't1')
		).rejects.toThrow(/value too long/);
	});

	it('la riga troppo grande scende al gradino delle chip nude, e la risposta si salva', async () => {
		const { client, inserts } = fakeSupabase([{ error: 'row is too big' }]);
		await closeSurfaceTurn(client, thread, { brandId: 'b1', userId: 'u1', state });
		expect(inserts).toHaveLength(2);
		// Secondo tentativo: le stesse chip, senza payload.
		const retry = JSON.stringify(inserts[1][0].tool_calls);
		expect(retry).toContain('write_source');
		expect(retry).not.toContain('"output"');
	});

	it('e quando il primo tentativo entra, non ne fa un secondo', async () => {
		const { client, inserts } = fakeSupabase();
		await closeSurfaceTurn(client, thread, { brandId: 'b1', userId: 'u1', state });
		expect(inserts).toHaveLength(1);
	});

	it('un guasto DOPO l\'insert non duplica la risposta in chat', async () => {
		// La riga è dentro: `touchThread` o il broadcast che falliscono non valgono un secondo
		// messaggio identico sotto il primo. `write()` non è idempotente, quindi l'unico modo di
		// far funzionare la scala è che l'eccezione significhi SOLO "non è entrato niente".
		const { client, inserts } = fakeSupabase([], () => {
			throw new Error('thread touch failed');
		});
		await closeSurfaceTurn(client, thread, { brandId: 'b1', userId: 'u1', state });
		expect(inserts).toHaveLength(1);
	});
});
