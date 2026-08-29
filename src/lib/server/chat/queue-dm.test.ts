/**
 * Repro headless del bug provato in produzione (2026-08-22): il turno di risposta di un DM
 * partiva e il destinatario salutava l'utente per nome ("Ciao, nome-utente-del-brand...") —
 * il blocco DM in coda al system prompt perdeva contro l'intero prompt di brand e contro
 * "user: ciao". Il fix è strutturale e sta nel RUNNER: il marker del thread è l'autorità
 * (qualunque turno su un thread DM nasce DM, anche senza params), il blocco DM sta IN TESTA al
 * system prompt, e l'identità del mittente sta DENTRO il contenuto che il modello vede.
 *
 * Il test percorre ESATTAMENTE il flusso vero: message_agent (await:false) → job pending →
 * processNextQueuedChatJob → chiamata al modello catturata.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// Il percorso sotto test è quello classico del queue: il kit si spegne qui, non nel .env
// locale — altrimenti la suite passa sul laptop di chi lo ha spento e muore su chi lo ha acceso.
// ── Il confine mockato: modello, prompt base, tool pesanti. Il resto è codice vero. ────────────
const harnessCalls: Array<{ system: string; messages: Array<{ role: string; content: unknown }> }> = [];
vi.mock('$lib/server/harness', () => ({
	harnessGenerateText: vi.fn(async (_meta: unknown, args: { system: string; messages: never[] }) => {
		harnessCalls.push({ system: args.system, messages: args.messages });
		return { text: 'Ricevuto, procedo.', steps: [], totalUsage: {} };
	})
}));
vi.mock('./system-prompt', () => ({
	buildSystemPrompt: vi.fn(async () => 'BASE_PROMPT'),
	buildTurnVolatileBlock: vi.fn(async () => ''),
	wrapTurnMessage: (_block: string, message: unknown) => message
}));
vi.mock('./tools', () => ({ createChatTools: () => ({}) }));
vi.mock('$env/dynamic/private', async (importOriginal) => {
	const original = (await importOriginal()) as { env: Record<string, string> };
	return { ...original, env: { ...original.env, AGENT_KIT: 'off' } };
});
vi.mock('./subagents', async (orig) => {
	const actual = await orig<typeof import('./subagents')>();
	return {
		SUBAGENT_TOOL_KEYS: actual.SUBAGENT_TOOL_KEYS,
		withSubagentTools: (t: unknown) => t,
		createSubagentTools: () => ({})
	};
});
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
	resolveChatModel: () => ({ model: {}, modelId: 'test-model', provider: 'test', tier: 'auto', callOptions: {} }),
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

const { env } = await import('$env/dynamic/private');
const { createAgentDmTools } = await import('./agent-dm-tools');
const { processNextQueuedChatJob } = await import('./queue');

/**
 * LE RIPRESE PORTANO SEMPRE UN TESTO PER IL MODELLO (task #38, primo contatto del team).
 *
 * Il primo contatto seminato dal server e `open_session_with_user` accodano un turno di
 * continuazione: la storia finisce sulla riga di apertura firmata, e il provider rifiuta una
 * conversazione che non apre con un turno user — quindi il replay NON può puntare su un
 * prefill assistant. Il suo `user_message` è un testo SOLO PER IL MODELLO (mai salvato, mai
 * mostrato): vuoto, il job è corrotto e muore.
 */
describe('riprese: user_message è solo-per-il-modello, mai vuoto', () => {
	const teamThread = {
		id: 'team-web',
		brand_id: 'brand-1',
		user_id: 'user-1',
		agent: 'web',
		custom_agent_id: null,
		surface: 'team',
		surface_key: 'web',
		title: 'Web Specialist'
	};

	const contactJob = (inputParams: Record<string, unknown>) => ({
		id: 'job-contact-1',
		created_at: new Date().toISOString(),
		brand_id: 'brand-1',
		user_id: 'user-1',
		thread_id: 'team-web',
		tool_name: 'chat_response',
		status: 'pending',
		input_params: inputParams
	});

	const baseParams = {
		user_message: '',
		locale: 'it',
		origin: '',
		queued: true,
		tier: 'auto',
		agent: 'web',
		speaker: 'web',
		continuation: true,
		user_message_saved: true,
		brief: '## TEAM CONTACT TURN (server-side brief)'
	};

	it('un user_message vuoto è un job corrotto anche in replay: muore prima di chiamare il modello', async () => {
		db = makeDb({
			brands: [brandRow],
			chat_threads: [teamThread],
			chat_messages: [
				{ thread_id: 'team-web', role: 'assistant', content: "I'm your Web Specialist.", name: 'web' }
			],
			chat_jobs: [contactJob(baseParams)]
		});

		const res = await processNextQueuedChatJob(db.client as never, '');
		expect(res.error).toBe('missing user_message');
		expect(harnessCalls.length).toBe(0);
	});

	it('con il testo di ripresa il turno GIRA: arriva al modello e NON finisce nel thread', async () => {
		db = makeDb({
			brands: [brandRow],
			chat_threads: [teamThread],
			chat_messages: [
				{ thread_id: 'team-web', role: 'assistant', content: "I'm your Web Specialist.", name: 'web' }
			],
			chat_jobs: [
				contactJob({ ...baseParams, user_message: 'Your opening line is in front of the user. Start now.' })
			]
		});

		const res = await processNextQueuedChatJob(db.client as never, '');
		expect(res.processed).toBe(true);
		expect(harnessCalls.length).toBe(1);

		const { system, messages } = harnessCalls[0];
		expect(system).toContain('TEAM CONTACT TURN');
		// Il testo di ripresa chiude il prompt come turno user (il provider non accetta di
		// APRIRE con un assistant: l'apertura firmata non può fare da prefill).
		expect(String(messages[messages.length - 1].content)).toBe(
			'Your opening line is in front of the user. Start now.'
		);
		// Il testo di ripresa NON è stato salvato nel thread.
		const saved = db.tables.chat_messages.filter((m) => m.thread_id === 'team-web');
		expect(saved).toHaveLength(1);
	});
});

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

