/**
 * Il difetto del ramo kit: il turno di setup dell'onboarding girava sul ramo kit (AGENT_KIT=on)
 * che chiudeva il job e tornava PRIMA del blocco `igniteOnboardingTeam` del percorso classico.
 * Il team non contattava mai il nuovo utente: PR #32 restava morta sul motore che in produzione
 * gira davvero. La guardia: a turno kit completato su un thread surface='onboarding', i thread
 * surface='team' di teamContactsForPlan(brand.plan) devono esistere.
 */
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const KIT_TURN_OK = () => new Response(null, { status: 200 });

vi.mock('$env/dynamic/private', () => ({ env: { AGENT_KIT: 'on' } }));
vi.mock('./compaction', () => ({ maybeCompactThread: async () => false }));
vi.mock('$lib/agent/bridge/live', () => ({
	shouldUseKit: () => ({ id: 'analyst' }),
	runKitTurn: vi.fn(async () => KIT_TURN_OK())
}));
vi.mock('./persistence', () => ({
	getThread: vi.fn(async () => ({
		id: 'thread-onboarding',
		agent: 'analyst',
		custom_agent_id: null,
		room_agents: null,
		surface: 'onboarding',
		model: null
	})),
	loadHistory: vi.fn(async () => [{ role: 'user', content: 'crea il mio brand' }]),
	saveMessages: vi.fn(async () => ['m1']),
	renameThread: vi.fn(async () => undefined),
	createThread: vi.fn(async () => null),
	assistantContentFromSteps: () => []
}));
vi.mock('./rate-limits', () => ({
	getChatRateUsage: vi.fn(async () => ({ ok: true })),
	chatCreditsBlocked: vi.fn(async () => false)
}));
vi.mock('$lib/server/hydrate-chat-documents', () => ({ hydrateChatDocuments: vi.fn(async () => []) }));
vi.mock('$lib/server/ai-log', () => ({
	logAiCall: () => undefined,
	extractSdkUsage: () => ({}),
	withBrandContext: (_id: string, fn: () => unknown) => fn()
}));

const TEAM_AGENTS: Record<string, string[]> = {
	content: ['content', 'web', 'motion'],
	web: ['web', 'content', 'motion'],
	motion: ['motion', 'content', 'web'],
	ugc: ['ugc', 'content', 'web'],
	analyst: ['analyst', 'content', 'web'],
	auto: ['auto', 'content', 'web']
};

vi.mock('$lib/server/team-ignition', () => ({
	getOrCreateTeamThread: vi.fn(async (admin: Row, brandId: string, agentId: string) => {
		const table = (admin.tables.chat_threads ??= []);
		const existing = table.find(
			(r: Row) => r.brand_id === brandId && r.surface === 'team' && r.surface_key === agentId
		);
		if (existing) {
			return { threadId: existing.id, userId: 'user-1', locale: 'it', created: false };
		}
		const id = `team-thread-${table.length + 1}`;
		table.push({
			id,
			brand_id: brandId,
			user_id: 'user-1',
			agent: agentId,
			surface: 'team',
			surface_key: agentId,
			locale: 'it'
		});
		return { threadId: id, userId: 'user-1', locale: 'it', created: true };
	})
}));

const { processNextQueuedChatJob } = await import('./queue');
const { teamContactsForPlan } = await import('$lib/server/onboarding-team');

function makeDb(seed: Record<string, Row[]>) {
	const tables: Record<string, Row[]> = {};
	for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

	function build(name: string, mode: 'select' | 'update' | 'insert', patch?: Row) {
		const table = (tables[name] ??= []);
		const filters: Array<(r: Row) => boolean> = [];
		const run = () => {
			if (mode === 'insert' && patch) {
				const row = { id: `${name}-${table.length + 1}`, ...patch };
				table.push(row);
				return [row];
			}
			const hits = table.filter((r) => filters.every((f) => f(r)));
			if (mode === 'update') hits.forEach((r) => Object.assign(r, patch));
			return hits;
		};
		const api: Row = {
			eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
			neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), api),
			in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), api),
			gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), api),
			lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), api),
			is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), api),
			not: () => api,
			order: () => api,
			limit: () => api,
			select: () => api,
			maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
			then: (res?: (v: { data: Row[]; error: null }) => unknown) =>
				Promise.resolve(res ? res({ data: run(), error: null }) : { data: run(), error: null })
		};
		return api;
	}

	return {
		tables,
		client: {
			tables,
			from: (name: string) => ({
				select: () => build(name, 'select'),
				update: (patch: Row) => build(name, 'update', patch),
				insert: (row: Row) => build(name, 'insert', row)
			})
		}
	};
}

describe('il turno kit di setup accende il contatto del team', () => {
	it('a turno completato esistono i thread surface=team per il piano del brand', async () => {
		const db = makeDb({
			chat_jobs: [
				{
					id: 'job-setup',
					brand_id: 'brand-1',
					user_id: 'user-1',
					thread_id: 'thread-onboarding',
					tool_name: 'chat_response',
					status: 'pending',
					created_at: new Date().toISOString(),
					input_params: { user_message: 'crea il mio brand', locale: 'it' }
				}
			],
			chat_threads: [],
			brands: [{ id: 'brand-1', name: 'Bowora', slug: 'bowora', plan: 'pro', status: 'active' }],
			agent_kit_runs: [],
			ai_calls: []
		});

		const res = await processNextQueuedChatJob(db.client as never, '');

		expect(res).toMatchObject({ processed: true, jobId: 'job-setup' });
		const expected = teamContactsForPlan('pro');
		const teamThreads = db.tables.chat_threads.filter((r) => r.surface === 'team');
		expect(new Set(teamThreads.map((r) => r.surface_key))).toEqual(new Set(expected));
		expect(teamThreads.every((r) => TEAM_AGENTS[r.agent]?.includes(r.surface_key))).toBe(true);
	});
});
