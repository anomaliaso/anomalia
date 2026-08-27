import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyChatStreamEvent, emptyStreamState, readSseEvents } from '$lib/chat-stream-events';
import { judgeTranscript, type TranscriptEvent } from '$lib/server/eval/transcript-judge';

/**
 * COME `ai-runtime.test.ts` E `run-store.test.ts`: il turno arriva scripted sull'harness finto
 * (`startHarnessTurn` mockato) e il db è una tabella in memoria che applica DAVVERO i filtri —
 * lo stesso identico codice di produzione (`live.ts`) gira sopra, non una risposta
 * preconfezionata che nasconderebbe una transizione sbagliata.
 */
const modelHolder: { current: unknown } = { current: null };
vi.mock('$lib/server/chat/model', () => ({
	// Il bridge risolve via resolveChatModel('auto', …, {agentId}): qui torna il mock del turno.
	resolveChatModel: () => ({ model: modelHolder.current }),
	// La riga di spesa del turno (`logTurnCost`) legge i crediti kie dal modello risolto: senza
	// questo il mock non esporta la funzione e ogni turno muore prima di salvare il messaggio.
	takeKieUsage: () => ({})
}));

// Doppio resume (caso 2): il resto di `../run-store` resta VERO (createRun/transition/askUser/
// finish girano sopra il fakeDb come sempre) — solo `resume` diventa deviabile per un turno, per
// pinnare la mappatura dell'errore del CAS senza dover ricostruire una vera race a due richieste.
const resumeThrows: { current: boolean } = { current: false };
vi.mock('../run-store', async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import('../run-store');
	return {
		...actual,
		resume: async (...args: Parameters<typeof actual.resume>) => {
			if (resumeThrows.current) throw new Error('run: stato cambiato sotto le mani (atteso waiting_input)');
			return actual.resume(...args);
		}
	};
});

// `logAiCall` scrive davvero in `ai_calls` (via createAdminClient): mai nei test unitari.
// Stesso mock di brand-fs.test.ts / agent-files.test.ts.
vi.mock('$lib/server/ai-log', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, logAiCall: () => {} };
});

// `saveMessages` scrive davvero in `chat_messages`: qui si cattura la chiamata invece di aprire
// una connessione. `assistantContentFromSteps` resta VERA — è pura, ed è il pezzo che decide la
// forma del contenuto salvato.
const savedMessages: Array<{ threadId: string; content: unknown[]; attachments?: string[] }> = [];
vi.mock('$lib/server/chat/persistence', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		saveMessages: async (
			_supabase: unknown,
			_brandId: string,
			_userId: string,
			messages: Array<{ content: unknown }>,
			threadId: string,
			opts?: { attachments?: string[] }
		) => {
			savedMessages.push({ threadId, content: messages[0].content as unknown[], attachments: opts?.attachments });
			return ['saved-msg-1'];
		}
	};
});

// Il kick del drain: qui si cattura l'origin invece di fare una fetch vera. È il segnale che il
// follow-up accodato riparte SUBITO a fine run kit, invece di aspettare il giro del cron.
const queueKicks: string[] = [];
/**
 * La RIPRESA AUTOMATICA passa dallo stesso `enqueueTurnContinuation` del motore classico: qui si
 * cattura la chiamata (tetto e guardia del messaggio-utente-in-attesa restano testati là, sul
 * pezzo condiviso — quello che va provato QUI è che il kit ci arrivi, e con che profondità).
 */
const continuations: Array<Record<string, unknown>> = [];
const continuationReturns: { current: string | null } = { current: 'cont-job-1' };
vi.mock('$lib/server/chat/queue', () => ({
	kickChatQueueWork: async (origin: string) => void queueKicks.push(origin),
	enqueueTurnContinuation: async (_db: unknown, opts: Record<string, unknown>) => {
		continuations.push(opts);
		return continuationReturns.current;
	}
}));

/**
 * L'OBIETTIVO DEL THREAD, dal punto di vista del bridge. La macchina vera (`settleGoalForTurn`,
 * riaperture, giri, resa) ha già i suoi test sul pezzo condiviso: quello che va provato QUI è che
 * il kit ci arrivi — briefing nel prompt, fatti giusti a fine turno, ripresa coi criteri aperti.
 * `goalBriefing` resta VERO: è puro, ed è il testo che finisce davanti al modello.
 */
type Settlement = {
	goal: unknown;
	decision: { continue: boolean; reason: string; handBack: boolean };
	closedNow: unknown[];
	notice: string | null;
	continuationPrompt: string | null;
};
const goalState: {
	open: Record<string, unknown> | null;
	settleCalls: Array<Record<string, unknown>>;
	settlement: Settlement;
} = {
	open: null,
	settleCalls: [],
	settlement: { goal: null, decision: { continue: false, reason: 'no_goal', handBack: false }, closedNow: [], notice: null, continuationPrompt: null }
};
vi.mock('$lib/server/chat/goal', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		loadOpenGoal: async () => goalState.open,
		settleGoalForTurn: async (_db: unknown, opts: Record<string, unknown>) => {
			goalState.settleCalls.push(opts);
			return goalState.settlement;
		},
		trackGoalSettlement: () => {}
	};
});

// La strumentazione del computer (agent_computers) qui non deve scrivere: chi la marca running e`
// `agent-desktop.ts` quando l'utente apre il desktop, e i casi veri stanno in computer.test.ts e
// agent-desktop.test.ts. Il turno la tocca soltanto dai tool della VM (shell/observe/act).
vi.mock('@anomalia/agent-core/computer', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, markComputerRunning: async () => {}, touchComputer: async () => {} };
});

type FakeCall = { toolCallId: string; toolName: string; input: Record<string, unknown> };

/**
 * Un turno scripted per l'harness finto: i testi diventano `text-delta`, le chiamate
 * `tool-call` — e quelle NON terminali vengono ESEGuite davvero passando dal ToolSet che
 * `live.ts` ha costruito (stesso percorso di produzione: battito, succeededTools, loop guard).
 */
type FakeTurn = {
	texts?: string[];
	calls?: FakeCall[];
	totalUsage?: Record<string, unknown>;
	onStreamStart?: () => void;
	capture?: (opts: { system: string; messages: unknown; tools: Record<string, unknown>; stopWhen: unknown[] }) => void;
};

const harnessQueue: FakeTurn[] = [];
const harnessTurnOpts: Array<Record<string, unknown>> = [];
let harnessServed = 0;

/**
 * La cache di produzione (`moduleLiveSessions` in adapters.ts): il SECONDO turno sul thread
 * riceve lo stesso agente del primo, quindi i tool sono quelli cotti al primo giro. Il mock la
 * replica — senza, i bug della sessione riusata sarebbero invisibili qui.
 */
const bakedToolsBySession = new Map<string, Record<string, { execute?: (input: unknown, options: unknown) => Promise<unknown> }>>();

const FAKE_TOTAL_USAGE = {
	inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 20, text: 20, reasoning: 0 }
};

function sseBody(chunks: Array<Record<string, unknown>>): string {
	return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: {"type":"finish","finishReason":"stop"}\n\n';
}

function teeText(payload: string): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] {
	const src = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(payload));
			controller.close();
		}
	});
	return src.tee();
}

function buildFakeHarnessResult(turn: FakeTurn, opts: { tools: Record<string, { execute?: (input: unknown, options: unknown) => Promise<unknown> }> }) {
	const stepParts: Array<Record<string, unknown>> = [];
	const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
	const stepToolResults: Array<{ toolCallId: string; toolName: string; input: unknown; output: unknown }> = [];
	const uiChunks: Array<Record<string, unknown>> = [];
	let text = '';

	const run = async (): Promise<void> => {
		turn.onStreamStart?.();
		for (const delta of turn.texts ?? []) {
			text += delta;
			uiChunks.push({ type: 'text-delta', id: 't1', delta });
			stepParts.push({ type: 'text', text: delta });
		}
		for (const call of turn.calls ?? []) {
			uiChunks.push({ type: 'tool-input-available', toolCallId: call.toolCallId, toolName: call.toolName, input: call.input });
			stepParts.push({ type: 'tool-call', toolCallId: call.toolCallId, toolName: call.toolName, input: call.input });
			stepToolCalls.push(call);
		}
		await new Promise((r) => setTimeout(r, 8));
		for (const call of turn.calls ?? []) {
			const t = opts.tools?.[call.toolName];
			if (t && typeof t.execute === 'function') {
				let output: unknown;
				try {
					output = await t.execute(call.input, { toolCallId: call.toolCallId, messages: [] });
				} catch (e) {
					output = { isError: true, content: [{ type: 'text', text: String(e) }] };
				}
				stepToolResults.push({ ...call, output });
				uiChunks.push({ type: 'tool-output-available', toolCallId: call.toolCallId, output });
				stepParts.push({ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, input: call.input, output });
			}
		}
	};

	const drained = run();
	const usage = turn.totalUsage ?? FAKE_TOTAL_USAGE;

	async function* fullStream() {
		await drained;
		yield { type: 'finish-step' };
		yield { type: 'finish', totalUsage: usage };
	}

	// Il corpo si compone DOPO `drained`, non prima: i chunk di output dei tool nascono dietro un
	// await, e uno snapshot preso alla chiamata conterrebbe solo `tool-input-available` — cioè uno
	// stream in cui nessun tool ha mai risposto.
	function delayedStream(payload: () => string, extraMs = 0): ReadableStream<Uint8Array> {
		return new ReadableStream<Uint8Array>({
			async start(controller) {
				await drained;
				if (extraMs > 0) await new Promise((r) => setTimeout(r, extraMs));
				controller.enqueue(new TextEncoder().encode(payload()));
				controller.close();
			}
		});
	}

	const result = {
		fullStream: fullStream(),
		consumeStream: async ({ onError }: { onError?: (e: unknown) => void } = {}) => {
			try {
				await drained;
			} catch (e) {
				onError?.(e);
			}
		},
		steps: drained.then(() => [{ content: stepParts, toolCalls: stepToolCalls, toolResults: stepToolResults, text, reasoningText: '' }]),
		text: drained.then(() => text),
		totalUsage: Promise.resolve(usage),
		toUIMessageStreamResponse: (
			responseOpts?: { consumeSseStream?: ({ stream }: { stream: ReadableStream<Uint8Array> }) => Promise<void> | void }
		) => {
			const [client, mirror] = (() => {
				const source = delayedStream(() => sseBody(uiChunks), 10);
				return source.tee();
			})();
			void responseOpts?.consumeSseStream?.({ stream: mirror });
			return new Response(client, { headers: { 'content-type': 'text/event-stream' } });
		}
	};
	return result;
}

