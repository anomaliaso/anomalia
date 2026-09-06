/**
 * `chat_jobs` porta DUE riferimenti al tenant che viaggiano separati: `brand_id` e `thread_id`. La
 * policy di insert (0044) confronta col chiamante solo il primo e `user_id`, e il drain gira col
 * service role — quindi una riga con la coppia sbagliata farebbe lavorare il turno su un brand e
 * scrivere su un thread di un altro.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

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
			is: () => api,
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

function db(threadBrandId: string) {
	return makeDb({
		chat_jobs: [
			{
				id: 'job-1',
				brand_id: 'brand-mio',
				user_id: 'user-1',
				thread_id: 'thread-1',
				tool_name: 'chat_response',
				status: 'pending',
				created_at: new Date().toISOString(),
				input_params: { user_message: 'ciao', locale: 'it' }
			}
		],
		chat_threads: [{ id: 'thread-1', brand_id: threadBrandId, user_id: 'user-1' }],
		brands: [{ id: 'brand-mio', name: 'Brand', slug: 'brand', plan: 'pro', status: 'active' }],
		ai_calls: []
	});
}

describe('processNextQueuedChatJob — la coppia brand/thread', () => {
	it('non lavora su un thread che non è del brand del job', async () => {
		const fake = db('brand-altrui');

		const res = await processNextQueuedChatJob(fake.client as never, 'https://app.example');

		expect(res).toMatchObject({ processed: true, jobId: 'job-1', error: 'thread_not_in_brand' });
		expect(fake.tables.chat_jobs[0].status).toBe('failed');
	});

	it('lavora quando la coppia regge', async () => {
		const fake = db('brand-mio');

		const res = await processNextQueuedChatJob(fake.client as never, 'https://app.example');

		expect(res.error).not.toBe('thread_not_in_brand');
	});
});
