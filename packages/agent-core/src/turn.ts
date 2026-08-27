/**
 * L'ORCHESTRATORE di un turno, e l'unico posto che conosce la macchina a stati. Le tre uscite:
 *   - `reply`     → il run è `done`, il messaggio è il payload;
 *   - `ask_user`  → `waiting_input`, il run RESTA VIVO nel db e la ripresa riparte da lì;
 *   - tutto il resto → `done`/`failed` con la reason vera, e nessun messaggio esplicito: tocca
 *     al ripiego onesto (una riga fattuale), mai a un riassunto generato.
 *
 * Niente di specifico di un provider, di una sandbox o di un tool entra qui.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentSpec } from '@anomalia/agent-contracts/contracts';
import { buildSystemPrompt, type ApplyTool } from './executor';
import type {
	AdapterContext,
	RunTokenUsage,
	AgentRuntime,
	RunEvent,
	RunRequest,
	RunStopReason,
	ToolSpec
} from '@anomalia/agent-kit';
import { askUser, createRun, finish, transition, type RunRow } from './run-store';
// Ri-esportata per compatibilità: vive in notice.ts perché il client la importi senza
// trascinare run-store/executor nel bundle browser.
export { honestNotice } from '@anomalia/agent-contracts/notice';

export interface TurnInput {
	spec: AgentSpec;
	brandId: string;
	threadId: string | null;
	userId: string | null;
	locale: 'en' | 'it';
	messages: RunRequest['messages'];
	tools: ToolSpec[];
	extras: { memoryMd: string; fileIndex: string };
	limits: RunRequest['limits'];
	model: RunRequest['model'];
	sessionKey?: string;
}

export interface TurnOutcome {
	run: RunRow;
	reason: RunStopReason;
	/**
	 * Già risolto con la priorità che vale per OGNI superficie: `reply` esplicito > testo del
	 * turno > null. Le superfici la consumano, non la reimplementano. `source` dice quale gradino
	 * ha vinto: serve a chi streama per non ristampare un testo già mostrato.
	 */
	reply: { message: string; delivered: string[]; source: 'reply' | 'text' } | null;
	/** La domanda pendente, se il run è in waiting_input. */
	question: unknown | null;
	/** I token reali del turno (finish.totalUsage), quando il runtime li espone. */
	usage?: RunTokenUsage;
	/** Gli eventi del turno, per chi li persiste o li streama. */
	events: RunEvent[];
}

/** Non streama verso l'utente (lo fa chi consuma `onEvent`): decide gli stati e riporta l'esito. */
export async function runTurn(
	db: SupabaseClient,
	runtime: AgentRuntime,
	applyTool: ApplyTool,
	input: TurnInput,
	onEvent?: (e: RunEvent) => void
): Promise<TurnOutcome> {
	const run = await createRun(db, {
		brandId: input.brandId,
		threadId: input.threadId,
		agentId: input.spec.id,
		userId: input.userId
	});
	await transition(db, run.id, 'queued', 'running');

	const ctx: AdapterContext = {
		brandId: input.brandId,
		userId: input.userId,
		runId: run.id,
		sessionKey: input.sessionKey,
		locale: input.locale
	};

	const request: RunRequest = {
		runId: run.id,
		system: buildSystemPrompt(input.spec, input.extras),
		messages: input.messages,
		tools: input.tools,
		model: input.model,
		limits: input.limits
	};

	const events: RunEvent[] = [];
	let reply: TurnOutcome['reply'] = null;
	let question: unknown | null = null;
	let reason: RunStopReason = 'completed';
	let usage: RunTokenUsage | undefined;

	try {
		for await (const event of runtime.run(request, ctx)) {
			events.push(event);
			onEvent?.(event);
			if (event.type === 'tool_call') {
				// reply e ask_user sono TERMINALI: l'effetto lo decide questo file, non l'executor.
				if (event.call.name === 'reply') {
					reply = {
						message: String(event.call.args.message ?? ''),
						delivered: Array.isArray(event.call.args.delivered)
							? event.call.args.delivered.map(String)
							: [],
						source: 'reply'
					};
					reason = 'reply';
				} else if (event.call.name === 'ask_user') {
					question = event.call.args;
					reason = 'waiting_input';
				}
			}
			if (event.type === 'done' && reason !== 'reply' && reason !== 'waiting_input') {
				reason = event.reason;
				usage = event.usage ?? usage;
			}
		}
	} catch (err) {
		await finish(db, run.id, 'aborted').catch(() => {});
		throw err;
	}

	// Un modello che risponde in prosa e si ferma senza chiamare `reply` ha comunque parlato:
	// quel testo È il messaggio, deciso qui una volta per ogni superficie.
	if (!reply && reason === 'completed') {
		const text = events
			.filter((e): e is Extract<RunEvent, { type: 'text' }> => e.type === 'text')
			.map((e) => e.text)
			.join('')
			.trim();
		if (text) reply = { message: text, delivered: [], source: 'text' };
	}

	if (reason === 'waiting_input') {
		const updated = await askUser(db, run.id, question);
		return { run: updated, reason, reply: null, question, events };
	}

	const updated = await finish(db, run.id, reason === 'reply' ? 'reply' : reason);
	return { run: updated, reason, reply, question: null, usage, events };
}
