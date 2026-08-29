/**
 * CHAT DI GRUPPO — la SECONDA voce, end-to-end nel runner.
 *
 * Il primo speaker lo esegue il turno interattivo; la seconda voce è un turno accodato normale a
 * cui il job dice CHI risponde (`input_params.agent` + `speaker`), con il blocco stanza in `brief`.
 * Qui si verifica esattamente quel giro, sul codice vero di `processNextQueuedChatJob`:
 *  - l'agente FORZATO batte la colonna del thread;
 *  - il blocco stanza arriva nel system prompt;
 *  - il messaggio dell'utente NON si duplica, ma il modello lo vede lo stesso in coda (o la
 *    seconda voce riceverebbe una conversazione che finisce su un assistant, cioè un prefill);
 *  - la risposta è firmata col membro che parla.
 * E il caso opposto, che vale quanto gli altri: un turno NON presidiato (schedulato) su un thread
 * stanza non anima nessuno — niente smistatore, nessuna voce in più.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// ── Il confine mockato: modello, prompt base, tool pesanti. Il resto è codice vero. ────────────
const harnessCalls: Array<{ system: string; messages: Array<{ role: string; content: unknown }> }> = [];
vi.mock('$lib/server/harness', () => ({
	harnessGenerateText: vi.fn(async (_meta: unknown, args: { system: string; messages: never[] }) => {
		harnessCalls.push({ system: args.system, messages: args.messages });
		return { text: 'Ricevuto, procedo.', steps: [], totalUsage: {} };
	})
}));
const promptCalls: Array<{ agent: string | null }> = [];
vi.mock('./system-prompt', () => ({
	buildSystemPrompt: vi.fn(async (_sb: unknown, _b: unknown, _l: string, agent: string | null) => {
		promptCalls.push({ agent });
		return 'BASE_PROMPT';
	}),
	buildTurnVolatileBlock: vi.fn(async () => ''),
	wrapTurnMessage: (_block: string, message: unknown) => message
}));
vi.mock('./tools', () => ({ createChatTools: () => ({}) }));
vi.mock('./subagents', () => ({ withSubagentTools: (t: unknown) => t }));
vi.mock('./sandbox-tools', () => ({
	withSandboxTools: (t: unknown) => ({ tools: t, close: async () => undefined })
}));
vi.mock('./strategist-tools', () => ({ withStrategistTools: (t: unknown) => t }));
vi.mock('$lib/server/custom-agent-persona', () => ({
	getCustomAgentPersona: vi.fn(async () => null),
	customAgentSystemBlock: () => ''
}));
vi.mock('$lib/server/chat/artifacts', () => ({
	listThreadArtifacts: vi.fn(async () => []),
	formatArtifactsForPrompt: () => ''
}));
vi.mock('./compaction', () => ({ maybeCompactThread: vi.fn(async () => undefined) }));
vi.mock('$lib/server/brand-memory', () => ({ extractMemoryFromChat: vi.fn(async () => undefined) }));
vi.mock('$lib/server/ai-log', async (importOriginal) => ({
	...((await importOriginal()) as Record<string, unknown>),
	logAiCall: () => undefined,
	withBrandContext: (_id: string, fn: () => unknown) => fn()
}));
vi.mock('./model', () => ({
	resolveChatModel: () => ({ model: {}, modelId: 'test-model', provider: 'test', tier: 'auto', callOptions: {} }),
}));
vi.mock('./rate-limits', () => ({
	getChatRateUsage: vi.fn(async () => ({ ok: true })),
	chatCreditsBlocked: vi.fn(async () => false)
}));
vi.mock('./goal', () => ({
	closeGoal: vi.fn(async () => null),
	goalBriefing: () => '',
	goalNudge: () => '',
	goalTurnNotice: () => '',
	goalWorthyRequest: () => false,
	loadOpenGoal: vi.fn(async () => null),
	setThreadGoal: vi.fn(async () => null),
	settleGoalForTurn: vi.fn(async () => null),
	succeededToolNames: vi.fn(() => []),
	refusedToolNames: vi.fn(() => []),
	trackGoalSettlement: () => undefined
}));
vi.mock('./mid-turn-mailbox', () => ({
	createMidTurnMailbox: () => ({ prepareStep: async () => ({}), absorbedCount: () => 0 })
}));
vi.mock('$lib/server/hydrate-chat-documents', () => ({ hydrateChatDocuments: vi.fn(async () => []) }));
vi.mock('$lib/server/web-push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));
vi.mock('./unread', () => ({ markThreadRead: vi.fn(async () => undefined) }));

// Persistenza: legge/scrive il database finto qui sotto, così tool e runner vedono le stesse righe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: { tables: Record<string, Row[]>; client: any };
const savedAssistant: Array<{ threadId: string; opts?: { speaker?: string } }> = [];
vi.mock('./persistence', () => ({
	getThread: vi.fn(async (_sb: unknown, threadId: string) =>
		db.tables.chat_threads.find((t) => t.id === threadId) ?? null
	),
	loadHistory: vi.fn(async (_sb: unknown, _b: string, _u: string, threadId: string) =>
		db.tables.chat_messages
			.filter((m) => m.thread_id === threadId)
			.map((m) => ({ role: m.role, content: m.content }))
	),
	saveMessages: vi.fn(
		async (
			_sb: unknown,
			brandId: string,
			userId: string,
			messages: Array<{ role: string; content: unknown }>,
			threadId: string,
			opts?: { speaker?: string }
		) => {
			for (const m of messages) {
				if (m.role === 'user') {
					db.tables.chat_messages.push({
						thread_id: threadId,
						brand_id: brandId,
						user_id: userId,
						role: 'user',
						content: String(m.content),
						name: opts?.speaker ?? null,
						superseded: false,
						created_at: new Date().toISOString()
					});
				} else {
					savedAssistant.push({ threadId, opts });
				}
			}
			return ['m1'];
		}
	),
	renameThread: vi.fn(async () => undefined),
	assistantContentFromSteps: (_steps: unknown[], text?: string) =>
		text ? [{ type: 'text', text }] : []
}));

const { processNextQueuedChatJob } = await import('./queue');

// ── Database finto: come queue-credits.test, più insert e contains (marker jsonb). ─────────────
function makeDb(seed: Record<string, Row[]>) {
	const tables: Record<string, Row[]> = { chat_messages: [], chat_threads: [], chat_jobs: [] };
	for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
	let autoId = 0;

	function build(name: string, mode: 'select' | 'update', patch?: Row) {
		const table = (tables[name] ??= []);
		const filters: Array<(r: Row) => boolean> = [];
		const run = () => {
			const hits = table.filter((r) => filters.every((f) => f(r)));
			if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
			return hits;
		};
		const api: Row = {
			eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
			neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), api),
			in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
			gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), api),
			contains: (c: string, v: Row) =>
				(filters.push((r) => {
					const pair = r[c]?.dm;
					return Array.isArray(pair) && (v.dm as string[]).every((k) => pair.includes(k));
				}),
				api),
			not: () => api,
			order: () => api,
			limit: () => api,
			select: () => api,
			single: async () => ({ data: run()[0] ?? null, error: null }),
			maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
			then: (res?: (v: { data: Row[]; error: null }) => unknown) =>
				Promise.resolve(res ? res({ data: run(), error: null }) : { data: run(), error: null })
		};
		return api;
	}

	return {
		tables,
		client: {
			from: (name: string) => ({
				select: () => build(name, 'select'),
				update: (patch: Row) => build(name, 'update', patch),
				insert: (row: Row | Row[]) => {
					const rows = (Array.isArray(row) ? row : [row]).map((r) => ({
						id: `${name}-${++autoId}`,
						created_at: new Date().toISOString(),
						...r
					}));
					(tables[name] ??= []).push(...rows);
					return {
						select: () => ({
							single: async () => ({ data: rows[0], error: null }),
							maybeSingle: async () => ({ data: rows[0], error: null })
						}),
						then: (res?: (v: { error: null }) => unknown) =>
							Promise.resolve(res ? res({ error: null }) : { error: null })
					};
				}
			})
		}
	};
}


const brandRow = { id: 'brand-1', name: 'Brand', slug: 'abd', plan: 'pro', status: 'active' };

const ROOM_BLOCK =
	"## CHAT DI GRUPPO\nQuesto thread è una stanza. Tu sei **Analyst**. Ci sono anche: Motion Specialist (video).";

function roomDb() {
	return makeDb({
		brands: [brandRow],
		chat_threads: [
			{
				id: 'room-1',
				brand_id: 'brand-1',
				user_id: 'user-1',
				// La colonna del thread è il RIPIEGO, non chi parla: in una stanza vince il job.
				agent: 'content',
				custom_agent_id: null,
				title: 'Stanza',
				room_agents: ['motion', 'analyst']
			}
		],
		chat_messages: [
			{
				thread_id: 'room-1',
				role: 'user',
				content: 'fammi il reel e dimmi se regge sui numeri',
				superseded: false,
				created_at: '2026-08-22T10:00:00.000Z'
			},
			{
				thread_id: 'room-1',
				role: 'assistant',
				content: 'Ecco il reel.',
				name: 'motion',
				superseded: false,
				created_at: '2026-08-22T10:00:01.000Z'
			}
		]
	});
}

beforeEach(() => {
	harnessCalls.length = 0;
	savedAssistant.length = 0;
	promptCalls.length = 0;
});

describe('chat di gruppo: la seconda voce come turno accodato', () => {
	it("usa l'agente forzato, monta il blocco stanza, non duplica il messaggio e firma la risposta", async () => {
		db = roomDb();
		db.tables.chat_jobs.push({
			id: 'job-room-2',
			brand_id: 'brand-1',
			user_id: 'user-1',
			thread_id: 'room-1',
			tool_name: 'chat_response',
			status: 'pending',
			created_at: new Date().toISOString(),
			input_params: {
				user_message: 'fammi il reel e dimmi se regge sui numeri',
				locale: 'it',
				origin: '',
				queued: true,
				agent: 'analyst',
				speaker: 'analyst',
				user_message_saved: true,
				brief: ROOM_BLOCK
			}
		});

		const res = await processNextQueuedChatJob(db.client as never, 'http://localhost:5173');
		expect(res.processed).toBe(true);
		expect(harnessCalls.length).toBe(1);

		// 1) L'agente del TURNO è quello del job, non `content` del thread.
		expect(promptCalls[0].agent).toBe('analyst');

		// 2) Il blocco stanza è nel system prompt.
		const { system, messages } = harnessCalls[0];
		expect(system).toContain('CHAT DI GRUPPO');
		expect(system).toContain('Motion Specialist');

		// 3) Il messaggio dell'utente non si duplica…
		const userRows = db.tables.chat_messages.filter((m) => m.role === 'user');
		expect(userRows.length).toBe(1);
		// …ma il modello lo vede in coda: l'ultimo messaggio è dell'utente, non un prefill.
		const last = messages[messages.length - 1];
		expect(last.role).toBe('user');
		expect(String(last.content)).toBe('fammi il reel e dimmi se regge sui numeri');

		// 4) La risposta porta la firma del membro che parla.
		expect(savedAssistant[0]?.opts?.speaker).toBe('analyst');
	});

	it('turno NON presidiato su una stanza: nessuno smistatore, nessuna voce in più', async () => {
		db = roomDb();
		db.tables.chat_jobs.push({
			id: 'job-sched',
			brand_id: 'brand-1',
			user_id: 'user-1',
			thread_id: 'room-1',
			tool_name: 'chat_response',
			status: 'pending',
			created_at: new Date().toISOString(),
			input_params: {
				user_message: 'revisione settimanale',
				locale: 'it',
				origin: '',
				queued: true,
				scheduled: true
			}
		});

		const before = db.tables.chat_jobs.length;
		const res = await processNextQueuedChatJob(db.client as never, 'http://localhost:5173');
		expect(res.processed).toBe(true);
		// Un turno solo, sull'agente del THREAD: la stanza non si anima da sola.
		expect(harnessCalls.length).toBe(1);
		expect(promptCalls[0].agent).toBe('content');
		expect(harnessCalls[0].system).not.toContain('CHAT DI GRUPPO');
		// E non ha accodato nessuna seconda voce.
		expect(db.tables.chat_jobs.length).toBe(before);
	});
});
