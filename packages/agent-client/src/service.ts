/**
 * IL TRASPORTO — HTTP col contratto di agent-lab/turn/+server.ts, zero Svelte.
 *
 * ponytail: il server risponde con TUTTO il turno a fine giro, quindi `onEvent` si chiama qui in
 * un loop subito prima di restituire. Quando `/turn` passerà a SSE cambia solo il dentro di
 * `sendTurn`: la firma regge, e lo store non cambia una riga.
 */

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = { role: ChatRole; content: string };

export type EventItem =
	| { type: 'tool'; name: string; args: string }
	| { type: 'result'; preview: string; isError: boolean }
	| { type: 'text'; text: string }
	| { type: 'reasoning'; text: string }
	| { type: 'error'; message: string };

export type TurnReply = { message: string; delivered: string[]; source: 'reply' | 'text' } | null;

export type TurnPayload = {
	runId: string;
	state: string;
	reason: string;
	reply: TurnReply;
	question: unknown | null;
	events: EventItem[];
};

export interface SendTurnArgs {
	agentId: string;
	messages: ChatMessage[];
	resumeRunId?: string;
	answer?: string;
	signal?: AbortSignal;
}

type FetchFn = typeof fetch;

export interface AgentService {
	/** `onEvent` è il gancio per lo streaming: vedi la nota in testa al file. */
	sendTurn(args: SendTurnArgs, onEvent?: (e: EventItem) => void): Promise<TurnPayload>;
	/** Annulla il turno in volo, quello lanciato senza un `signal` proprio in `args`. */
	abort(): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null;
}

/** L'errore INSEGNA cosa manca, non solo che qualcosa è rotto. */
function parseTurnPayload(json: unknown, events: EventItem[]): TurnPayload {
	if (!isRecord(json)) {
		throw new Error('agent-lab: la risposta non è un oggetto JSON');
	}
	const { runId, state, reason, reply, question } = json;
	if (typeof runId !== 'string') throw new Error("agent-lab: manca 'runId' (string) nella risposta");
	if (typeof state !== 'string') throw new Error("agent-lab: manca 'state' (string) nella risposta");
	if (typeof reason !== 'string') throw new Error("agent-lab: manca 'reason' (string) nella risposta");
	if (reply !== null && reply !== undefined && !isRecord(reply)) {
		throw new Error("agent-lab: 'reply' deve essere un oggetto o null");
	}
	return {
		runId,
		state,
		reason,
		reply: (reply as TurnReply) ?? null,
		question: question ?? null,
		events
	};
}

function isEventLine(v: unknown): v is EventItem {
	return isRecord(v) && typeof v.type === 'string' && !('runId' in v);
}

async function readNdjson(
	res: Response,
	onEvent: (e: EventItem) => void
): Promise<{ meta: unknown; events: EventItem[] }> {
	const reader = res.body?.getReader();
	if (!reader) throw new Error(`agent-lab: risposta senza corpo (HTTP ${res.status})`);
	const decoder = new TextDecoder();
	let buf = '';
	let meta: unknown = null;
	const events: EventItem[] = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let nl: number;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const raw = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!raw) continue;
			let line: unknown;
			try {
				line = JSON.parse(raw);
			} catch {
				throw new Error('agent-lab: riga NDJSON malformata dal server');
			}
			if (isEventLine(line)) {
				events.push(line);
				onEvent?.(line);
			} else if (isRecord(line)) {
				meta = line;
			}
		}
	}
	return { meta, events };
}

export function createAgentService(opts: { baseUrl: string; fetchFn?: FetchFn }): AgentService {
	const fetchFn = opts.fetchFn ?? fetch;
	let controller: AbortController | null = null;

	async function sendTurn(args: SendTurnArgs, onEvent?: (e: EventItem) => void): Promise<TurnPayload> {
		controller = new AbortController();
		const signal = args.signal ?? controller.signal;

		const body: Record<string, unknown> = { agentId: args.agentId, messages: args.messages };
		if (args.resumeRunId) body.resumeRunId = args.resumeRunId;
		if (args.answer !== undefined) body.answer = args.answer;

		const res = await fetchFn(`${opts.baseUrl}/turn`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal
		});

		if (!res.ok) {
			let message = `HTTP ${res.status}`;
			try {
				const json = await res.json();
				if (isRecord(json) && typeof json.error === 'string') message = json.error;
			} catch {
				/* corpo non-JSON: resta il messaggio HTTP */
			}
			throw new Error(`agent-lab: ${message}`);
		}

		const { meta, events } = await readNdjson(res, (e) => onEvent?.(e));
		return parseTurnPayload(meta, events);
	}

	function abort() {
		controller?.abort();
	}

	return { sendTurn, abort };
}
