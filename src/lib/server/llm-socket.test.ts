import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { LLM_REASONING_EFFORT, llmDispatcher, llmReasoningOptions, makeLlmFetch } from './llm';

// Un modello che "pensa" non manda byte: headers 200 subito, corpo dopo un silenzio lungo.
// È il comportamento che ammazzava il planner — undici chiude il socket e l'AI SDK riporta
// "Failed to process successful response / terminated / ETIMEDOUT", che sembra un guasto del
// modello e invece è il nostro client che non ha aspettato.
function stallingServer(silenceMs: number): Promise<{ url: string; close: () => void }> {
	return new Promise((resolve) => {
		const server: Server = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.flushHeaders();
			setTimeout(() => res.end('{"ok":true}'), silenceMs);
		});
		server.listen(0, '127.0.0.1', () => {
			const port = (server.address() as { port: number }).port;
			resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
		});
	});
}

// I timer di undici hanno il tick a un secondo: sotto, la scadenza non è affidabile.
const SILENCE_MS = 2_500;
const PATIENT_MS = 30_000;
const HASTY_MS = 1_000;

describe('il fetch del client LLM', () => {
	it('aspetta il corpo per tutto il tempo che gli è stato dato', async () => {
		const server = await stallingServer(SILENCE_MS);
		try {
			const res = await makeLlmFetch(PATIENT_MS)(server.url, {});
			await expect(res.json()).resolves.toEqual({ ok: true });
		} finally {
			server.close();
		}
	});

	it('molla quando il silenzio supera il tempo dato', async () => {
		const server = await stallingServer(SILENCE_MS);
		try {
			const res = await makeLlmFetch(HASTY_MS)(server.url, {});
			await expect(res.json()).rejects.toThrow();
		} finally {
			server.close();
		}
	});
});

describe('il dispatcher', () => {
	it('è lo stesso per la stessa attesa: un pool per timeout, non uno per chiamata', () => {
		expect(llmDispatcher(1_000)).toBe(llmDispatcher(1_000));
		expect(llmDispatcher(1_000)).not.toBe(llmDispatcher(2_000));
	});
});

describe('lo sforzo di ragionamento', () => {
	it('è dichiarato, perché il campo assente fa ragionare a vuoto', () => {
		expect(llmReasoningOptions()).toEqual({ reasoning: { effort: LLM_REASONING_EFFORT } });
	});

	it('parte basso: misurato, alto costa quindici minuti per un verdetto', () => {
		expect(LLM_REASONING_EFFORT).toBe('low');
	});
});