vi.mock('./adapters', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		resolveHarnessModelRef: () => ({ provider: 'kie', id: 'kie/test-luna', label: 'test-luna' }),
		openBrandHarnessSession: async () => ({ session: { fake: true }, name: 'brand-vm' }),
		startHarnessTurn: async (opts: {
			system: string;
			messages: unknown;
			tools: Record<string, { execute?: (input: unknown, options: unknown) => Promise<unknown> }>;
			stopWhen: unknown[];
			sessionKey?: string;
		}) => {
			const idx = Math.min(harnessServed, harnessQueue.length - 1);
			harnessServed += 1;
			const turn = harnessQueue[idx];
			if (!turn) throw new Error('nessun turno scripted per la startHarnessTurn finta');
			let tools = opts.tools;
			if (opts.sessionKey) {
				const baked = bakedToolsBySession.get(opts.sessionKey);
				if (baked) tools = baked;
				else bakedToolsBySession.set(opts.sessionKey, opts.tools);
			}
			harnessTurnOpts.push(opts);
			turn.capture?.({ system: opts.system, messages: opts.messages, tools, stopWhen: opts.stopWhen });
			return { result: buildFakeHarnessResult(turn, { ...opts, tools }), destroy: async () => {} };
		}
	};
});

function scriptTurns(...turns: FakeTurn[]) {
	harnessQueue.push(...turns);
}

const replyCall = (message: string): FakeCall => ({ toolCallId: 'c1', toolName: 'reply', input: { message, delivered: [] } });

const { runKitTurn, shouldUseKit } = await import('./live');
const { specById } = await import('../specs');

type Row = Record<string, unknown>;

/**
 * Lo stesso finto client di `run-store.test.ts`, esteso con `order`/`maybeSingle` — il bridge li
 * usa per trovare un run `waiting_input` sul thread prima di aprirne uno nuovo.
 */
function fakeDb(seed: Row[] = []) {
	const rows: Row[] = seed.map((r) => ({ ...r }));
	let seq = rows.length;

	function from(_table: string) {
		let op: 'select' | 'insert' | 'update' = 'select';
		let payload: Row | undefined;
		const eqFilters: Array<[string, unknown]> = [];
		let limitN: number | undefined;
		let orderCol: string | undefined;
		let orderAscending = true;

		function matchedRows(): Row[] {
			let matched = rows;
			for (const [col, val] of eqFilters) matched = matched.filter((r) => r[col] === val);
			if (orderCol) {
				const col = orderCol;
				matched = [...matched].sort((a, b) => {
					const av = String(a[col] ?? '');
					const bv = String(b[col] ?? '');
					return orderAscending ? av.localeCompare(bv) : bv.localeCompare(av);
				});
			}
			if (limitN !== undefined) matched = matched.slice(0, limitN);
			return matched;
		}

		const b: Record<string, unknown> = {
			insert(p: Row) {
				op = 'insert';
				payload = p;
				return b;
			},
			update(p: Row) {
				op = 'update';
				payload = p;
				return b;
			},
			// Mancava, e la mancanza non era muta: il ramo che cancella il checkpoint a turno
			// chiuso alzava «admin.from(...).delete is not a function» dentro handleFinish. Un
			// fake che non sa fare una cosa non la lascia non verificata — la fa fallire altrove.
			delete() {
				op = 'delete';
				return b;
			},
			select(..._args: unknown[]) {
				return b;
			},
			eq(col: string, val: unknown) {
				eqFilters.push([col, val]);
				return b;
			},
			order(col: string, opts?: { ascending?: boolean }) {
				orderCol = col;
				orderAscending = opts?.ascending ?? true;
				return b;
			},
			limit(n: number) {
				limitN = n;
				return b;
			},
			// `insert()` deposita una riga: chi la legge con `single` o con `maybeSingle` deve
			// vedere QUELLA. Prima solo `single` la depositava, e `maybeSingle` dopo un insert
			// tornava la prima riga della tabella — cioè un id di un'altra riga, spacciato per
			// quello appena creato.
			insertedRow() {
				if (op !== 'insert' || !payload) return null;
				const row: Row = {
					id: `run-${++seq}`,
					state: 'queued',
					reason: null,
					question: null,
					created_at: new Date(2026, 7, 21, 0, 0, seq).toISOString(),
					updated_at: new Date(2026, 7, 21, 0, 0, seq).toISOString(),
					...payload
				};
				rows.push(row);
				return row;
			},
			single() {
				const fresh = (b.insertedRow as () => Row | null)();
				if (fresh) return Promise.resolve({ data: { ...fresh }, error: null });
				const matched = matchedRows();
				if (matched.length !== 1) {
					return Promise.resolve({ data: null, error: { message: 'not exactly one row' } });
				}
				return Promise.resolve({ data: { ...matched[0] }, error: null });
			},
			maybeSingle() {
				const fresh = (b.insertedRow as () => Row | null)();
				if (fresh) return Promise.resolve({ data: { ...fresh }, error: null });
				const matched = matchedRows();
				return Promise.resolve({ data: matched[0] ? { ...matched[0] } : null, error: null });
			},
			then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
				if (op === 'update' && payload) {
					const matched = matchedRows();
					for (const row of matched) Object.assign(row, payload);
					return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(resolve, reject);
				}
				if (op === 'delete') {
					const matched = matchedRows();
					for (const row of matched) rows.splice(rows.indexOf(row), 1);
					return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(resolve, reject);
				}
				return Promise.resolve({ data: matchedRows().map((r) => ({ ...r })), error: null }).then(resolve, reject);
			}
		};
		return b;
	}

	// L'emulazione di `agent_kit_close_run` (migration 0222): CAS su state='running', inserimento
	// del messaggio e stato finale nella STESSA chiamata — la stessa semantica della funzione SQL.
	const chatMessages: Row[] = [];
	function rpc(fn: string, params: Record<string, unknown>) {
		if (fn !== 'agent_kit_close_run') {
			return Promise.resolve({ data: null, error: { message: `rpc sconosciuta: ${fn}` } });
		}
		const run = rows.find((r) => r.id === params.p_run_id && r.state === 'running');
		if (!run) return Promise.resolve({ data: { closed: false }, error: null });
		run.state = params.p_to_state;
		if (params.p_reason != null) run.reason = params.p_reason;
		if (params.p_question != null) run.question = params.p_question;
		run.updated_at = new Date().toISOString();
		let msgId: string | null = null;
		const m = params.p_message as Record<string, unknown> | null;
		if (m) {
			msgId = `msg-${chatMessages.length + 1}`;
			chatMessages.push({ id: msgId, thread_id: run.thread_id, role: 'assistant', ...m });
			run.partial_saved_msg_id = msgId;
			savedMessages.push({
				threadId: run.thread_id as string,
				content: (m.tool_calls as unknown[]) ?? [{ type: 'text', text: m.content }],
				attachments: (m.attachments as string[] | null) ?? undefined
			});
		}
		return Promise.resolve({ data: { closed: true, message_id: msgId }, error: null });
	}

	return { db: { from, rpc } as unknown as SupabaseClient, rows, chatMessages };
}

/** Un turno che chiama UN tool (e unico) e basta. */
function toolCallModel(toolName: string, input: Record<string, unknown>) {
	scriptTurns({ calls: [{ toolCallId: 'c1', toolName, input }] });
}

/**
 * Un turno che scrive del testo A PEZZI (come un vero LLM in streaming) e POI chiama `reply`:
 * serve a distinguere «il tee ha perso un delta» da «il modello non ne aveva da perdere» — con un
 * solo chunk di testo i due rami combacerebbero anche con un tee rotto a metà.
 */
function textThenReplyModel(pieces: string[], replyMessage: string) {
	scriptTurns({ texts: pieces, calls: [replyCall(replyMessage)] });
}

