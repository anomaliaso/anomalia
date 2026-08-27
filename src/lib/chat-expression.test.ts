import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_AVATAR_FACES, DEFAULT_AGENT_AVATAR_FACE } from './agent-avatars';
import {
	CHAT_EXPRESSIONS,
	CHAT_EXPRESSION_NOTES,
	EXPRESSION_HOLD_MS,
	EXPRESSION_REST_MS,
	EXPRESSION_STICKER_SIZE,
	faceAtElapsed,
	isChatExpression,
	normalizeChatExpression,
	readChatExpression,
	agentStickerColor,
	expressionStickers
} from './chat-expression';
import { chipCalls, SILENT_CHIP_TOOLS } from './chat-parts';

describe('le espressioni offerte', () => {
	it('non offre quella neutra: sarebbe un’animazione che non anima', () => {
		expect(CHAT_EXPRESSIONS).not.toContain(DEFAULT_AGENT_AVATAR_FACE);
		expect(CHAT_EXPRESSIONS.length).toBe(AGENT_AVATAR_FACES.length - 1);
	});

	it('ognuna è disegnabile davvero — nessun nome che la UI non conosce', () => {
		for (const f of CHAT_EXPRESSIONS) expect(AGENT_AVATAR_FACES).toContain(f);
	});

	it('ognuna ha una nota che dice quando usarla', () => {
		// Senza, il modello sceglie a caso fra tredici nomi propri.
		for (const f of CHAT_EXPRESSIONS) {
			expect(CHAT_EXPRESSION_NOTES[f]?.length, f).toBeGreaterThan(5);
		}
	});
});

describe('normalizeChatExpression', () => {
	it('accetta quelle vere', () => {
		expect(isChatExpression('wink')).toBe(true);
		expect(normalizeChatExpression('sad')).toBe('sad');
	});

	it('non lascia passare la neutra né un nome inventato', () => {
		// Un nome che la UI non sa disegnare resterebbe salvato per sempre come faccia vuota.
		expect(isChatExpression(DEFAULT_AGENT_AVATAR_FACE)).toBe(false);
		expect(isChatExpression('smirk')).toBe(false);
		expect(normalizeChatExpression('smirk')).toBe('dot');
		expect(normalizeChatExpression(null)).toBe('dot');
	});
});

describe('faceAtElapsed — il ciclo', () => {
	it('parte dal riposo, così il passaggio si vede', () => {
		expect(faceAtElapsed('wink', 0)).toBe(DEFAULT_AGENT_AVATAR_FACE);
	});

	it('tiene l’espressione dopo il riposo, e poi ricomincia', () => {
		expect(faceAtElapsed('wink', EXPRESSION_REST_MS + 10)).toBe('wink');
		const cycle = EXPRESSION_REST_MS + EXPRESSION_HOLD_MS;
		expect(faceAtElapsed('wink', cycle + 10)).toBe(DEFAULT_AGENT_AVATAR_FACE);
		expect(faceAtElapsed('wink', cycle * 4 + EXPRESSION_REST_MS + 10)).toBe('wink');
	});

	it('l’espressione resta più a lungo del riposo: è lei il messaggio', () => {
		// Un loop bilanciato si legge come un lampeggio, cioè come un difetto.
		expect(EXPRESSION_HOLD_MS).toBeGreaterThan(EXPRESSION_REST_MS);
	});

	it('le soste contengono la dissolvenza di AgentAvatar (~260ms) senza tagliarla', () => {
		expect(EXPRESSION_REST_MS).toBeGreaterThan(300);
		expect(EXPRESSION_HOLD_MS).toBeGreaterThan(300);
	});

	it('regge un tempo negativo senza uscire dal ciclo', () => {
		expect(AGENT_AVATAR_FACES).toContain(faceAtElapsed('wink', -50));
	});
});

