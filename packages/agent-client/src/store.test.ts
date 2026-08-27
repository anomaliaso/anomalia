import { describe, expect, it, vi } from 'vitest';
import { createChatStore } from './store.svelte';
import type { AgentService, TurnPayload } from './service';

/** Un AgentService finto: risponde con la sequenza di TurnPayload data, una per chiamata. */
function scriptedService(payloads: TurnPayload[]): AgentService & { calls: Parameters<AgentService['sendTurn']>[0][] } {
	const calls: Parameters<AgentService['sendTurn']>[0][] = [];
	let i = 0;
	return {
		calls,
		sendTurn: vi.fn(async (args) => {
			calls.push(args);
			const out = payloads[i++];
			if (!out) throw new Error('scriptedService: nessun payload pronto per questa chiamata');
			return out;
		}),
		abort: vi.fn()
	};
}

function replyPayload(runId: string, message: string): TurnPayload {
	return { runId, state: 'done', reason: 'reply', reply: { message, delivered: [], source: 'reply' }, question: null, events: [] };
}

describe('createChatStore', () => {
	it('send felice: appende user + assistant, status torna idle, lastRun aggiornato', async () => {
		const service = scriptedService([replyPayload('run-1', 'ciao!')]);
		const store = createChatStore(service);

		await store.send('seo', 'ehi');

		expect(store.messages).toEqual([
			{ role: 'user', content: 'ehi' },
			{ role: 'assistant', content: 'ciao!', events: [] }
		]);
		expect(store.status).toBe('idle');
		expect(store.lastRun).toEqual({ id: 'run-1', reason: 'reply' });
		expect(store.error).toBeNull();
	});

	it('reply null (step_limit) → honestNotice, non un placeholder inventato qui', async () => {
		const payload: TurnPayload = {
			runId: 'run-2',
			state: 'failed',
			reason: 'step_limit',
			reply: null,
			question: null,
			events: []
		};
		const service = scriptedService([payload]);
		const store = createChatStore(service, 'it');

		await store.send('seo', 'fai tutto');

		const last = store.messages.at(-1);
		expect(last?.role).toBe('assistant');
		expect(last?.content).toBe('Turno fermato al limite di passi, senza messaggio.');
	});

	it('question → status waiting_input, e answer() fa resume con lastRun.id e lo stesso agentId', async () => {
		const askPayload: TurnPayload = {
			runId: 'run-3',
			state: 'waiting_input',
			reason: 'waiting_input',
			reply: null,
			question: { question: 'quale palette?' },
			events: []
		};
		const service = scriptedService([askPayload, replyPayload('run-3', 'fatto con il blu')]);
		const store = createChatStore(service);

		await store.send('brand-designer', 'scegli tu');
		expect(store.status).toBe('waiting_input');
		expect(store.pendingQuestion).toEqual({ question: 'quale palette?' });
		// reply è null anche in waiting_input: il messaggio mostrato è honestNotice, non un vuoto.
		expect(store.messages.at(-1)?.content).toBe('In attesa di una tua risposta.');

		await store.answer('blu');
		expect(service.calls[1]).toEqual({
			agentId: 'brand-designer',
			messages: [
				{ role: 'user', content: 'scegli tu' },
				{ role: 'assistant', content: 'In attesa di una tua risposta.' }
			],
			resumeRunId: 'run-3',
			answer: 'blu'
		});
		expect(store.status).toBe('idle');
		expect(store.lastRun).toEqual({ id: 'run-3', reason: 'reply' });
	});

	it('errore di rete → status error con il messaggio, e i messaggi restano quelli mandati finora', async () => {
		const service: AgentService = {
			sendTurn: vi.fn(async () => {
				throw new Error('agent-lab: HTTP 500');
			}),
			abort: vi.fn()
		};
		const store = createChatStore(service);

		await store.send('seo', 'ciao');

		expect(store.status).toBe('error');
		expect(store.error).toBe('agent-lab: HTTP 500');
		expect(store.messages).toEqual([{ role: 'user', content: 'ciao' }]);
	});

	it('reset() svuota tutto, incluso l\'agente ricordato per answer()', async () => {
		const service = scriptedService([replyPayload('run-4', 'ok')]);
		const store = createChatStore(service);
		await store.send('seo', 'ehi');

		store.reset();

		expect(store.messages).toEqual([]);
		expect(store.status).toBe('idle');
		expect(store.pendingQuestion).toBeNull();
		expect(store.lastRun).toBeNull();
		expect(store.error).toBeNull();
	});

	it('abort() inoltra al service', () => {
		const service = scriptedService([]);
		const store = createChatStore(service);
		store.abort();
		expect(service.abort).toHaveBeenCalledOnce();
	});
});