/** `fakeDb`, ma conta le `update` che toccano `partial` — per provare che lo specchio è throttled. */
function fakeDbWithPartialSpy(seed: Row[] = []) {
	const { db, rows } = fakeDb(seed);
	let partialWrites = 0;
	const wrapped = {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		rpc: (fn: string, params: Record<string, unknown>) => (db as any).rpc(fn, params),
		from(table: string) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const chain = (db as any).from(table);
			const origUpdate = chain.update.bind(chain);
			chain.update = (p: Record<string, unknown>) => {
				if (p && typeof p === 'object' && 'partial' in p) partialWrites++;
				return origUpdate(p);
			};
			return chain;
		}
	};
	return { db: wrapped as unknown as SupabaseClient, rows, partialWrites: () => partialWrites };
}

const spec = specById('content')!;
// Il client utente finto risponde alle SOLE letture che il bridge fa davvero a inizio
// turno (brand_memory per l'iniezione della memoria): righe vuote, catena PostgREST minima.
function emptyReadChain(): Record<string, unknown> {
	const chain: Record<string, unknown> = {};
	for (const m of ['select', 'eq', 'is', 'or', 'not', 'neq', 'order', 'limit', 'in']) {
		chain[m] = () => chain;
	}
	chain.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
	chain.single = async () => ({ data: null, error: { message: 'no rows' } });
	return chain;
}
const fakeSupabase = { from: () => emptyReadChain() } as unknown as SupabaseClient;

beforeEach(async () => {
	await new Promise((r) => setTimeout(r, 12));
	savedMessages.length = 0;
	modelHolder.current = null;
	resumeThrows.current = false;
	continuations.length = 0;
	continuationReturns.current = 'cont-job-1';
	harnessQueue.length = 0;
	harnessTurnOpts.length = 0;
	harnessServed = 0;
	bakedToolsBySession.clear();
	goalState.open = null;
	goalState.settleCalls.length = 0;
	goalState.settlement = {
		goal: null,
		decision: { continue: false, reason: 'no_goal', handBack: false },
		closedNow: [],
		notice: null,
		continuationPrompt: null
	};
});

function openToolModel(toolName: string) {
	scriptTurns({
		texts: ['guardo i file del brand'],
		calls: [{ toolCallId: 'c1', toolName, input: { path: '.' } }]
	});
}

/**
 * Un turno che registra il CATALOGO che gli è stato annunciato e poi chiude con `reply`:
 * l'unico modo di provare che un tool è arrivato al modello, e non solo all'executor.
 */
function toolCatalogModel(seen: string[], prompt?: { text: string }) {
	scriptTurns({
		capture: ({ system, tools }) => {
			seen.push(...Object.keys(tools));
			if (prompt) prompt.text = system;
		},
		calls: [replyCall('fatto')]
	});
}

describe('la squadra: message_agent è montato per OGNI mestiere', () => {
	it('il catalogo annunciato al modello lo contiene — un motion che finisce un video può passarlo al Web', async () => {
		const seen: string[] = [];
		toolCatalogModel(seen);
		const { db } = fakeDb();
		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec: specById('motion')!,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it'
		});
		await res.text();
		expect(seen).toContain('message_agent');
	});

	it('il blocco squadra lo PROMETTE: un prompt che nega il tool montato è la bugia opposta', async () => {
		const seen: string[] = [];
		const prompt = { text: '' };
		toolCatalogModel(seen, prompt);
		const { db } = fakeDb();
		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec: specById('motion')!,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it'
		});
		await res.text();
		expect(prompt.text).toContain('message_agent');
		expect(prompt.text).not.toContain('You cannot write to them from here');
	});

	it('porta REPLY LANGUAGE — senza, un messaggio inglese sul kit diventa italiano (amazon.in)', async () => {
		const seen: string[] = [];
		const prompt = { text: '' };
		toolCatalogModel(seen, prompt);
		const { db } = fakeDb();
		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-lang',
			spec: specById('content')!,
			messages: [{ role: 'user', content: 'Give me content ideas for my brand Royal rasoy' }],
			locale: 'en'
		});
		await res.text();
		expect(prompt.text).toContain('REPLY LANGUAGE — ABSOLUTE RULE');
		expect(prompt.text).toContain("language of the user's latest message");
		expect(prompt.text).toContain('an English message gets an English reply');
		expect(prompt.text).not.toMatch(/^Sei /m);
	});
});

describe("runKitTurn — il tempo finisce, il lavoro no", () => {
	it('chiude con reason deadline, accoda la continuazione e lo DICE nel messaggio', async () => {
		openToolModel('brand_ls');
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-deadline',
			spec,
			messages: [{ role: 'user', content: 'leggi tutto e poi rispondi' }],
			locale: 'it',
			origin: 'http://localhost:5183',
			budgetMs: 1,
			continuationDepth: 2
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 80));

		const run = rows.find((r) => r.thread_id === 't-deadline');
		expect(run?.reason).toBe('deadline');
		// La profondità VIAGGIA: il turno ripreso è il terzo giro, non il primo.
		expect(continuations).toHaveLength(1);
		expect(continuations[0].depth).toBe(2);
		expect(continuations[0].threadId).toBe('t-deadline');
		// E la promessa arriva a chi legge: `assistantContentFromSteps` scarta il fallback appena
		// uno step ha lasciato testo proprio, quindi la riga va SPINTA nel contenuto.
		const parts = savedMessages.at(-1)?.content as Array<{ type: string; text?: string }>;
		expect(parts.some((p) => p.type === 'text' && p.text?.includes('riprendo il resto in background'))).toBe(true);
	});

	it('nessuna ripresa in coda → la riga lo dice, invece di promettere', async () => {
		openToolModel('brand_ls');
		continuationReturns.current = null; // tetto raggiunto, o l'utente ha già scritto
		const { db } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-deadline-2',
			spec,
			messages: [{ role: 'user', content: 'leggi tutto e poi rispondi' }],
			locale: 'it',
			origin: 'http://localhost:5183',
			budgetMs: 1
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 80));

		const parts = savedMessages.at(-1)?.content as Array<{ type: string; text?: string }>;
		expect(parts.some((p) => p.type === 'text' && p.text?.includes('scrivi "continua"'))).toBe(true);
	});

	it('senza origin non si accoda niente: il drain si sveglia via HTTP', async () => {
		openToolModel('brand_ls');
		const { db } = fakeDb();
		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-deadline-3',
			spec,
			messages: [{ role: 'user', content: 'leggi tutto' }],
			locale: 'it',
			budgetMs: 1
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 80));
		expect(continuations).toHaveLength(0);
	});
});

describe('shouldUseKit — la condizione pura, testata senza toccare $env', () => {
	it('flag spento → mai il kit, anche con uno specialista valido', () => {
		expect(shouldUseKit({ AGENT_KIT: 'off' }, 'content')).toBeNull();
		expect(shouldUseKit({}, 'content')).toBeNull();
	});

	it('flag acceso ma nessun agente sul thread → null', () => {
		expect(shouldUseKit({ AGENT_KIT: 'on' }, null)).toBeNull();
		expect(shouldUseKit({ AGENT_KIT: 'on' }, undefined)).toBeNull();
	});

	it('flag acceso ma un id che non è uno dei cinque specialisti → null', () => {
		expect(shouldUseKit({ AGENT_KIT: 'on' }, 'non-esiste')).toBeNull();
	});

	it('flag acceso + specialista noto → la sua AgentSpec', () => {
		const got = shouldUseKit({ AGENT_KIT: 'on' }, 'content');
		expect(got?.id).toBe('content');
	});
});

describe('runKitTurn — reply', () => {
	it('salva il messaggio giusto e chiude il run \'done\' con reason \'reply\'', async () => {
		toolCallModel('reply', { message: 'ho letto lo studio, la palette è viola', delivered: [] });
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it'
		});
		// Il body va consumato perché `onFinish` gira solo quando lo stream è drenato.
		await res.text();

		expect(rows).toHaveLength(1);
		expect(rows[0].state).toBe('done');
		expect(rows[0].reason).toBe('reply');
		expect(savedMessages).toHaveLength(1);
		expect(savedMessages[0].threadId).toBe('t1');
		expect(JSON.stringify(savedMessages[0].content)).toContain('ho letto lo studio');
	});
});

describe('runKitTurn — ask_user', () => {
	it('lascia il run waiting_input, con la domanda salvata sulla riga', async () => {
		toolCallModel('ask_user', { question: 'quale palette?' });
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'fammi un post' }],
			locale: 'it'
		});
		await res.text();

		expect(rows).toHaveLength(1);
		expect(rows[0].state).toBe('waiting_input');
		expect(rows[0].question).toEqual({ question: 'quale palette?' });
		expect(savedMessages[0].content && JSON.stringify(savedMessages[0].content)).toContain('quale palette?');
	});
});