describe('readChatExpression', () => {
	it('legge l’output vivo del tool', () => {
		expect(readChatExpression({ expression: 'grin', note: 'venuto bene' })).toEqual({
			expression: 'grin',
			note: 'venuto bene',
			color: null
		});
	});

	it('legge anche la riga riletta, che può essere una stringa', () => {
		expect(readChatExpression('{"expression":"sad"}')).toEqual({
			expression: 'sad',
			note: null,
			color: null
		});
	});

	it('non disegna niente quando non riconosce: meglio nessuno sticker che uno sbagliato', () => {
		expect(readChatExpression(null)).toBeNull();
		expect(readChatExpression('non json')).toBeNull();
		expect(readChatExpression({ expression: 'smirk' })).toBeNull();
		// La neutra non è uno sticker: sarebbe un messaggio che non dice niente.
		expect(readChatExpression({ expression: DEFAULT_AGENT_AVATAR_FACE })).toBeNull();
	});

	it('una nota vuota non diventa un tooltip vuoto', () => {
		expect(readChatExpression({ expression: 'wink', note: '   ' })?.note).toBeNull();
	});
});

describe('misura', () => {
	it('è grande abbastanza da leggersi come un gesto, non come un’icona', () => {
		expect(EXPRESSION_STICKER_SIZE).toBeGreaterThanOrEqual(48);
	});
});


/**
 * LO STICKER SU OGNI SURFACE, che è il difetto vero.
 *
 * `ChatColumn` filtrava la chip di `set_expression` e montava lo sticker; la chat a pagina piena —
 * dove il sidebar manda OGNI thread — aveva la sua copia del filtro, senza `set_expression`, e
 * nessuno sticker. L'agente strizzava l'occhio nell'Overview e, riaprendo lo stesso thread dalla
 * barra laterale, diventava una chip maiuscola `SET_EXPRESSION`. Due copie di una regola sola: il
 * difetto non era il rigo mancante, era la duplicazione. Questi test guardano che ne resti una.
 */
describe('lo sticker è lo stesso su ogni surface', () => {
	const reads = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

	it('i tool muti sono un elenco solo, applicato dentro la chip', () => {
		expect(SILENT_CHIP_TOOLS).toContain('set_expression');
		expect(
			chipCalls([
				{ toolName: 'set_expression' },
				{ toolName: 'write_source' },
				{ toolName: 'ask_user_questions' },
				{ toolName: 'propose_custom_agent' }
			]).map((c) => c.toolName)
		).toEqual(['write_source']);
		// Dentro il componente, non nei chiamanti: è l'unico modo perché una surface non se lo scordi.
		expect(reads('./components/ChatToolChips.svelte')).toContain('chipCalls(calls)');
	});

	it('e lo disegna un componente solo, che montano tutte e tre le superfici', () => {
		for (const f of [
			'./components/ChatColumn.svelte',
			'./components/ChatLiveStatus.svelte',
			'../routes/app/[brand]/chat/components/ChatTurn.svelte'
		]) {
			expect(reads(f)).toContain('<ChatExpressionStickers');
			// E nessuna se lo rifiltra a mano: quella era la strada per scollarsi di nuovo.
			expect(reads(f)).not.toContain("toolName !== 'set_expression'");
		}
	});

	it('expressionStickers prende solo le chiamate giuste e salta quelle illeggibili', () => {
		const stickers = expressionStickers([
			{ toolName: 'write_source', toolCallId: 'a', output: { expression: 'wink' } },
			{ toolName: 'set_expression', toolCallId: 'b', output: { expression: 'wink', note: 'ok' } },
			{ toolName: 'set_expression', toolCallId: 'c', output: 'niente' }
		]);
		expect(stickers.map((s) => s.key)).toEqual(['b']);
		expect(stickers[0].expression).toBe('wink');
	});
});

describe('il colore dello sticker', () => {
	it('è quello dell’agente che ha fatto la faccia, non del picker aperto ora', () => {
		expect(readChatExpression({ expression: 'wink', color: '#8b5cf6' })?.color).toBe('#8b5cf6');
		// Uno sticker vecchio non ne ha: si disegna neutro invece di prendersi il colore sbagliato.
		expect(readChatExpression({ expression: 'wink' })?.color).toBeNull();
	});

	it('l’agente custom vince sul built-in, ed esiste sempre un colore', () => {
		expect(agentStickerColor('motion')).toBe('#8b5cf6');
		expect(agentStickerColor('motion', '#ec4899')).toBe('#ec4899');
		expect(agentStickerColor('un-agente-che-non-esiste')).toBeTruthy();
	});
});
