/**
 * Ticket "Migra gli agenti custom al Kit": il drain lasciava fuori i thread con persona
 * (`!personaId` nel gate) — con AGENT_KIT=on il turno di un agente custom partiva sul motore
 * CLASSICO mentre lo stesso thread, un attimo prima, aveva parlato col kit dal percorso
 * interattivo. Il job deve arrivare al bridge con lo spec del mestiere, il blocco persona e la
 * preferenza di modello; il turno schedulato resta fuori (ticket proprio).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const harnessCalls: Array<{ system: string; messages: Array<{ role: string; content: unknown }> }> = [];
vi.mock('$lib/server/harness', () => ({
	harnessGenerateText: vi.fn(async (_meta: unknown, args: { system: string; messages: never[] }) => {
		harnessCalls.push({ system: args.system, messages: args.messages });
		return { text: 'Fatto.', steps: [], totalUsage: {} };
	})
}));
vi.mock('./system-prompt', () => ({
	buildSystemPrompt: vi.fn(async () => 'BASE_PROMPT'),
	buildTurnVolatileBlock: vi.fn(async () => ''),
	wrapTurnMessage: (_block: string, message: unknown) => message
}));
vi.mock('$lib/agent/tools/index', () => ({ createChatTools: () => ({}) }));
vi.mock('$env/dynamic/private', () => ({ env: { AGENT_KIT: 'on' } }));
vi.mock('./subagents', async (orig) => {
	const actual = await orig<typeof import('./subagents')>();
	return {
		SUBAGENT_TOOL_KEYS: actual.SUBAGENT_TOOL_KEYS,
		withSubagentTools: (t: unknown) => t,
		createSubagentTools: () => ({})
	};
});
vi.mock('$lib/agent/tools/sandbox-tools', () => ({
	withSandboxTools: (t: unknown) => ({ tools: t, close: async () => undefined })
}));
vi.mock('$lib/agent/tools/strategist-tools', () => ({ withStrategistTools: (t: unknown) => t }));
vi.mock('$lib/server/chat/artifacts', () => ({
	listThreadArtifacts: vi.fn(async () => []),
	formatArtifactsForPrompt: () => ''
}));
vi.mock('./compaction', () => ({ maybeCompactThread: vi.fn(async () => undefined) }));
vi.mock('$lib/server/brand-memory', async (orig) => {
	const actual = await orig<typeof import('$lib/server/brand-memory')>();
	return {
		...actual,
		extractMemoryFromChat: vi.fn(async () => undefined)
	};
});
vi.mock('$lib/server/ai-log', async (importOriginal) => ({
	...((await importOriginal()) as Record<string, unknown>),
	logAiCall: () => undefined,
	withBrandContext: (_id: string, fn: () => unknown) => fn()
}));
vi.mock('./model', () => ({
	resolveChatModel: () => ({ model: {}, modelId: 'test-model', provider: 'test', tier: 'auto', callOptions: {} })
}));
vi.mock('./rate-limits', () => ({
	getChatRateUsage: vi.fn(async () => ({ ok: true })),
	chatCreditsBlocked: vi.fn(async () => false)
}));
vi.mock('./goal', async (orig) => {
	const actual = await orig<typeof import('./goal')>();
	return {
		...actual,
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
	};
});
vi.mock('./mid-turn-mailbox', () => ({
	createMidTurnMailbox: () => ({ prepareStep: async () => ({}), absorbedCount: () => 0 })
}));
vi.mock('$lib/server/hydrate-chat-documents', () => ({ hydrateChatDocuments: vi.fn(async () => []) }));
vi.mock('$lib/server/web-push', () => ({ sendPushToUser: vi.fn(async () => undefined) }));
vi.mock('./unread', () => ({ markThreadRead: vi.fn(async () => undefined) }));

const kitTurnInputs: Array<Record<string, unknown>> = [];
vi.mock('$lib/agent/bridge/live', () => ({
	shouldUseKit: (e: { AGENT_KIT?: string }, agentId: string | null) =>
		e.AGENT_KIT === 'on' && agentId ? { id: agentId } : null,
	runKitTurn: vi.fn(async (input: Record<string, unknown>) => {
		kitTurnInputs.push(input);
		return new Response(null, { status: 200 });
	})
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: { tables: Record<string, Row[]>; client: any };
const savedAssistant: Array<unknown> = [];
vi.mock('./persistence', () => ({
	getThread: vi.fn(async (_sb: unknown, threadId: string) =>
		db.tables.chat_threads.find((t: Row) => t.id === threadId) ?? null
	),
	loadHistory: vi.fn(async (_sb: unknown, _b: string, _u: string, threadId: string) =>
		db.tables.chat_messages
			.filter((m: Row) => m.thread_id === threadId)
			.map((m: Row) => ({ role: m.role, content: m.content }))
	),
	saveMessages: vi.fn(
		async (
			_sb: unknown,
			brandId: string,
			userId: string,
			messages: Array<{ role: string; content: unknown }>,
			threadId: string
		) => {
			for (const m of messages) {
				if (m.role === 'user') {
					db.tables.chat_messages.push({
						thread_id: threadId,
						brand_id: brandId,
						user_id: userId,
						role: 'user',
						content: String(m.content),
						superseded: false,
						created_at: new Date().toISOString()
					});
				} else {
					savedAssistant.push(m);
				}
			}
			return ['m1'];
		}
	),
	renameThread: vi.fn(async () => undefined),
	assistantContentFromSteps: (_steps: unknown[], text?: string) =>
		text ? [{ type: 'text', text }] : []
}));

const { sendPushToUser } = await import('$lib/server/web-push');
const { processNextQueuedChatJob } = await import('./queue');

const customAgentRow = {
	id: 'ca-1',
	brand_id: 'brand-1',
	user_id: 'user-1',
	name: 'Scriba di Rime',
	prompt: 'RISpondi SEMPRE in rima.',
	agent: 'content',
	avatar_color: 'amber',
	enabled: true,
	model: { family: 'grok', thinking: 'high' },
	template_slug: null,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z'
};

const personaThread = {
	id: 'ca-thread-1',
	brand_id: 'brand-1',
	user_id: 'user-1',
	agent: 'content',
	custom_agent_id: 'ca-1',
	title: 'Scriba di Rime',
	room_agents: null
};

function personaJob(inputParams: Row) {
	return {
		id: 'job-ca-1',
		brand_id: 'brand-1',
		user_id: 'user-1',
		thread_id: 'ca-thread-1',
		tool_name: 'chat_response',
		status: 'pending',
		created_at: new Date().toISOString(),
		input_params: inputParams
	};
}

function personaDb(jobParams: Row, messages: Row[] = []) {
	return makeDb({
		brands: [{ id: 'brand-1', name: 'brand-di-prova', slug: 'abd', plan: 'pro', status: 'active' }],
		custom_agents: [customAgentRow],
		chat_threads: [personaThread],
		chat_messages: messages,
		chat_jobs: [personaJob(jobParams)]
	});
}

const liveTurn = { user_message: 'scrivi un carosello', locale: 'it', origin: '' };

describe('AGENT_KIT=on: il turno di un agente custom gira sul kit, con la sua persona', () => {
	it('il job va al bridge con lo spec del mestiere, il blocco persona e il modello preferito', async () => {
		db = personaDb({ ...liveTurn });

		const res = await processNextQueuedChatJob(db.client as never, 'http://localhost:5173');
		expect(res.processed).toBe(true);
		expect(harnessCalls.length).toBe(0);
		expect(kitTurnInputs).toHaveLength(1);

		const kit = kitTurnInputs[0];
		expect((kit.spec as { id: string }).id).toBe('content');
		expect(kit.persona).toMatchObject({ id: 'ca-1', memoryKey: 'custom:ca-1' });
		expect(String((kit.persona as { systemBlock: string }).systemBlock)).toContain('Scriba di Rime');
		expect(String((kit.persona as { systemBlock: string }).systemBlock)).toContain('RISpondi SEMPRE in rima.');
		expect(kit.modelFamily).toBe('grok');
		expect(db.tables.chat_jobs[0].status).toBe('done');
	});

	it('a turno finito arriva il push «reply is ready», come sul percorso classico', async () => {
		db = personaDb({ ...liveTurn });

		await processNextQueuedChatJob(db.client as never, 'http://localhost:5173');
		expect(kitTurnInputs).toHaveLength(1);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pushes = (sendPushToUser as any).mock.calls as Array<
			[unknown, string, { url?: string; body?: string }]
		>;
		expect(pushes).toHaveLength(1);
		expect(pushes[0][2].url).toBe('/app/abd/chat/ca-thread-1');
	});

	it('il messaggio dell\'utente non si risalva quando è già nel thread', async () => {
		db = personaDb({ ...liveTurn }, [
			{
				thread_id: 'ca-thread-1',
				role: 'user',
				content: 'scrivi un carosello',
				superseded: false,
				created_at: new Date().toISOString()
			}
		]);

		await processNextQueuedChatJob(db.client as never, 'http://localhost:5173');
		expect(kitTurnInputs).toHaveLength(1);
		const userRows = db.tables.chat_messages.filter(
			(m: Row) => m.thread_id === 'ca-thread-1' && m.role === 'user'
		);
		expect(userRows).toHaveLength(1);
	});

	it('il turno schedulato dell\'agente custom resta sul motore classico', async () => {
		db = personaDb({ ...liveTurn, scheduled: true, brief: '## ROUTINE' });

		const res = await processNextQueuedChatJob(db.client as never, '');
		expect(res.processed).toBe(true);
		expect(kitTurnInputs).toHaveLength(0);
		expect(harnessCalls.length).toBe(1);
	});
});

// ── Database finto: come queue-dm.test, più le tabelle `custom_agents` e `agent_kit_runs`. ────
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
			is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), api),
			contains: (c: string, v: Row) =>
				(filters.push((r) => {
					const pair = r[c]?.dm;
					return Array.isArray(pair) && (v.dm as string[]).every((k) => pair.includes(k));
				}),
				api),
			not: () => api,
			or: () => api,
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

beforeEach(() => {
	harnessCalls.length = 0;
	savedAssistant.length = 0;
	kitTurnInputs.length = 0;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(sendPushToUser as any).mockClear();
});