describe('runKitTurn — il turno successivo su un run waiting_input fa resume', () => {
	it('non apre un run nuovo: riprende quello in attesa e lo richiude', async () => {
		toolCallModel('reply', { message: 'uso la palette scura', delivered: [] });
		const { db, rows } = fakeDb([
			{
				id: 'run-1',
				brand_id: 'b1',
				thread_id: 't1',
				agent_id: 'content',
				user_id: 'u1',
				state: 'waiting_input',
				reason: null,
				question: { question: 'quale palette?' },
				created_at: '2026-08-21T00:00:00.000Z',
				updated_at: '2026-08-21T00:00:00.000Z'
			}
		]);

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [
				{ role: 'assistant', content: 'quale palette?' },
				{ role: 'user', content: 'quella scura' }
			],
			locale: 'it'
		});
		await res.text();

		// Nessuna riga nuova: lo stesso run-1 è stato ripreso e richiuso.
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe('run-1');
		expect(rows[0].state).toBe('done');
		expect(rows[0].reason).toBe('reply');
	});
});

describe('runKitTurn — doppio resume su una waiting_input (due dispositivi rispondono insieme)', () => {
	it('il perdente della corsa riceve un 409 pulito, non il 500 grezzo del CAS', async () => {
		toolCallModel('reply', { message: 'non dovrebbe arrivarci', delivered: [] });
		const { db, rows } = fakeDb([
			{
				id: 'run-1',
				brand_id: 'b1',
				thread_id: 't1',
				agent_id: 'content',
				user_id: 'u1',
				state: 'waiting_input',
				reason: null,
				question: { question: 'quale palette?' },
				created_at: '2026-08-21T00:00:00.000Z',
				updated_at: '2026-08-21T00:00:00.000Z'
			}
		]);
		resumeThrows.current = true;

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [
				{ role: 'assistant', content: 'quale palette?' },
				{ role: 'user', content: 'quella scura, dal secondo telefono' }
			],
			locale: 'it'
		});

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toBe('resume_conflict');
		// Payload API, non chat: in inglese, anche per una chat italiana.
		expect(body.message).toBe('Someone else already replied in this conversation.');
		// La riga non è stata toccata dal perdente: resta come l'ha lasciata chi ha vinto la corsa.
		expect(rows[0].state).toBe('waiting_input');
	});
});

describe('i tool dei plugin sono ANNUNCIATI al modello, non solo eseguibili', () => {
	it('la riga tools del bridge fonde BUILTIN_TOOLS con plugins.flatMap(p => p.tools)', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync(new URL('./live.ts', import.meta.url), 'utf8');
		// Dichiarare un plugin senza esporlo era il buco: l'executor rispondeva a motion_*,
		// il modello non sapeva di poterlo chiedere. Questo pinna la fusione nel catalogo.
		expect(src).toMatch(/\.\.\.BUILTIN_TOOLS, \.\.\.plugins\.flatMap\(\(p\) => p\.tools\)/);
	});

	it('il catalogo che arriva al modello porta i builtin E quelli del mestiere', async () => {
		const seen = await toolsHandedToTheModel('agent', 't-catalogo-plugin');
		expect(seen.tools).toContain('brand_ls');
		expect(seen.tools).toContain('content_create_post');
	});

	it('la delega è montata sul kit: i tool di subagents.ts entrano nel catalogo e il loro set arriva ai worker', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync(new URL('./live.ts', import.meta.url), 'utf8');
		expect(src).toContain('createDelegationPlugin');
		expect(src).toContain('createSubagentTools');
		// Il set che i worker ricevono si riempie DOPO buildTools: alla creazione è vuoto per
		// costruzione (i plugin stanno nel catalogo che buildTools stesso produce).
		expect(src).toMatch(/Object\.assign\(scopedTools, toolSet\)/);
	});
});

describe('runKitTurn — il riaggancio dello stream (consumeSseStream, 0218)', () => {
	it('il ramo specchio non perde chunk: il testo che ricostruisce da solo è lo STESSO che riceve il client', async () => {
		textThenReplyModel(['Cia', 'o mo', 'ndo', '!'], 'fatto');
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it'
		});

		// Il ramo CLIENTE: la stessa cosa che leggerebbe il browser.
		const clientState = emptyStreamState();
		const { events } = readSseEvents(await res.text());
		for (const evt of events) applyChatStreamEvent(clientState, evt);

		// Il ramo SPECCHIO: quello che `consumeSseStream` ha scritto su `partial` (verificato
		// dall'ultima riscrittura incondizionata, non da un giro throttled a metà).
		const partial = rows[0].partial as { text: string } | null;

		expect(clientState.text).toBe('Ciao mondo!\n\nfatto') // il reducer ora immette il messaggio di reply nel testo (fix 23/8): anche il parziale lo porta;
		expect(partial?.text).toBe('Ciao mondo!\n\nfatto') // il reducer ora immette il messaggio di reply nel testo (fix 23/8): anche il parziale lo porta;
	});

	it('lo specchio scrive `partial` throttled — non un update per chunk', async () => {
		// 12 pezzi di testo: se ogni evento scrivesse la riga, sarebbero >=12 update. Il throttle
		// (1a scrittura subito, poi solo se è passato ≥1s, più la finale incondizionata) ne fa AL
		// PIÙ 2 in un turno che gira tutto in pochi millisecondi come questo test.
		const pieces = Array.from({ length: 12 }, (_, i) => `t${i} `);
		textThenReplyModel(pieces, 'fatto');
		const { db, partialWrites } = fakeDbWithPartialSpy();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it'
		});
		await res.text();

		expect(partialWrites()).toBeLessThanOrEqual(2);
		expect(partialWrites()).toBeLessThan(pieces.length);
	});

	it('il run porta `partial` con testo e tool — quello che GET kit-run/+server.ts restituisce dopo un reload', async () => {
		textThenReplyModel(['tutto ok'], 'fatto');
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it'
		});
		await res.text();

		const partial = rows[0].partial as {
			text: string;
			tools: Array<{ toolCallId: string; toolName: string; input?: unknown; textLen?: number }>;
			updatedAt: string;
		} | null;
		expect(partial?.text).toBe('tutto ok\n\nfatto') // idem: reply visibile pure dal parziale dopo un reload;
		expect(partial?.tools?.map((t) => t.toolName)).toEqual(['reply']);
		expect(partial?.tools?.[0]?.toolCallId).toBeTruthy();
		expect(typeof partial?.updatedAt).toBe('string');
	});

	it('il parziale porta ARGOMENTI e id delle tool call, non i soli nomi: senza, la continuazione rifà da capo', async () => {
		textThenReplyModel(['tutto ok'], 'fatto');
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it'
		});
		await res.text();

		const tools = (rows[0].partial as { tools?: Array<Record<string, unknown>> } | null)?.tools ?? [];
		expect(tools).toHaveLength(1);
		expect(tools[0].toolCallId).toBe('c1');
		expect(tools[0].input).toEqual({ message: 'fatto', delivered: [] });
		expect(tools[0].textLen).toBe('tutto ok'.length);
	});
});

describe('la fabbricazione non passa dal bridge', () => {
	it('un turno che dichiara un video senza produrlo fa ripartire l\'agente (rilancio silenzioso)', async () => {
		const { db } = fakeDb();
		toolCallModel('reply', {
			message: '**Fatto.** Nuovo trailer Apple-style, 502 frame.',
			delivered: []
		});
		const logs: string[] = [];
		const spy = vi.spyOn(console, 'log').mockImplementation((m) => logs.push(String(m)));
		await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-fab',
			spec: specById('motion')!,
			messages: [{ role: 'user', content: 'rifallo bello' } as never],
			locale: 'it',
			// al secondo giro il tetto ferma la catena: qui si prova che il PRIMO scatta
			verdictLaps: 1
		});
		// onFinish gira quando lo stream viene consumato: succede DOPO il ritorno della Response
		// (è il consumeStream server-side, il pezzo che fa sopravvivere il turno a un reload).
		await new Promise((r) => setTimeout(r, 80));
		spy.mockRestore();
		expect(logs.some((l) => l.includes('verdict'))).toBe(true);
	});

	// CAUSA C.3 — il rilancio deve vedere quello che il turno ha già fatto, non solo il suo testo
	// finale (autopsia: `[...messages, {role:'assistant', content: visibleText}, {role:'user', ...}]`
	// buttava via ogni tool call del turno, e il modello ripartiva da zero invece di completare).
	// `reply` è terminale (senza execute): non ha un tool-result da rigiocare, e un tool-call senza
	// esito nel prompt è un 400 del provider — il suo messaggio rientra come TESTO assistant, mentre
	// il lavoro vero del turno (qui `plan`) rientra come tool-call + tool-result.
	it('il rilancio silenzioso porta il tool-call/tool-result del turno chiuso, non solo il suo testo', async () => {
		const { db } = fakeDb();
		const planWork: FakeCall = { toolCallId: 'work-1', toolName: 'plan', input: { steps: ['rifaccio il trailer'] } };
		scriptTurns(
			{ calls: [planWork, replyCall('**Fatto.** Nuovo trailer Apple-style, 502 frame.')] },
			{ calls: [replyCall('ok')] }
		);

		await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-fab-2',
			spec: specById('motion')!,
			messages: [{ role: 'user', content: 'rifallo bello' } as never],
			locale: 'it'
		});
		// Il rilancio parte dentro l'onFinish del primo turno (consumeStream server-side).
		await new Promise((r) => setTimeout(r, 120));

		expect(harnessTurnOpts.length).toBe(2); // il primo turno + il rilancio silenzioso
		const secondPrompt = harnessTurnOpts[1].messages as ReadonlyArray<{ role: string; content?: unknown }>;
		// Prima del fix il rilancio portava SOLO `{role:'assistant', content: visibleText}` come
		// stringa piatta: mai una `tool-call`, mai un `tool` role con l'esito. Il modello ripartiva
		// senza sapere del lavoro già fatto in questo turno.
		type PromptMessage = { role: string; content?: unknown };
		const partsOf = (m: PromptMessage) =>
			Array.isArray(m.content) ? (m.content as Array<{ type?: string; toolName?: string; toolCallId?: string; text?: string }>) : [];
		const assistantWithWorkCall = secondPrompt.find(
			(m: PromptMessage) => m.role === 'assistant' && partsOf(m).some((p) => p.type === 'tool-call' && p.toolName === 'plan' && p.toolCallId === 'work-1')
		);
		expect(assistantWithWorkCall).toBeDefined();
		const toolResultForWork = secondPrompt.find(
			(m: PromptMessage) => m.role === 'tool' && partsOf(m).some((p) => p.type === 'tool-result' && p.toolCallId === 'work-1')
		);
		expect(toolResultForWork).toBeDefined();
		const replyTextCarried = secondPrompt.some(
			(m: PromptMessage) => m.role === 'assistant' && partsOf(m).some((p) => p.type === 'text' && (p.text ?? '').includes('Fatto.'))
		);
		expect(replyTextCarried).toBe(true);
		const danglingReplyCall = secondPrompt.some((m: PromptMessage) =>
			partsOf(m).some((p) => p.type === 'tool-call' && p.toolName === 'reply')
		);
		expect(danglingReplyCall).toBe(false);
	});
});

