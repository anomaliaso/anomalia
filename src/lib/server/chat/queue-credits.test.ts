/**
 * Il drain dei turni accodati, fermato dove costa: a crediti finiti il job muore PRIMA del modello
 * (prima non c'era nessun gate su questo percorso) e, se il turno l'aveva acceso una schedulazione,
 * l'errore risale a `custom_agent_schedules.last_error` — che restava null e mostrava verde un
 * agente le cui run erano morte tutte.
 */
import { describe, expect, it, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

// Solo il gate è finto: il resto del modulo crediti resta quello vero, o `instanceof` mente.
vi.mock('$lib/server/credits', async (importActual) => {
	const actual = await importActual<typeof import('$lib/server/credits')>();
	const now = new Date();
	return {
		...actual,
		gateCredits: async () => {
			throw new actual.CreditsExhaustedError({
				used: 100,
				quota: 100,
				bonus: 0,
				remaining: 0,
				periodStart: now,
				periodEnd: now,
				percent: 100
			});
		}
	};
});

import { processNextQueuedChatJob } from './queue';

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
		}
	};
}

describe('processNextQueuedChatJob — crediti finiti', () => {
	it('non esegue il turno e scrive last_error sulla schedulazione che lo ha acceso', async () => {
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
					input_params: { user_message: 'fai il report', scheduled: true, locale: 'it' }
				}
			],
			brands: [{ id: 'brand-1', name: 'Brand', slug: 'brand', plan: 'pro', status: 'active' }],
			ai_calls: [],
			custom_agent_schedules: [
				{ id: 'sched-1', brand_id: 'brand-1', last_job_id: 'job-1', last_error: null, enabled: true }
			]
		});

		const res = await processNextQueuedChatJob(db.client as never, 'https://app.example');

		expect(res).toMatchObject({ processed: true, jobId: 'job-1', error: 'credits_exhausted' });
		expect(db.tables.chat_jobs[0].status).toBe('failed');
		expect(db.tables.chat_jobs[0].error).toBe('credits_exhausted');
		// Il pezzo che mancava: l'agente programmato smette di sembrare sano.
		expect(db.tables.custom_agent_schedules[0].last_error).toBe('credits_exhausted');
		expect(db.tables.custom_agent_schedules[0].enabled).toBe(true); // i crediti tornano da soli
	});
});
