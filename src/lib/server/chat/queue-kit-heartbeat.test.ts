/**
 * B10 del registro di parità: il ramo kit del drain reclamava la riga `chat_jobs` e poi non la
 * toccava più per tutta la durata del turno. Dopo 90 secondi `reapStaleChatJobs` la dichiarava
 * morta, la marcava `failed` e avvisava gli ops mentre il turno girava benissimo; la pagina del
 * thread, che legge l'ultimo job fallito, mostrava banner d'errore e «riprova» su un turno vivo.
 * E il ramo esiste proprio per le CONTINUAZIONI, che durano minuti per costruzione.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHAT_HEARTBEAT_INTERVAL_MS } from './turn-limits';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let enteredKitTurn = false;
let releaseKitTurn: (() => void) | null = null;

// La compattazione parla con tabelle che questo finto database non conosce (scrive il riassunto):
// qui si misura il BATTITO, non lei. Che venga chiamata nel punto giusto lo pinna kit-parity.test.
vi.mock('./compaction', () => ({ maybeCompactThread: async () => false }));
vi.mock('$env/dynamic/private', () => ({ env: { AGENT_KIT: 'on' } }));
vi.mock('$lib/agent/bridge/live', () => ({
	shouldUseKit: () => ({ id: 'content' }),
	runKitTurn: vi.fn(
		() =>
			new Promise((resolve) => {
				enteredKitTurn = true;
				releaseKitTurn = () => resolve(new Response(null, { status: 200 }));
			})
	)
}));
vi.mock('./persistence', () => ({
	getThread: vi.fn(async () => ({
		id: 'thread-1',
		agent: 'content',
		custom_agent_id: null,
		room_agents: null
	})),
	loadHistory: vi.fn(async () => [{ role: 'user', content: 'continua' }]),
	saveMessages: vi.fn(async () => ['m1']),
	renameThread: vi.fn(async () => undefined),
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

const { processNextQueuedChatJob } = await import('./queue');

function makeDb(seed: Record<string, Row[]>) {
	const tables: Record<string, Row[]> = {};
	for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

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
			from: (name: string) => ({
				select: () => build(name, 'select'),
				update: (patch: Row) => build(name, 'update', patch)
			})
		}
	};
}

async function until(condition: () => boolean, tries = 2000): Promise<void> {
	for (let i = 0; i < tries && !condition(); i++) await Promise.resolve();
}

describe('il ramo kit del drain batte mentre lavora', () => {
	it('la riga chat_jobs resta viva per tutto il turno: il reaper non la trova mai ferma', async () => {
		const db = makeDb({
			chat_jobs: [
				{
					id: 'job-1',
					brand_id: 'brand-1',
					user_id: 'user-1',
					thread_id: 'thread-1',
					tool_name: 'chat_response',
					status: 'pending',
					created_at: new Date().toISOString(),
					input_params: { user_message: 'continua', continuation: true, locale: 'it' }
				}
			],
			brands: [{ id: 'brand-1', name: 'Brand', slug: 'brand', plan: 'pro', status: 'active' }],
			agent_kit_runs: [],
			ai_calls: []
		});

		vi.useFakeTimers();
		try {
			const drain = processNextQueuedChatJob(db.client as never, 'https://app.example');
			await until(() => enteredKitTurn);
			expect(enteredKitTurn).toBe(true);

			const claimedAt = Number(db.tables.chat_jobs[0].partial?.at);
			expect(claimedAt).toBeGreaterThan(0);

			await vi.advanceTimersByTimeAsync(3 * CHAT_HEARTBEAT_INTERVAL_MS);
			expect(Number(db.tables.chat_jobs[0].partial?.at)).toBeGreaterThan(claimedAt);

			releaseKitTurn?.();
			await expect(drain).resolves.toMatchObject({ processed: true, jobId: 'job-1' });
		} finally {
			vi.useRealTimers();
		}
	});
});