describe("auto-attach: un url media vero nella risposta finisce nella bolla", () => {
	it('estrae mp4/png dal testo del reply e li salva come allegati del messaggio', async () => {
		const { db } = fakeDb();
		savedMessages.length = 0;
		const url = 'https://x.supabase.co/storage/v1/object/public/media/b/motion/abc.mp4';
		toolCallModel('reply', { message: `Ecco il trailer: ${url}`, delivered: [] });
		await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-auto',
			spec: specById('motion')!,
			messages: [{ role: 'user', content: 'riallegami il trailer' } as never],
			locale: 'it',
			verdictLaps: 2 // giudice fermo: qui si prova SOLO l'auto-attach
		});
		await new Promise((r) => setTimeout(r, 80));
		expect(savedMessages.at(-1)?.attachments).toEqual([url]);
	});
});

describe("il turno sopravvive alla disconnessione del client", () => {
	it('dichiara DUE lavori: il turno e lo specchio del parziale', async () => {
		const { db } = fakeDb();
		const declared: Array<Promise<unknown>> = [];
		toolCallModel('reply', { message: 'ok', delivered: [] });
		await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-wu',
			spec: specById('content')!,
			messages: [{ role: 'user', content: 'ciao' } as never],
			locale: 'it',
			verdictLaps: 2,
			waitUntil: (p) => declared.push(p)
		});
		// DUE, non uno. Il turno era gia' dichiarato; lo specchio del parziale no -- l'SDK invoca
		// `consumeSseStream` senza attenderla, e su serverless una promessa non dichiarata muore
		// quando l'invocazione chiude. Al refresh il turno continuava a lavorare e `partial`
		// smetteva di essere scritto: la pagina ricaricata non trovava niente da mostrare.
		// Misurato il 25/8: 29 run su 61 senza un solo parziale, uno dei quali da 674 secondi.
		expect(declared.length).toBe(2);
		await declared[0];
	});
});

describe('runKitTurn — un turno alla volta per thread (il refresh non crea run doppi)', () => {
	const runningRow = (heartbeat_at: string | null, created_at: string) => ({
		id: 'run-1',
		brand_id: 'b1',
		thread_id: 't1',
		agent_id: 'content',
		user_id: 'u1',
		state: 'running',
		reason: null,
		question: null,
		heartbeat_at,
		created_at,
		updated_at: created_at
	});

	it('run `running` col battito fresco → 409, NESSUN secondo run', async () => {
		toolCallModel('reply', { message: 'mai usato', delivered: [] });
		const { db, rows } = fakeDb([
			runningRow(new Date().toISOString(), new Date(Date.now() - 60_000).toISOString())
		]);

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'secondo invio dopo un refresh' }],
			locale: 'it'
		});

		expect(res.status).toBe(409);
		// Mutazione pinnata: senza il guard qui ci sarebbero DUE righe (il bug del 23/8).
		expect(rows).toHaveLength(1);
		expect(rows[0].state).toBe('running');
		expect(savedMessages).toHaveLength(0);
		// Questo busy arriva DOPO che il POST ha salvato il messaggio dell'utente: chi ripiega
		// sull'enqueue deve poterlo dire al drain, o la riga finisce due volte nel thread.
		expect(await res.json()).toEqual({ error: 'busy', user_message_saved: true });
	});

	it('a run finito il drain viene svegliato: il follow-up accodato non aspetta il cron', async () => {
		queueKicks.length = 0;
		toolCallModel('reply', { message: 'fatto', delivered: [] });
		const { db } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it',
			origin: 'https://app.test'
		});
		await res.text();

		expect(queueKicks).toEqual(['https://app.test']);
	});

	it('run mai battuto ma nato da poco → conta come vivo: 409 anche lui', async () => {
		const { db, rows } = fakeDb([runningRow(null, new Date().toISOString())]);
		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it'
		});
		expect(res.status).toBe(409);
		expect(rows).toHaveLength(1);
	});

	it('zombie (nessun battito da >10\') NON blocca: il turno parte, lo zombie lo chiude il reaper', async () => {
		toolCallModel('reply', { message: 'si riparte', delivered: [] });
		const stale = new Date(Date.now() - 11 * 60_000).toISOString();
		const { db, rows } = fakeDb([runningRow(stale, stale)]);

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't1',
			spec,
			messages: [{ role: 'user', content: 'riprova' }],
			locale: 'it'
		});
		await res.text();

		expect(res.status).not.toBe(409);
		expect(rows).toHaveLength(2); // lo zombie resta (al reaper), il turno nuovo si chiude
		expect(rows[1].state).toBe('done');
	});
});

describe('il run sfrattato non deposita il suo messaggio (la causa radice del doppione)', () => {
	it('run già abortito dal reaper → NIENTE riga in chat, lo stato del reaper resta', async () => {
		const { db, rows, chatMessages } = fakeDb();
		scriptTurns({
			calls: [replyCall('rieccomi dal passato')],
			onStreamStart: () => {
				const running = rows.find((r) => r.state === 'running');
				if (running) {
					running.state = 'aborted';
					running.reason = 'aborted';
				}
			}
		});

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-reaped',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it',
			verdictLaps: 2
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 80));

		// Il doppione nasceva qui: il worker morto scriveva comunque il messaggio, e il dedupe a
		// valle doveva indovinarlo. Con la chiusura atomica il perdente non scrive NIENTE.
		expect(savedMessages).toHaveLength(0);
		expect(chatMessages).toHaveLength(0);
		expect(rows[0].state).toBe('aborted');
		expect(rows[0].reason).toBe('aborted');
		expect(rows[0].partial_saved_msg_id).toBeUndefined();
	});

	it('il run NON sfrattato salva una volta sola, con marcatore e stato nella stessa chiusura', async () => {
		const { db, rows, chatMessages } = fakeDb();
		toolCallModel('reply', { message: 'consegna vera', delivered: [] });

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-alive',
			spec,
			messages: [{ role: 'user', content: 'ciao' }],
			locale: 'it',
			verdictLaps: 2
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 80));

		expect(chatMessages).toHaveLength(1);
		expect(rows[0].state).toBe('done');
		expect(rows[0].partial_saved_msg_id).toBe(chatMessages[0].id);
	});
});

describe("il falso zombie: un tool lungo tiene vivo il battito", () => {
	it('un render lungo batte PRIMA, DURANTE (timer) e DOPO — il reaper non lo uccide', async () => {
		const { db, rows } = fakeDb();
		let beats = 0;
		const origFrom = db.from.bind(db);
		(db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
			const q = origFrom(t) as { update: (v: Record<string, unknown>) => unknown };
			const origUpdate = q.update.bind(q);
			q.update = (v: Record<string, unknown>) => {
				if (v.heartbeat_at) beats++;
				return origUpdate(v);
			};
			return q;
		};
		// un modello che chiama un tool "lento" (2.2s > 1 tick del timer di test? no: usiamo il
		// battito prima+dopo, garantito anche senza aspettare 60s)
		toolCallModel('motion_render', { id: 'x' });
		await runKitTurn({
			supabase: fakeSupabase, admin: db as never, brand: { id: 'b1' }, user: { id: 'u1' },
			threadId: 't-beat', spec: specById('motion')!,
			messages: [{ role: 'user', content: 'renderizza' } as never], locale: 'it', verdictLaps: 2
		});
		await new Promise((r) => setTimeout(r, 60));
		expect(beats).toBeGreaterThanOrEqual(2); // almeno prima e dopo il tool
		void rows;
	});
});

