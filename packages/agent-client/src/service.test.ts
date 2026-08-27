import { describe, expect, it, vi } from 'vitest';
import { createAgentService } from './service';

/** Un `fetch` finto: risponde con NDJSON, riga per riga come agent-lab/turn/+server.ts. */
function ndjsonBody(lines: unknown[]) {
	const enc = new TextEncoder();
	return new ReadableStream({
		start(c) {
			for (const l of lines) c.enqueue(enc.encode(JSON.stringify(l) + '\n'));
			c.close();
		}
	});
}

function fakeFetch(status: number, body: unknown) {
	return vi.fn(async () => ({
		ok: status >= 200 && status < 300,
		status,
		body: status === 200 ? ndjsonBody(body as unknown[]) : null,
		json: async () => body
	})) as unknown as typeof fetch;
}

const meta = (over: Record<string, unknown>) => ({
	runId: 'run-1', state: 'done', reason: 'reply', reply: null, question: null, ...over
});

describe('createAgentService — il trasporto verso agent-lab/turn/+server.ts', () => {
	it('payload valido: POSTa il body giusto e restituisce TurnPayload tipizzato', async () => {
		const metaLine = meta({
			reply: { message: 'ciao', delivered: [], source: 'reply' }
		});
		const fetchFn = fakeFetch(200, [{ type: 'text', text: 'ciao' }, metaLine]);
		const service = createAgentService({ baseUrl: '/app/acme/agent-lab', fetchFn });

		const out = await service.sendTurn({ agentId: 'seo', messages: [{ role: 'user', content: 'hey' }] });

		expect(out).toEqual({ ...metaLine, events: [{ type: 'text', text: 'ciao' }] });
		expect(fetchFn).toHaveBeenCalledWith(
			'/app/acme/agent-lab/turn',
			expect.objectContaining({ method: 'POST' })
		);
		const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
		const sentBody = JSON.parse((call[1] as RequestInit).body as string);
		expect(sentBody).toEqual({ agentId: 'seo', messages: [{ role: 'user', content: 'hey' }] });
	});

	it('resumeRunId + answer finiscono nel body solo se presenti', async () => {
		const fetchFn = fakeFetch(200, [meta({ runId: 'run-2' })]);
		const service = createAgentService({ baseUrl: '/app/acme/agent-lab', fetchFn });

		await service.sendTurn({ agentId: 'seo', messages: [], resumeRunId: 'run-1', answer: '42' });

		const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
		const sentBody = JSON.parse((call[1] as RequestInit).body as string);
		expect(sentBody).toEqual({ agentId: 'seo', messages: [], resumeRunId: 'run-1', answer: '42' });
	});

	it('onEvent riceve ogni evento del turno, in ordine, man mano che arrivano', async () => {
		const events = [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }];
		const service = createAgentService({
			baseUrl: '/x',
			fetchFn: fakeFetch(200, [...events, meta({ runId: 'run-3' })])
		});
		const seen: unknown[] = [];

		await service.sendTurn({ agentId: 'a', messages: [] }, (e) => seen.push(e));

		expect(seen).toEqual(events);
	});

	it('riga senza type né runId → errore che insegna cosa manca', async () => {
		const fetchFn = fakeFetch(200, [{ type: 'text', text: 'x' }, { state: 'done' }]);
		const service = createAgentService({ baseUrl: '/x', fetchFn });

		await expect(service.sendTurn({ agentId: 'a', messages: [] })).rejects.toThrow(/runId/);
	});

	it('meta senza reason → errore che insegna cosa manca', async () => {
		const fetchFn = fakeFetch(200, [meta({ reason: undefined as unknown as string })].map(({ reason: _r, ...rest }) => rest));
		const service = createAgentService({ baseUrl: '/x', fetchFn });

		await expect(service.sendTurn({ agentId: 'a', messages: [] })).rejects.toThrow(/reason/);
	});

	it('HTTP non-ok con {error} nel body → il messaggio del server arriva nell\'errore', async () => {
		const fetchFn = fakeFetch(400, { error: "agente sconosciuto: 'boh'" });
		const service = createAgentService({ baseUrl: '/x', fetchFn });

		await expect(service.sendTurn({ agentId: 'boh', messages: [] })).rejects.toThrow(/agente sconosciuto/);
	});

	it('abort() annulla il turno in volo passando un signal già segnalato', async () => {
		let capturedSignal: AbortSignal | undefined;
		const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
			capturedSignal = init.signal as AbortSignal;
			return new Promise(() => {}); // non risolve mai: simula il turno "in volo"
		}) as unknown as typeof fetch;
		const service = createAgentService({ baseUrl: '/x', fetchFn });

		const pending = service.sendTurn({ agentId: 'a', messages: [] });
		service.abort();

		expect(capturedSignal?.aborted).toBe(true);
		void pending.catch(() => {}); // non ci interessa che si risolva, solo che il signal sia abortito
	});
});