const brandRow = { id: 'brand-1', name: 'brand-di-prova', slug: 'abd', plan: 'pro', status: 'active' };

beforeEach(() => {
	// Questo suite copre il motore classico in coda: il bridge kit (sessioni pi-live) non è mockato
	// e il ramo kit del drain resterebbe appeso alla prima sessione.
	env.AGENT_KIT = 'off';
	harnessCalls.length = 0;
	savedAssistant.length = 0;
});

describe('DM end-to-end: message_agent → coda → turno di risposta', () => {
	it('il system prompt APRE col blocco DM, il contenuto porta il mittente, la risposta è firmata', async () => {
		db = makeDb({
			brands: [brandRow],
			chat_threads: [{ id: 'main-1', brand_id: 'brand-1', user_id: 'user-1', agent: null, custom_agent_id: null, title: 'Chat' }]
		});

		// 1) Il tool, per davvero: Anomalia (thread principale, agent null) scrive a Content.
		const tools = createAgentDmTools({
			supabase: db.client as never,
			brandId: 'brand-1',
			userId: 'user-1',
			threadId: 'main-1',
			origin: '', // niente kick HTTP nel test
			locale: 'it'
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = await (tools as any).message_agent.execute({ to: 'content', message: 'ciao' }, {} as never);
		expect(out.success).toBe(true);
		const job = db.tables.chat_jobs[0];
		expect(job.status).toBe('pending');

		// 2) Il drain, per davvero.
		const res = await processNextQueuedChatJob(db.client as never, 'http://localhost:5173');
		expect(res.processed).toBe(true);
		expect(harnessCalls.length).toBe(1);

		const { system, messages } = harnessCalls[0];
		// Il blocco DM governa il turno: sta IN TESTA, prima del prompt di brand.
		expect(system.startsWith('## CHAT PRIVATA TRA AGENTI')).toBe(true);
		expect(system).toContain('Content Creator');
		expect(system).toContain('Anomalia');
		expect(system).toContain('MAI salutare');
		expect(system.indexOf('BASE_PROMPT')).toBeGreaterThan(0);
		// L'identità del mittente sta NEL contenuto che il modello vede — non è "user: ciao".
		// Il tag è una nota al modello: inglese a prescindere dal locale della chat.
		const last = messages[messages.length - 1];
		expect(String(last.content)).toBe(
			'[Message from Anomalia — a fellow AI agent of this brand, NOT the user]: ciao'
		);
		// La risposta è firmata col membro che parla.
		expect(savedAssistant[0]?.opts?.speaker).toBe('content');
	});

	it('provenienza-agnostico: un job SENZA params dm nasce DM comunque, dal marker del thread', async () => {
		db = makeDb({
			brands: [brandRow],
			chat_threads: [
				{
					id: 'dm-1',
					brand_id: 'brand-1',
					user_id: 'user-1',
					agent: null,
					custom_agent_id: null,
					title: 'Anomalia ⇄ Content Creator',
					room_agents: { dm: ['anomalia', 'content'], names: { anomalia: 'Anomalia', content: 'Content Creator' } }
				}
			],
			chat_messages: [
				{
					thread_id: 'dm-1',
					role: 'user',
					content: 'ciao',
					name: 'anomalia',
					superseded: false,
					created_at: new Date().toISOString()
				}
			],
			chat_jobs: [
				{
					id: 'job-bare',
					brand_id: 'brand-1',
					user_id: 'user-1',
					thread_id: 'dm-1',
					tool_name: 'chat_response',
					status: 'pending',
					created_at: new Date().toISOString(),
					// Nessun dm/agent/speaker/brief: solo il messaggio. Il marker basta.
					input_params: { user_message: 'ciao', locale: 'it', origin: '' }
				}
			]
		});

		const res = await processNextQueuedChatJob(db.client as never, 'http://localhost:5173');
		expect(res.processed).toBe(true);
		const { system, messages } = harnessCalls[0];
		expect(system.startsWith('## CHAT PRIVATA TRA AGENTI')).toBe(true);
		// Chi parla è dedotto: il membro che NON ha firmato l'ultimo messaggio user.
		expect(String(messages[messages.length - 1].content)).toContain('[Message from Anomalia');
		expect(savedAssistant[0]?.opts?.speaker).toBe('content');
	});
});