/**
 * Il difetto raccontato dall'utente il 25/8: turno da mezz'ora, ricarico la pagina, il thread è
 * quello di prima — «l'AI ha cancellato tutto». Il lavoro c'era, ma in `agent_kit_runs.partial`,
 * una colonna che il transcript non legge: visibile solo se il riaggancio allo stream riusciva, e
 * un refresh lo spezza. Adesso il battito — un timer del SERVER, che al refresh non muore —
 * promuove il parziale in una riga assistant vera.
 */
describe('il parziale diventa una riga vera mentre il turno gira', () => {
	function fakeDbWithPartialOnBeat() {
		const { db, rows } = fakeDb();
		const inserted: Array<{ table: string; payload: Record<string, unknown> }> = [];
		const origFrom = db.from.bind(db);
		(db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
			const q = origFrom(t) as {
				update: (v: Record<string, unknown>) => unknown;
				insert: (v: Record<string, unknown>) => unknown;
			};
			const origUpdate = q.update.bind(q);
			const origInsert = q.insert.bind(q);
			q.update = (v: Record<string, unknown>) => {
				// Lo specchio dello stream, simulato: al battito il parziale è già sulla riga.
				if (v.heartbeat_at) {
					for (const r of rows) {
						if (r.state === 'running') r.partial = { text: 'mezza risposta', updatedAt: new Date().toISOString() };
					}
				}
				return origUpdate(v);
			};
			q.insert = (v: Record<string, unknown>) => {
				inserted.push({ table: t, payload: v });
				return origInsert(v);
			};
			return q;
		};
		return { db, rows, inserted };
	}

	it('il battito scrive il parziale in chat_messages, senza aspettare la fine del turno', async () => {
		openToolModel('brand_ls');
		const { db, inserted } = fakeDbWithPartialOnBeat();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-checkpoint',
			spec,
			messages: [{ role: 'user', content: 'fai tutto' }],
			locale: 'it',
			origin: 'http://localhost:5183',
			budgetMs: 1
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 80));

		const checkpoint = inserted.find(
			(x) => x.table === 'chat_messages' && x.payload.role === 'assistant'
		);
		expect(checkpoint).toBeTruthy();
		expect(checkpoint!.payload.content).toBe('mezza risposta');
		expect(checkpoint!.payload.thread_id).toBe('t-checkpoint');
	});

	it('a turno chiuso il checkpoint sparisce: la riga definitiva è l’unica rimasta', async () => {
		openToolModel('brand_ls');
		const { db, rows } = fakeDbWithPartialOnBeat();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-checkpoint-close',
			spec,
			messages: [{ role: 'user', content: 'fai tutto' }],
			locale: 'it',
			origin: 'http://localhost:5183',
			budgetMs: 1
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 80));

		expect(rows.filter((r) => r.role === 'assistant' && r.thread_id === 't-checkpoint-close')).toHaveLength(0);
	});
});

describe('Stop ferma davvero il turno kit', () => {
	/** Il gesto dell'utente arriva da un'altra invocazione: la riga esce da `running` a metà turno. */
	function fakeDbStoppedAtFirstBeat() {
		const { db, rows } = fakeDb();
		const origFrom = db.from.bind(db);
		(db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
			const q = origFrom(t) as { update: (v: Record<string, unknown>) => unknown };
			const origUpdate = q.update.bind(q);
			q.update = (v: Record<string, unknown>) => {
				if (v.heartbeat_at) for (const r of rows) if (r.state === 'running') r.state = 'aborted';
				return origUpdate(v);
			};
			return q;
		};
		return { db, rows };
	}

	it('nessun messaggio assistente dopo lo Stop, e nessuna continuazione accodata', async () => {
		openToolModel('brand_ls');
		const { db, rows } = fakeDbStoppedAtFirstBeat();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-stop',
			spec,
			messages: [{ role: 'user', content: 'fai tutto' }],
			locale: 'it',
			origin: 'http://localhost:5183',
			budgetMs: 1
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 80));

		expect(savedMessages.filter((m) => m.threadId === 't-stop')).toHaveLength(0);
		// Sul muro il kit accoda da solo: uno Stop che non ferma finisce in un turno che continua
		// E ne genera un altro.
		expect(continuations).toHaveLength(0);
		expect(rows.find((r) => r.thread_id === 't-stop')?.state).toBe('aborted');
	});
});

function textOnlyModel(text: string) {
	scriptTurns({ texts: [text] });
}

const REPEATED_PRODUCTION_REPLY =
	'**Fatto.** Nuovo trailer Apple-style: bianco/nero, viola #c485fe, font Inter, solo movimento pulito. Anomalia Agents — Il tuo team di marketing in un tap (16:9, 1080×1920, 30 fps, 502 frame).';

const STUCK_THREAD_HISTORY = [
	{ role: 'user', content: 'É veramente brutto, me lo fai bello e apple style?' },
	{ role: 'assistant', content: REPEATED_PRODUCTION_REPLY },
	{ role: 'user', content: 'Letteralmente non hai fatto nulla' },
	{ role: 'assistant', content: REPEATED_PRODUCTION_REPLY },
	{ role: 'user', content: 'Me lo hai già detto. Io ti ho detto di modificarlo e farlo nettamente meglio' }
];

const UNBLOCK_QUESTION =
	'Cosa ti aspettavi di vedere di diverso nel trailer? Dimmi stile, ritmo e cosa buttare, e lo rifaccio davvero.';

function stuckThreadModel() {
	const promptsSeen: string[] = [];
	scriptTurns({
		texts: [REPEATED_PRODUCTION_REPLY],
		capture: ({ messages }) => {
			promptsSeen.push(JSON.stringify(messages));
		}
	});
	return { promptsSeen };
}

describe('lo scenario del thread incastrato e61c5136: partito da lì, l’agente si sblocca da solo', () => {
	it('non ripete il doppione: riceve la correzione, cambia strada e si ferma a chiedere', async () => {
		const promptsSeen: string[] = [];
		const captureMessages = ({ messages }: { messages: unknown }) => {
			promptsSeen.push(JSON.stringify(messages));
		};
		scriptTurns(
			{ texts: [REPEATED_PRODUCTION_REPLY], capture: captureMessages },
			{
				calls: [{ toolCallId: 'c-ask', toolName: 'ask_user', input: { question: UNBLOCK_QUESTION } }],
				capture: captureMessages
			}
		);
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-stuck',
			spec: specById('motion')!,
			messages: STUCK_THREAD_HISTORY as never,
			locale: 'it'
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 250));

		for (const m of savedMessages) {
			expect(JSON.stringify(m.content)).not.toContain('502 frame');
		}
		expect(promptsSeen.some((p) => p.includes('NESSUNO strumento'))).toBe(true);
		expect(savedMessages.some((m) => JSON.stringify(m.content).includes('Cosa ti aspettavi'))).toBe(true);
		const threadRuns = rows.filter((r) => r.thread_id === 't-stuck');
		expect(threadRuns.at(-1)?.state).toBe('waiting_input');
		expect(threadRuns.slice(0, -1).every((r) => r.state === 'done')).toBe(true);

		const transcript: TranscriptEvent[] = [
			...STUCK_THREAD_HISTORY.map((m) => ({ kind: m.role as 'user' | 'assistant', text: m.content })),
			...savedMessages.map((m) => ({ kind: 'assistant' as const, text: JSON.stringify(m.content) })),
			...threadRuns.map((r) => ({ kind: 'run' as const, state: String(r.state), reason: (r.reason ?? null) as string | null }))
		];
		const judgeCalls: string[] = [];
		const judgeModel = new MockLanguageModelV3({
			doGenerate: async ({ prompt }) => {
				judgeCalls.push(JSON.stringify(prompt));
				return {
					finishReason: { unified: 'stop' as const, raw: undefined },
					usage: {
						inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
						outputTokens: { total: 20, text: 20, reasoning: 0 }
					},
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify([
								{ question: 'q1', answer: true, reason: 'ha chiesto invece di ripetere' },
								{ question: 'q2', answer: true, reason: 'nessuna chiamata identica ripetuta' },
								{ question: 'q3', answer: true, reason: 'ha detto cosa stava succedendo' }
							])
						}
					],
					warnings: []
				};
			}
		});
		const verdict = await judgeTranscript({
			model: judgeModel as never,
			transcript,
			questions: [
				"L'agente è uscito dal loop da solo, senza che l'utente cancellasse la conversazione?",
				'Ha evitato di ripetere la stessa risposta o lo stesso tool con gli stessi argomenti già falliti?',
				"Ha cambiato strada o si è fermato a chiedere all'utente cosa mancava?"
			]
		});
		expect(verdict.passed).toBe(true);
		expect(judgeCalls[0]).toContain('Cosa ti aspettavi');
		expect(judgeCalls[0]).toContain('waiting_input');
	});

	it('senza un precedente identico il primo testo si salva UNA volta; la catena non produce mai un secondo doppione', async () => {
		textOnlyModel(REPEATED_PRODUCTION_REPLY);
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-no-repeat',
			spec,
			messages: [{ role: 'user', content: 'fammi un trailer' }],
			locale: 'it'
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 250));

		const withReply = savedMessages.filter((m) => JSON.stringify(m.content).includes('502 frame'));
		expect(withReply).toHaveLength(1);
		expect(JSON.stringify(withReply[0]?.content)).toContain('502 frame');
		expect(rows.filter((r) => r.thread_id === 't-no-repeat').every((r) => r.state === 'done')).toBe(true);
	});

	it('un modello che ripete anche dopo le correzioni finisce sulla presa di coscienza, mai sul doppione', async () => {
		textOnlyModel(REPEATED_PRODUCTION_REPLY);
		const { db, rows } = fakeDb();

		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-repeat-cap',
			spec,
			messages: STUCK_THREAD_HISTORY as never,
			locale: 'it'
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 250));

		for (const m of savedMessages) {
			expect(JSON.stringify(m.content)).not.toContain('502 frame');
		}
		const lastParts = savedMessages.at(-1)?.content as Array<{ type: string; text?: string }>;
		expect(lastParts.some((p) => p.type === 'text' && p.text?.includes('Mi sto ripetendo'))).toBe(true);
		expect(rows.filter((r) => r.thread_id === 't-repeat-cap').every((r) => r.state === 'done')).toBe(true);
	});
});

