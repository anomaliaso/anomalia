/**
 * `chat_jobs` è CIECO ai run del kit: runKitTurn non scrive mai una riga lì. Questi test pinnano
 * i guard nati dal bug del 24/8 (due run concorrenti sullo stesso thread dopo un refresh o un
 * reinvio): il criterio di vitalità — la stessa soglia di 10' del reaper dello sweep — e il
 * drain che non deve claimare un job legacy sotto un run kit vivo.
 */
import { describe, expect, it } from 'vitest';
import { threadHasActiveKitRun, processNextQueuedChatJob } from './queue';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Stesso finto client di queue-credits.test.ts: una tabella in memoria che applica i filtri. */
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
		} as unknown as SupabaseClient
	};
}

const kitRun = (over: Row = {}): Row => ({
	id: 'run-1',
	thread_id: 'thread-1',
	state: 'running',
	heartbeat_at: null,
	created_at: new Date().toISOString(),
	...over
});

describe('threadHasActiveKitRun — vivo = dentro la soglia del reaper (CHAT_HEARTBEAT_STALE_MS)', () => {
	it('run running col battito fresco → true', async () => {
		const db = makeDb({ agent_kit_runs: [kitRun({ heartbeat_at: new Date().toISOString() })] });
		expect(await threadHasActiveKitRun(db.client, 'thread-1')).toBe(true);
	});

	it('run mai battuto ma nato da poco → true (un modello può pensare a lungo prima del primo tool)', async () => {
		const db = makeDb({ agent_kit_runs: [kitRun()] });
		expect(await threadHasActiveKitRun(db.client, 'thread-1')).toBe(true);
	});

	it('zombie (battito fermo da >10 minuti) → false: non blocca, lo chiude il reaper', async () => {
		const stale = new Date(Date.now() - 11 * 60_000).toISOString();
		const db = makeDb({ agent_kit_runs: [kitRun({ heartbeat_at: stale, created_at: stale })] });
		expect(await threadHasActiveKitRun(db.client, 'thread-1')).toBe(false);
	});

	it('battito fermo da 2 minuti → false: la soglia è quella del classico (90s), non dieci minuti', async () => {
		const stale = new Date(Date.now() - 2 * 60_000).toISOString();
		const db = makeDb({ agent_kit_runs: [kitRun({ heartbeat_at: stale, created_at: stale })] });
		expect(await threadHasActiveKitRun(db.client, 'thread-1')).toBe(false);
	});

	it('battito di 30 secondi fa → true: un turno che lavora non viene mai dichiarato morto', async () => {
		const beat = new Date(Date.now() - 30_000).toISOString();
		const db = makeDb({ agent_kit_runs: [kitRun({ heartbeat_at: beat, created_at: beat })] });
		expect(await threadHasActiveKitRun(db.client, 'thread-1')).toBe(true);
	});

	it('nessun run, o run su un altro thread → false', async () => {
		const db = makeDb({ agent_kit_runs: [kitRun({ thread_id: 'altro' })] });
		expect(await threadHasActiveKitRun(db.client, 'thread-1')).toBe(false);
	});
});

describe('processNextQueuedChatJob — il drain non parte sotto un run kit vivo', () => {
	it('lascia il job pending finché il run kit batte (mutazione pinnata: senza il guard lo claimava)', async () => {
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
					input_params: { user_message: 'e i numeri?', locale: 'it' }
				}
			],
			agent_kit_runs: [kitRun({ heartbeat_at: new Date().toISOString() })]
		});

		const res = await processNextQueuedChatJob(db.client, 'https://app.example');

		expect(res).toEqual({ processed: false });
		expect(db.tables.chat_jobs[0].status).toBe('pending'); // mai claimato, riprova al giro dopo
	});
});
