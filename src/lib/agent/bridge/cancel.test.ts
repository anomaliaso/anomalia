import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const savedMessages: Array<{ threadId: string; content: Array<Record<string, unknown>> }> = [];
vi.mock('$lib/server/chat/persistence', async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		saveMessages: async (
			_supabase: unknown,
			_brandId: string,
			_userId: string,
			messages: Array<{ content: unknown }>,
			threadId: string
		) => {
			savedMessages.push({ threadId, content: messages[0].content as Array<Record<string, unknown>> });
			return ['saved-1'];
		}
	};
});

const { cancelKitRun } = await import('./cancel');

type Row = Record<string, unknown>;

/** Applica DAVVERO il filtro `.in('state', …)`: è il claim, e un claim che non filtra non è un claim. */
function fakeDb(rows: Row[]) {
	const table = rows.map((r) => ({ ...r }));
	function from(_name: string) {
		let payload: Row = {};
		const filters: Array<(r: Row) => boolean> = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const api: any = {
			update: (p: Row) => ((payload = p), api),
			eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
			in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), api),
			select: () => api,
			then(resolve: (v: { data: Row[]; error: null }) => unknown) {
				const matched = table.filter((r) => filters.every((f) => f(r)));
				const before = matched.map((r) => ({ ...r }));
				for (const r of matched) Object.assign(r, payload);
				return Promise.resolve(resolve({ data: before, error: null }));
			}
		};
		return api;
	}
	return { table, client: { from } as unknown as SupabaseClient };
}

beforeEach(() => {
	savedMessages.length = 0;
});

describe('cancelKitRun', () => {
	it('porta il run vivo su `aborted`: è il segnale che il turno, su un’altra invocazione, rilegge', async () => {
		const db = fakeDb([{ id: 'run-1', thread_id: 't1', brand_id: 'b1', user_id: 'u1', state: 'running', partial: null }]);

		expect(await cancelKitRun(db.client, db.client, 't1')).toBe(true);
		expect(db.table[0].state).toBe('aborted');
	});

	it('un run già chiuso non si riapre e non produce messaggi: il claim lo perde', async () => {
		const db = fakeDb([
			{ id: 'run-1', thread_id: 't1', brand_id: 'b1', user_id: 'u1', state: 'done', partial: { text: 'fatto' } }
		]);

		expect(await cancelKitRun(db.client, db.client, 't1')).toBe(false);
		expect(savedMessages).toHaveLength(0);
	});

	it('Stop ≠ cancella: quello che era già arrivato resta nel thread, tool call comprese', async () => {
		const db = fakeDb([
			{
				id: 'run-1',
				thread_id: 't1',
				brand_id: 'b1',
				user_id: 'u1',
				state: 'running',
				partial: {
					text: 'sto leggendo il piano',
					tools: [{ toolCallId: 'c1', toolName: 'read_editorial_plan', input: { week: 0 }, textLen: 21 }]
				}
			}
		]);

		await cancelKitRun(db.client, db.client, 't1');

		const parts = savedMessages[0]?.content ?? [];
		expect(parts.some((p) => p.type === 'text' && String(p.text).includes('sto leggendo il piano'))).toBe(true);
		const call = parts.find((p) => p.type === 'tool-call');
		expect(call?.toolName).toBe('read_editorial_plan');
		expect(call?.input).toEqual({ week: 0 });
	});

	it('il marcatore di onFinish vince: niente seconda bolla per un turno già salvato', async () => {
		const db = fakeDb([
			{
				id: 'run-1',
				thread_id: 't1',
				brand_id: 'b1',
				user_id: 'u1',
				state: 'running',
				partial: { text: 'ecco' },
				partial_saved_msg_id: 'msg-9'
			}
		]);

		await cancelKitRun(db.client, db.client, 't1');

		expect(db.table[0].state).toBe('aborted');
		expect(savedMessages).toHaveLength(0);
	});
});