function capturingReplyModel(seen: { tools: string[]; prompt: string }) {
	scriptTurns({
		capture: ({ system, tools }) => {
			seen.tools = Object.keys(tools);
			seen.prompt = system;
		},
		calls: [replyCall('ecco cosa dicono i dati')]
	});
}

async function toolsHandedToTheModel(mode: unknown, threadId: string) {
	const seen = { tools: [] as string[], prompt: '' };
	capturingReplyModel(seen);
	const { db } = fakeDb();
	const res = await runKitTurn({
		supabase: fakeSupabase,
		admin: db,
		brand: { id: 'b1' },
		user: { id: 'u1' },
		threadId,
		spec,
		messages: [{ role: 'user', content: 'crea e schedula un post' }],
		locale: 'it',
		mode,
		verdictLaps: 2
	});
	await res.text();
	await new Promise((r) => setTimeout(r, 50));
	return seen;
}

describe('B5 — la modalità scelta nel composer conta anche sullo specialista', () => {
	it('in Ask nessuno strumento che scrive arriva al modello', async () => {
		const seen = await toolsHandedToTheModel('ask', 't-mode-ask');
		for (const write of [
			'content_create_post',
			'content_schedule',
			'content_design_graphic',
			'content_generate_image',
			'brand_write',
			'shell',
			'remember'
		]) {
			expect(seen.tools).not.toContain(write);
		}
		expect(seen.tools).toContain('brand_read');
		expect(seen.tools).toContain('query');
		expect(seen.tools).toContain('reply');
		expect(seen.prompt).toContain('CHAT MODE: ASK');
	});

	it('in Plan si scrive nello studio ma non si pubblica', async () => {
		const seen = await toolsHandedToTheModel('plan', 't-mode-plan');
		expect(seen.tools).toContain('brand_write');
		expect(seen.tools).toContain('remember');
		expect(seen.tools).not.toContain('content_create_post');
		expect(seen.tools).not.toContain('content_schedule');
		expect(seen.tools).not.toContain('shell');
		expect(seen.prompt).toContain('CHAT MODE: PLAN');
	});

	it('in Agent (e senza modalità) resta tutto come prima', async () => {
		const agent = await toolsHandedToTheModel('agent', 't-mode-agent');
		expect(agent.tools).toContain('content_schedule');
		expect(agent.tools).toContain('shell');
		const none = await toolsHandedToTheModel(undefined, 't-mode-default');
		expect([...none.tools].sort()).toEqual([...agent.tools].sort());
	});
});

const OPEN_GOAL = {
	id: 'g1',
	brandId: 'b1',
	threadId: 't-goal',
	statement: 'Entro venerdì ci sono dodici post approvati',
	criteria: [
		{ id: 'c1', text: 'i dodici post esistono in pending_user', status: 'done' },
		{ id: 'c2', text: 'i dodici post sono approvati e schedulati', status: 'open' }
	],
	status: 'open',
	laps: 1,
	source: 'user'
};

describe('B6 — gli obiettivi del thread valgono anche sullo specialista', () => {
	it('i tre strumenti dell obiettivo sono nel catalogo, e in Ask spariscono con gli altri', async () => {
		const agent = await toolsHandedToTheModel('agent', 't-goal-catalogo');
		expect(agent.tools).toEqual(expect.arrayContaining(['set_goal', 'update_goal', 'close_goal']));
		const ask = await toolsHandedToTheModel('ask', 't-goal-catalogo-ask');
		expect(ask.tools).not.toContain('set_goal');
	});

	it('un obiettivo aperto rientra nel prompt a ogni giro', async () => {
		goalState.open = OPEN_GOAL;
		const seen = await toolsHandedToTheModel('agent', 't-goal-briefing');
		expect(seen.prompt).toContain('OBIETTIVO APERTO DI QUESTA CONVERSAZIONE');
		expect(seen.prompt).toContain('dodici post approvati');
		expect(seen.prompt).toContain('c2');
		// Le regole dell'obiettivo nominano la domanda bloccante: sul kit si chiama `ask_user`, e un
		// prompt che ordina di chiamare uno strumento inesistente è un giro sprecato.
		expect(seen.prompt).not.toContain('ask_user_questions');
		expect(seen.prompt).toContain('ask_user');
	});

	it('a fine turno l obiettivo passa dalla macchina condivisa e la ripresa porta i criteri aperti', async () => {
		goalState.open = OPEN_GOAL;
		goalState.settlement = {
			goal: OPEN_GOAL,
			decision: { continue: true, reason: 'open_criteria', handBack: false },
			closedNow: [],
			notice: 'Resta aperto c2: riprendo da solo.',
			continuationPrompt: 'MANCANO: c2 — i dodici post sono approvati e schedulati'
		};
		toolCallModel('reply', { message: 'ho preparato le bozze', delivered: [] });
		const { db } = fakeDb();
		const res = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-goal-settle',
			spec,
			messages: [{ role: 'user', content: 'porta avanti l obiettivo' }],
			locale: 'it',
			origin: 'http://localhost:5183',
			verdictLaps: 2
		});
		await res.text();
		await new Promise((r) => setTimeout(r, 120));

		expect(goalState.settleCalls).toHaveLength(1);
		expect(goalState.settleCalls[0].threadId).toBe('t-goal-settle');
		expect(goalState.settleCalls[0].goalAtStart).toBe(OPEN_GOAL);
		expect(goalState.settleCalls[0].succeededTools).not.toContain('reply');
		expect(continuations).toHaveLength(1);
		expect(continuations[0].prompt).toBe('MANCANO: c2 — i dodici post sono approvati e schedulati');
		const parts = savedMessages.at(-1)?.content as Array<{ type: string; text?: string }>;
		expect(parts.some((p) => p.text?.includes('Resta aperto c2'))).toBe(true);
	});

	it('un obiettivo aperto non disattiva più il giudice di chiusura', async () => {
		goalState.open = OPEN_GOAL;
		const { db } = fakeDb([{ id: 'g1', thread_id: 't-goal-verdict', status: 'open' }]);
		toolCallModel('reply', {
			message: '**Fatto.** Nuovo trailer Apple-style, 502 frame.',
			delivered: []
		});
		const logs: string[] = [];
		const spy = vi.spyOn(console, 'log').mockImplementation((m) => logs.push(String(m)));
		await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-goal-verdict',
			spec: specById('motion')!,
			messages: [{ role: 'user', content: 'rifallo bello' } as never],
			locale: 'it',
			verdictLaps: 1
		});
		await new Promise((r) => setTimeout(r, 120));
		spy.mockRestore();
		expect(logs.some((l) => l.includes('verdict'))).toBe(true);
	});
});


describe('lo specchio dice DOVE comincia ogni chunk (26/8: testo mescolato al riaggancio)', () => {
	it('la posizione si legge PRIMA di piegare l evento, o direbbe dove finisce', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync(new URL('./live.ts', import.meta.url), 'utf8');
		const loop = src.slice(src.indexOf('for (const evt of events) {'));
		const at = loop.indexOf('const at = { text: state.text.length');
		const fold = loop.indexOf('applyChatStreamEvent(state, evt);');
		expect(at).toBeGreaterThanOrEqual(0);
		expect(at).toBeLessThan(fold);
		expect(loop.slice(0, loop.indexOf('});'))).toContain('at,');
	});
});

describe('il modello segue il motore unico, non un tier cablato', () => {
	it('il turno gira sull harness: il modello esce da resolveHarnessModelRef dentro runKitTurn', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync(new URL('./live.ts', import.meta.url), 'utf8');
		expect(src).toContain('startHarnessTurn({');
		expect(src).toContain('resolveHarnessModelRef({');
		expect(src).not.toContain('streamText(');
		expect(src).not.toContain('useHarness');
	});
});




