import { describe, expect, it } from 'vitest';
import {
	designerContinuePrompt,
	designerTurnNeedsContinuation,
	mergeDesignerPartials,
	offsetDesignerTools
} from './designer-jobs';
import type { StreamToolCallState } from '$lib/chat-stream-events';

describe('offsetDesignerTools', () => {
	it('shifts textLen so a continuation job slots after the parent transcript', () => {
		const tools: StreamToolCallState[] = [
			{ toolCallId: 'a', toolName: 'replace_source', status: 'done', textLen: 4 }
		];
		expect(offsetDesignerTools(tools, 10)[0].textLen).toBe(14);
	});
});

describe('mergeDesignerPartials', () => {
	it('concatenates text and offsets later tools', () => {
		const merged = mergeDesignerPartials([
			{
				text: 'Patching headline.\n',
				tools: [
					{ toolCallId: 't1', toolName: 'replace_source', status: 'done', textLen: 18 }
				],
				reasoning: '',
				at: 1
			},
			{
				text: 'CTA next.\n',
				tools: [{ toolCallId: 't2', toolName: 'replace_source', status: 'done', textLen: 10 }],
				reasoning: '',
				at: 2
			}
		]);
		expect(merged.text).toBe('Patching headline.\nCTA next.\n');
		expect(merged.tools[0].textLen).toBe(18);
		expect(merged.tools[1].textLen).toBe('Patching headline.\n'.length + 10);
		expect(merged.tools.map((t) => t.toolCallId)).toEqual(['t1', 't2']);
	});
});

describe('designerContinuePrompt', () => {
	it('tells motion not to rewrite the whole file and to call finish', () => {
		expect(designerContinuePrompt('en', 'motion', 2)).toMatch(/SMALL replace_source/);
		expect(designerContinuePrompt('en', 'motion', 2)).toMatch(/finish/);
		expect(designerContinuePrompt('en', 'motion', 2)).toMatch(/turn 3/);
		expect(designerContinuePrompt('it', 'ugc')).toMatch(/clip/);
	});
});

describe('designerTurnNeedsContinuation', () => {
	it('forces reached() so a hung tool that skipped stopWhen still continues', () => {
		let expired = false;
		const deadline = {
			reached: () => {
				expired = true;
				return true;
			},
			get expired() {
				return expired;
			}
		};
		expect(designerTurnNeedsContinuation(deadline)).toBe(true);
		expect(designerTurnNeedsContinuation(null)).toBe(false);
	});
});

/**
 * L'AVANZAMENTO DI UN TOOL LUNGO DEVE ARRIVARE ALLA RIGA — 26/8.
 *
 * `attachDesignerStreamMirror` scriveva `chat_jobs.partial` solo dentro il ciclo di lettura dello
 * stream, e il battito riscriveva `live` — l'ULTIMO snapshot riuscito. Durante un render motion
 * (dieci minuti, nessun chunk) la riga restava fresca di data e vecchia di contenuto: la chiamata
 * in corso non compariva mai, e chi apriva «1 background job» vedeva un lavoro fermo.
 */
describe('attachDesignerStreamMirror — il battito scrive lo stato di ADESSO', () => {
	it('il battito non riscrive lo snapshot vecchio, ma rilegge lo stato', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync(new URL('./designer-jobs.ts', import.meta.url), 'utf8');
		const beat = src.slice(src.indexOf('const heartbeat = setInterval'), src.indexOf('const stopHeartbeat'));
		// `{ ...live }` era il difetto: teneva viva la riga con un contenuto che non cambiava piu`.
		expect(beat).not.toMatch(/\.\.\.live/);
		expect(beat).toMatch(/flush\(\)/);
	});

	it('un evento di tool call forza la scrittura invece di aspettare la finestra', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync(new URL('./designer-jobs.ts', import.meta.url), 'utf8');
		expect(src).toContain('tool-input-available');
		expect(src).toContain('tool-output-available');
	});
});
