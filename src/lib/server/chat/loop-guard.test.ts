import { describe, expect, it } from 'vitest';
import {
	CHAT_LOOP_THRESHOLD,
	TOOL_BENCH_FAILURES,
	benchAwarePrepareStep,
	chatLoopDetected,
	chatStepFingerprint,
	createChatLoopGuard,
	failedToolCalls,
	identicalTail,
	isRepeatedReply,
	oscillatingTail,
	toolBenchNotice
} from './loop-guard';

describe('chatStepFingerprint', () => {
	it('is stable for the same tool+input', () => {
		const a = chatStepFingerprint([{ toolName: 'read_posts', input: { status: 'pending' } }], 'ok');
		const b = chatStepFingerprint([{ toolName: 'read_posts', input: { status: 'pending' } }], 'ok');
		expect(a).toBe(b);
	});

	it('changes when the tool input changes', () => {
		const a = chatStepFingerprint([{ toolName: 'read_posts', input: { status: 'pending' } }]);
		const b = chatStepFingerprint([{ toolName: 'read_posts', input: { status: 'scheduled' } }]);
		expect(a).not.toBe(b);
	});
});

describe('identicalTail / oscillatingTail', () => {
	it('needs a full threshold before identical fires', () => {
		const fp = 'x';
		expect(identicalTail([fp, fp, fp, fp], 5)).toBe(false);
		expect(identicalTail([fp, fp, fp, fp, fp], 5)).toBe(true);
	});

	it('detects A-B oscillation', () => {
		const a = 'A';
		const b = 'B';
		const osc = [a, b, a, b, a, b, a, b, a, b];
		expect(oscillatingTail(osc, 5)).toBe(true);
		expect(chatLoopDetected(osc, 5)).toBe(true);
	});

	it('does not treat progress as a loop', () => {
		const fps = ['1', '2', '3', '4', '5', '6'];
		expect(chatLoopDetected(fps, 5)).toBe(false);
	});
});

describe('createChatLoopGuard', () => {
	it('latches after threshold identical steps', () => {
		const g = createChatLoopGuard(CHAT_LOOP_THRESHOLD);
		const same = [{ toolName: 'read_media', input: { query: 'logo' } }];
		for (let i = 0; i < CHAT_LOOP_THRESHOLD - 1; i++) {
			g.recordStep(same, '');
			expect(g.reached()).toBe(false);
		}
		g.recordStep(same, '');
		expect(g.reached()).toBe(true);
		expect(g.stalled).toBe(true);
	});
});

describe('isRepeatedReply — la ripetizione ATTRAVERSO i turni (fixture dal thread e61c5136)', () => {
	const rispostaRipetutaInProduzionePerDueGiorniSenzaTool =
		'**Fatto.**  \n\nNuovo trailer **Apple-style**: bianco/nero, viola #c485fe, font Inter, solo movimento pulito.  \n\n**Anomalia Agents — Il tuo team di marketing in un tap** (16:9, 1080×1920, 30 fps, 502 frame).';

	it('la stessa risposta parola per parola è una ripetizione', () => {
		expect(isRepeatedReply(rispostaRipetutaInProduzionePerDueGiorniSenzaTool, rispostaRipetutaInProduzionePerDueGiorniSenzaTool)).toBe(true);
	});

	it('spazi e maiuscole diverse non la mascherano', () => {
		expect(isRepeatedReply(rispostaRipetutaInProduzionePerDueGiorniSenzaTool.replace(/\s+/g, '  ').toUpperCase(), rispostaRipetutaInProduzionePerDueGiorniSenzaTool)).toBe(true);
	});

	it('una coda corta in più sulla riga salvata non la maschera (prefisso ≥90%)', () => {
		expect(isRepeatedReply(rispostaRipetutaInProduzionePerDueGiorniSenzaTool, `${rispostaRipetutaInProduzionePerDueGiorniSenzaTool} Dimmi tu.`)).toBe(true);
	});

	it('risposte corte identiche («Fatto.») sono legittime', () => {
		expect(isRepeatedReply('Fatto.', 'Fatto.')).toBe(false);
	});

	it('una risposta davvero diversa non conta', () => {
		expect(isRepeatedReply(rispostaRipetutaInProduzionePerDueGiorniSenzaTool, 'Ecco la nuova versione: palette scura, kinetic type, 720 frame, musica diversa.')).toBe(false);
	});

	it('senza un messaggio precedente non scatta mai', () => {
		expect(isRepeatedReply(rispostaRipetutaInProduzionePerDueGiorniSenzaTool, null)).toBe(false);
		expect(isRepeatedReply(rispostaRipetutaInProduzionePerDueGiorniSenzaTool, '')).toBe(false);
	});
});

const sorgenteRifiutataDalVincoloImport =
	"import React from 'react';\nimport { AbsoluteFill } from 'remotion';\nimport { Trailer } from './motion-trailer-1x1';";
const erroreImportNonAmmesso =
	'Import not allowed: "./motion-trailer-1x1" — allowed: react, remotion, @remotion/shapes, @remotion/paths, @remotion/transitions';

function passoFallito(toolName: string, input: Record<string, unknown>, error: string) {
	return [{ type: 'tool-result', toolCallId: `c-${Math.random()}`, toolName, input, output: { error } }];
}