describe('i tool girano sul turno VIVO del thread, non su quello che ha cotto la sessione', () => {
	function toolOutput(body: string, toolCallId: string): unknown {
		const { events } = readSseEvents(body);
		const out = events.find(
			(e) => (e as { type?: string }).type === 'tool-output-available' && (e as { toolCallId?: string }).toolCallId === toolCallId
		);
		return (out as { output?: unknown } | undefined)?.output;
	}

	it('il secondo turno esegue i tool anche se la sessione è quella del primo run già chiuso', async () => {
		scriptTurns(
			{ calls: [{ toolCallId: 'c1', toolName: 'brand_ls', input: { path: '.' } }] },
			{ calls: [{ toolCallId: 'c2', toolName: 'brand_ls', input: { path: '.' } }] }
		);
		const { db, rows } = fakeDb();

		const first = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-stale-tools',
			spec,
			messages: [{ role: 'user', content: 'primo' }],
			locale: 'it'
		});
		await first.text();
		await new Promise((r) => setTimeout(r, 80));

		const second = await runKitTurn({
			supabase: fakeSupabase,
			admin: db,
			brand: { id: 'b1' },
			user: { id: 'u1' },
			threadId: 't-stale-tools',
			spec,
			messages: [{ role: 'user', content: 'secondo' }],
			locale: 'it'
		});
		const out = toolOutput(await second.text(), 'c2') as { isError?: boolean } | undefined;

		// Il tool ha RISPOSTO, non si è rifiutato: cosa contenga l'albero del brand non è affare
		// di questo test (le fixture cambiano, il recinto no).
		expect(out?.isError).toBeUndefined();
		expect(JSON.stringify(out)).not.toContain('fermato');
		expect(JSON.stringify(out)).not.toContain('Turno chiuso dal sistema');
		const threadRuns = rows.filter((r) => r.thread_id === 't-stale-tools');
		expect(threadRuns).toHaveLength(2);
		expect(threadRuns.every((r) => r.state === 'done')).toBe(true);
	});
});

/**
 * STOP DEVE FERMARE L'AGENTE DI COLPO — 26/8.
 *
 * `cancelKitRun` scriveva soltanto la riga. Questo processo lo scopriva al battito dopo, e tutto
 * cio` che ne seguiva era rifiutare i TOOL: il modello continuava a generare, a battere e a
 * depositare. Nei dati: un run `aborted` alle 15:17 che batteva ancora alle 15:39 — 22 minuti — e
 * l'utente che vedeva scrivere nel thread una sessione gia` fermata.
 *
 * E il peggio non era il testo: TRE percorsi facevano ripartire il lavoro (anti-ripetizione,
 * ripresa per tempo scaduto, continuazione del goal) e nessuno guardava se il run fosse ancora
 * suo. Il CAS di `closeRunSaving` recinta il MESSAGGIO e arriva dopo — la continuazione era gia`
 * accodata. Uno Stop faceva partire il turno successivo.
 */
describe('Stop ferma il loop, e un run sfrattato non fa ripartire niente', async () => {
	const fs = await import('node:fs');
	const src = fs.readFileSync(new URL('./live.ts', import.meta.url), 'utf8');

	it('il turno riceve un abortSignal, non solo una riga aggiornata', () => {
		expect(src).toContain('abortSignal: turnAbort.signal');
	});

	it('lo stato che esce da running aborta il turno in volo', () => {
		const note = src.slice(src.indexOf('const noteRunState'), src.indexOf('const stillOurs'));
		expect(note).toMatch(/turnAbort\.abort\(\)/);
	});

	it('tutti e tre i rilanci passano dallo stesso recinto', () => {
		// enqueue per deadline, rilancio anti-ripetizione, continuazione del goal.
		expect(src.match(/stillOurs\(\)/g)?.length).toBeGreaterThanOrEqual(3);
	});

	it('la decisione del goal sa dello Stop invece di riceverlo cablato a false', () => {
		expect(src).not.toContain('aborted: false');
		expect(src).toContain('aborted: stoppedByUser');
	});

	/**
	 * IL QUARTO RILANCIO, trovato il 26/8 dopo aver recintato gli altri tre.
	 *
	 * Quando lo stream fallisce, il catch scrive «Errore del turno», sveglia ops e RILANCIA il
	 * turno con un messaggio correttivo. Ma da quando Stop aborta davvero, quel fallimento lo
	 * causiamo NOI: il run `d075b203` e` finito `aborted` e alla stessa identica ora ha
	 * depositato in chat «HarnessAgent: received terminal finish with unclosed step content» —
	 * cioe` premi Stop, leggi un errore rosso, e parte un turno nuovo.
	 *
	 * Un abort che abbiamo chiesto non e` un guasto: non si racconta, non si segnala e non si
	 * riprova.
	 */
	it('un abort che abbiamo chiesto noi non diventa «Errore del turno», ne` un rilancio', () => {
		// Dal `catch` fino al testo dell'errore: la guardia deve stare LI` IN MEZZO, o il messaggio
		// rosso e il rilancio partono comunque.
		const errAt = src.indexOf('Errore del turno: ${why');
		const catchAt = src.lastIndexOf('} catch (error) {', errAt);
		const guard = src.slice(catchAt, errAt);
		expect(guard).toMatch(/turnAbort\.signal\.aborted/);
		expect(guard).toMatch(/return;/);
	});

	it('e l’adapter lo propaga davvero all’HarnessAgent', async () => {
		const adapters = fs.readFileSync(new URL('./adapters.ts', import.meta.url), 'utf8');
		const streamCalls = adapters.match(/\.stream\(\{[\s\S]{0,220}?\}\)/g) ?? [];
		expect(streamCalls.length).toBeGreaterThanOrEqual(2);
		for (const call of streamCalls) expect(call).toContain('abortSignal');
	});
});

/**
 * LA CHIAMATA IN CORSO DEVE STARE NEL PARZIALE — 26/8.
 *
 * Lo specchio scrive `partial` quando arriva un chunk, strozzato a 100ms. L'evento che apre una
 * tool call arriva a ridosso degli argomenti appena emessi, quindi cadeva quasi sempre dentro la
 * finestra e veniva saltato; poi il tool parte, il modello tace per minuti e nessun chunk arriva
 * piu` a far scrivere. Chi ricaricava la pagina non vedeva nessuna invocazione viva e leggeva la
 * chat come bloccata.
 */
describe('il parziale porta la tool call VIVA, non solo quelle finite', async () => {
	const fs = await import('node:fs');
	const src = fs.readFileSync(new URL('./live.ts', import.meta.url), 'utf8');

	it('i tre eventi di ciclo di vita di una tool call forzano la scrittura', () => {
		expect(src).toContain('tool-input-available');
		expect(src).toContain('tool-output-available');
		expect(src).toContain('tool-output-error');
	});

	it('la scrittura obbligata si ACCODA a quella in volo invece di saltare', () => {
		// Saltare qui e` il difetto: il chunk successivo puo` non arrivare mai, ed e` proprio il
		// caso del tool lungo per cui il meccanismo esiste.
		const block = src.slice(src.indexOf('if (mustWrite)'), src.indexOf('if (mustWrite)') + 320);
		expect(block).toMatch(/inFlight \?\? Promise\.resolve\(\)/);
		expect(block).toMatch(/prev\.then\(writePartial\)/);
	});
});

/**
 * IL TURNO CHE NON PARTE, E QUELLO CHE AMMUTOLISCE — 26/8.
 *
 * Un run e` rimasto sei minuti `running` con ZERO caratteri, ZERO ragionamento, `partial` mai
 * scritto una volta e NESSUNA chiamata al modello: appeso dentro `startHarnessTurn`, prima che
 * esistesse uno stream. Il battito e` un timer e batteva regolare, quindi il reaper lo credeva
 * vivo e la chat diceva «sta generando» finche` il proprietario non uccideva la sessione a mano.
 */
describe('un turno che non da` segni di vita si ferma da solo', async () => {
	const fs = await import('node:fs');
	const src = fs.readFileSync(new URL('./live.ts', import.meta.url), 'utf8');

	it('partire ha un tetto, e allo scadere la sessione se ne va', () => {
		expect(src).toContain('HARNESS_START_TIMEOUT_MS');
		const race = src.slice(src.indexOf('Promise.race'), src.indexOf('const result = turn.result'));
		expect(race).toContain('dropLiveHarnessSession');
	});

	it('il cane da guardia si mette IN PAUSA mentre un tool e` in volo', () => {
		// Senza questo, un render motion da dieci minuti — una sola chiamata, zero eventi —
		// verrebbe ucciso proprio mentre lavora.
		const watch = src.slice(src.indexOf('const silenceWatch'), src.indexOf('const stopSilenceWatch'));
		expect(watch).toMatch(/toolsInFlight > 0/);
		expect(watch).toContain('turnAbort.abort()');
	});

	it('il battito non conta come segno di vita: e` un timer', () => {
		// `beat()` gira a orologio anche su un turno appeso — era esattamente il motivo per cui
		// il reaper non se ne accorgeva.
		const watch = src.slice(src.indexOf('const silenceWatch'), src.indexOf('const stopSilenceWatch'));
		expect(watch).not.toContain('beat(');
	});

	it('gli eventi dello stream e i tool sono i soli segni di vita', () => {
		expect(src.match(/signOfLife\(\)/g)?.length).toBeGreaterThanOrEqual(3);
	});
});
