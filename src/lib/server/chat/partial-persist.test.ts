import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assistantContentFromPartial, contentFromFailedTurn } from './partial-persist';
import { assistantContentFromSteps, messagesFromRow } from './persistence';

describe('assistantContentFromPartial', () => {
	it('returns empty for null/empty snapshots', () => {
		expect(assistantContentFromPartial(null)).toEqual([]);
		expect(assistantContentFromPartial({})).toEqual([]);
		expect(assistantContentFromPartial({ text: '', tools: [] })).toEqual([]);
	});

	it('keeps plain truncated text', () => {
		const content = assistantContentFromPartial({ text: 'Ciao mondo a metà' });
		expect(content).toEqual([{ type: 'text', text: 'Ciao mondo a metà' }]);
	});

	it('interleaves text slices with tools using textLen', () => {
		const content = assistantContentFromPartial({
			text: 'Prima.Dopo i tool.',
			tools: [
				{ toolCallId: 'a', toolName: 'list_articles', status: 'done', textLen: 6 },
				{ toolCallId: 'b', toolName: 'optimize_article', status: 'running', textLen: 6 }
			]
		});
		expect(content.map((p) => p.type)).toEqual(['text', 'tool-call', 'tool-call', 'text']);
		expect(content[0]).toMatchObject({ type: 'text', text: 'Prima.' });
		expect(content[1]).toMatchObject({ type: 'tool-call', toolName: 'list_articles', status: 'done' });
		expect(content[3]).toMatchObject({ type: 'text', text: 'Dopo i tool.' });
	});

	it('a turn killed mid effectful tool: the reloaded history hands the model the pair with the uncertainty note', () => {
		const content = assistantContentFromPartial({
			text: 'Genero la grafica.',
			tools: [
				{ toolCallId: 'c1', toolName: 'generate_image', status: 'running', textLen: 18, input: { prompt: 'p' } }
			]
		});
		const msgs = messagesFromRow({ role: 'assistant', content: 'Genero la grafica.', tool_calls: content });
		const call = msgs
			.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
			.find((p) => (p as { type?: string }).type === 'tool-call') as { toolCallId: string; input: unknown } | undefined;
		expect(call).toMatchObject({ toolCallId: 'c1', toolName: 'generate_image', input: { prompt: 'p' } });
		const result = msgs
			.flatMap((m) => (m.role === 'tool' && Array.isArray(m.content) ? m.content : []))
			.find((p) => (p as { toolCallId?: string }).toolCallId === 'c1') as
			| { output: { type: string; value: string } }
			| undefined;
		expect(result?.output.type).toBe('text');
		expect(result?.output.value).toContain('outcome unknown');
	});

	it('includes reasoning when present', () => {
		const content = assistantContentFromPartial({
			text: 'ok',
			reasoning: 'sto pensando'
		});
		expect(content[0]).toMatchObject({ type: 'reasoning', text: 'sto pensando' });
		expect(content[1]).toMatchObject({ type: 'text', text: 'ok' });
	});

	// Lo specchio kit scrive i segmenti al posto della stringa piatta: il checkpoint di un turno
	// salvato a metà non deve perdere il ragionamento solo perché ora arriva a pezzi.
	it('legge il ragionamento anche quando lo snapshot porta i segmenti', () => {
		const content = assistantContentFromPartial({
			text: 'ok',
			reasoningSegments: [
				{ text: 'valuto', textLen: 0, toolsBefore: 0 },
				{ text: 'decido', textLen: 0, toolsBefore: 0 }
			]
		});
		expect(content[0]).toMatchObject({ type: 'reasoning', text: 'valuto\n\ndecido' });
	});
});

describe('contentFromFailedTurn', () => {
	it('prefers real steps over the SSE mirror', () => {
		const steps = [
			{
				text: 'Da steps',
				toolCalls: [{ toolCallId: 'x', toolName: 'list_articles', input: {} }]
			}
		];
		const content = contentFromFailedTurn({
			steps,
			text: 'Da steps',
			partial: { text: 'Da partial' }
		});
		expect(assistantContentFromSteps(steps, 'Da steps')).toEqual(content);
		expect(content.some((p) => p.type === 'text' && p.text === 'Da steps')).toBe(true);
	});

	it('falls back to partial when steps are empty', () => {
		const content = contentFromFailedTurn({
			steps: [],
			text: '',
			partial: { text: 'Salvato dal mirror' }
		});
		expect(content).toEqual([{ type: 'text', text: 'Salvato dal mirror' }]);
	});

	/**
	 * IL BUCO CHE FACEVA SPARIRE LA MISURA PROPRIO DOVE SERVIVA.
	 *
	 * Il salvataggio parziale scriveva `input: {}` a mano, quindi un turno ucciso dal muro dei 300
	 * secondi persisteva le chiamate senza sapere con cosa erano state fatte. Su 60 giorni: 0% di
	 * argomenti persi nei turni normali, 24% oltre i 250 secondi, 100% nei salvataggi parziali.
	 */
	it('porta gli argomenti della chiamata, non un oggetto vuoto', () => {
		const parts = assistantContentFromPartial({
			text: '',
			tools: [{ toolCallId: 'c1', toolName: 'read_file', textLen: 0, input: { path: 'how/MAKE-MOTION-VIDEO.md' } }]
		});
		const call = parts.find((p) => p.type === 'tool-call');
		expect(call.input).toEqual({ path: 'how/MAKE-MOTION-VIDEO.md' });
	});

	it('una chiamata senza argomenti resta un oggetto vuoto, non undefined', () => {
		const parts = assistantContentFromPartial({ text: '', tools: [{ toolCallId: 'c1', toolName: 'read_brand_kit', textLen: 0 }] });
		expect(parts.find((p) => p.type === 'tool-call').input).toEqual({});
	});
});


/**
 * LA RIPRESA CHE MUORE SENZA LASCIARE TRACCIA.
 *
 * Verificato in produzione (thread e61c5136, 22/08): la continuazione dell'obiettivo è nata alle
 * 20:04:08.9 ed è morta alle 20:04:13 su un errore di import. `contentFromFailedTurn` non aveva
 * niente da salvare — il turno era morto prima di scrivere una parola — quindi in chat non è
 * comparso nulla. Il browser stava guardando solo il job che aveva avviato lui, e l'utente ha
 * aspettato due minuti prima di scrivere «coninua» a un sistema in cui non stava girando niente.
 *
 * Test sulla sorgente e non sul comportamento: il ramo vive dentro `failChatJob`, che è privata e
 * parla solo con Supabase. Quello che deve restare vero è che il ramo ci sia.
 */
describe('failChatJob — una continuazione fallita lo dice in chat', () => {
	const src = readFileSync('src/lib/server/chat/queue.ts', 'utf8');

	it('scrive una riga nel thread quando muore una ripresa che non ha prodotto niente', () => {
		const at = src.indexOf("params?.continuation === true");
		expect(at).toBeGreaterThan(0);
		const branch = src.slice(at - 400, at + 1200);
		expect(branch).toContain("tool_name === 'chat_response'");
		expect(branch).toContain("from('chat_messages')");
		expect(branch).toContain('Nothing is running now');
	});

	it('non la scrive se il turno aveva già salvato un parziale', () => {
		const at = src.indexOf("params?.continuation === true");
		expect(src.slice(at, at + 400)).toContain('partial');
	});
});