describe('failedToolCalls — riconosce un fallimento in entrambe le forme di output', () => {
	it('output classico { error } → fallimento col dettaglio', () => {
		const found = failedToolCalls(
			passoFallito('create_motion_video', { source: sorgenteRifiutataDalVincoloImport }, erroreImportNonAmmesso)
		);
		expect(found).toHaveLength(1);
		expect(found[0].toolName).toBe('create_motion_video');
		expect(found[0].detail).toContain('Import not allowed');
	});

	it('output del kit { content, isError: true } → fallimento col testo del content', () => {
		const found = failedToolCalls([
			{
				type: 'tool-result',
				toolCallId: 'c1',
				toolName: 'brand_write',
				input: { path: '/x' },
				output: { content: [{ type: 'text', text: 'path non scrivibile' }], isError: true }
			}
		]);
		expect(found).toHaveLength(1);
		expect(found[0].detail).toBe('path non scrivibile');
	});

	it('un tool che LANCIA (parte tool-error) è un fallimento', () => {
		const found = failedToolCalls([
			{ type: 'tool-error', toolCallId: 'c1', toolName: 'shell', input: { command: 'x' }, error: new Error('boom') }
		]);
		expect(found).toHaveLength(1);
		expect(found[0].detail).toContain('boom');
	});

	it('un risultato riuscito non è mai un fallimento', () => {
		expect(
			failedToolCalls([
				{ type: 'tool-result', toolCallId: 'c1', toolName: 'read_file', input: {}, output: { content: 'ok' } },
				{ type: 'text', text: 'prosa' }
			])
		).toHaveLength(0);
	});
});

describe('il banco dei tool falliti (fixture dal thread e61c5136: create_motion_video due volte sullo stesso source)', () => {
	it(`dopo ${TOOL_BENCH_FAILURES} fallimenti con gli STESSI argomenti il tool finisce in panchina`, () => {
		const g = createChatLoopGuard();
		g.recordToolFailures(
			passoFallito('create_motion_video', { source: sorgenteRifiutataDalVincoloImport }, erroreImportNonAmmesso)
		);
		expect(g.benchedTools()).toHaveLength(0);
		g.recordToolFailures(
			passoFallito('create_motion_video', { source: sorgenteRifiutataDalVincoloImport }, erroreImportNonAmmesso)
		);
		expect(g.benchedTools().map((b) => b.toolName)).toEqual(['create_motion_video']);
		expect(g.benchedTools()[0].detail).toContain('Import not allowed');
	});

	it('fallimenti con argomenti DIVERSI non mandano in panchina (replace_motion_source con old_str diversi)', () => {
		const g = createChatLoopGuard();
		g.recordToolFailures(passoFallito('replace_motion_source', { old_str: 'const cursorX = 1' }, 'old_str not found in source'));
		g.recordToolFailures(passoFallito('replace_motion_source', { old_str: 'const settle = 2' }, 'old_str not found in source'));
		expect(g.benchedTools()).toHaveLength(0);
	});
});

describe('benchAwarePrepareStep — il tool in panchina sparisce dal tavolo, con una spiegazione una volta sola', () => {
	const toolNames = ['create_motion_video', 'replace_motion_source', 'reply'];
	const messaggi = [{ role: 'user', content: 'fammi il trailer' }];

	function guardConPanchina() {
		const g = createChatLoopGuard();
		for (let i = 0; i < TOOL_BENCH_FAILURES; i++) {
			g.recordToolFailures(
				passoFallito('create_motion_video', { source: sorgenteRifiutataDalVincoloImport }, erroreImportNonAmmesso)
			);
		}
		return g;
	}

	it('senza panchina non tocca niente', async () => {
		const prepare = benchAwarePrepareStep(createChatLoopGuard(), toolNames, 'it');
		expect(await prepare({ messages: messaggi })).toEqual({});
	});

	it('con panchina: activeTools senza il tool, e il perché in coda ai messaggi', async () => {
		const prepare = benchAwarePrepareStep(guardConPanchina(), toolNames, 'it');
		const out = await prepare({ messages: messaggi });
		expect(out.activeTools).toEqual(['replace_motion_source', 'reply']);
		const appended = (out.messages as Array<{ role: string; content: string }>).at(-1)!;
		expect(appended.role).toBe('user');
		expect(appended.content).toContain('create_motion_video');
		expect(appended.content).toContain('Import not allowed');
	});

	it('la spiegazione entra UNA volta, activeTools resta a ogni step', async () => {
		const prepare = benchAwarePrepareStep(guardConPanchina(), toolNames, 'it');
		const primo = await prepare({ messages: messaggi });
		const secondo = await prepare({ messages: primo.messages as typeof messaggi });
		expect(secondo.activeTools).toEqual(['replace_motion_source', 'reply']);
		expect(secondo.messages).toBeUndefined();
	});

	it('compone un prepareStep interno (la mailbox) invece di sostituirlo', async () => {
		const prepare = benchAwarePrepareStep(guardConPanchina(), toolNames, 'it', async ({ messages }) => ({
			messages: [...(messages ?? []), { role: 'user', content: 'follow-up assorbito' }]
		}));
		const out = await prepare({ messages: messaggi });
		const contents = (out.messages as Array<{ content: string }>).map((m) => m.content);
		expect(contents).toContain('follow-up assorbito');
		expect(contents.at(-1)).toContain('create_motion_video');
	});

	it('se la panchina svuoterebbe il tavolo, non restringe', async () => {
		const g = guardConPanchina();
		const prepare = benchAwarePrepareStep(g, ['create_motion_video'], 'it');
		const out = await prepare({ messages: messaggi });
		expect(out.activeTools).toBeUndefined();
	});
});

describe('toolBenchNotice', () => {
	it('nomina il tool e il dettaglio, in entrambe le lingue', () => {
		for (const locale of ['it', 'en'] as const) {
			const notice = toolBenchNotice('create_motion_video', erroreImportNonAmmesso, locale);
			expect(notice).toContain('create_motion_video');
			expect(notice).toContain('Import not allowed');
		}
	});
});
