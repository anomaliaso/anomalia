import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEffectsLedger, effectKey } from './effects-store';

type Row = Record<string, unknown>;

/** Il finto client parla con una tabella in memoria, applicando i filtri `eq` per davvero. */
function fakeDb(seed: Row[] = []) {
	const rows: Row[] = seed.map((r) => ({ ...r }));

	function from(_table: string) {
		let op: 'select' | 'insert' | 'update' = 'select';
		let payload: Row | undefined;
		const eqFilters: Array<[string, unknown]> = [];
		let insertId = `e-${rows.length + 1}`;

		function apply(): { data: Row[] | null; error: { message: string } | null } {
			let matched = rows;
			for (const [col, val] of eqFilters) matched = matched.filter((r) => r[col] === val);
			if (op === 'insert' && payload) {
				const row: Row = {
					...payload,
					id: insertId,
					created_at: '2026-08-29T00:00:00.000Z',
					updated_at: '2026-08-01T00:00:00.000Z'
				};
				rows.push(row);
				return { data: [row], error: null };
			}
			if (op === 'update' && payload) {
				for (const r of matched) Object.assign(r, payload);
				return { data: matched, error: null };
			}
			return { data: matched, error: null };
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
			select(_cols?: string) {
				return b;
			},
			eq(col: string, val: unknown) {
				eqFilters.push([col, val]);
				return b;
			},
			single() {
				const { data, error } = apply();
				if (error) return Promise.resolve({ data: null, error });
				if (!data || data.length !== 1) return Promise.resolve({ data: null, error: { message: 'not exactly one row' } });
				return Promise.resolve({ data: data[0], error: null });
			},
			maybeSingle() {
				const { data, error } = apply();
				return Promise.resolve({ data: data?.[0] ?? null, error });
			},
			then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
				return Promise.resolve(apply()).then(resolve, reject);
			}
		};
		return b;
	}

	return { db: { from } as unknown as SupabaseClient, rows };
}

const ROW = (over: Row = {}): Row => ({
	id: 'e-1',
	brand_id: 'b1',
	run_id: 'r1',
	tool_name: 'content_schedule',
	idempotency_key: 'k1',
	status: 'intended',
	created_at: '2026-08-29T00:00:00.000Z',
	updated_at: '2026-08-29T00:00:00.000Z',
	...over
});

describe('createEffectsLedger — intend', () => {
	it('registra intended col request e mappa la riga nel ToolEffect', async () => {
		const { db } = fakeDb();
		const ledger = createEffectsLedger(db);
		const effect = await ledger.intend({ brandId: 'b1', runId: 'r1', toolName: 'content_schedule', key: 'k1', request: { post_id: 'p1' } });
		expect(effect.status).toBe('intended');
		expect(effect.brandId).toBe('b1');
		expect(effect.runId).toBe('r1');
		expect(effect.idempotencyKey).toBe('k1');
		expect(effect.request).toEqual({ post_id: 'p1' });
	});
});

describe('createEffectsLedger — find', () => {
	it('la stessa chiave di brand torna la riga esistente', async () => {
		const { db } = fakeDb([ROW({ idempotency_key: 'k1', status: 'completed', result: { ok: true } })]);
		const effect = await createEffectsLedger(db).find('b1', 'k1');
		expect(effect?.status).toBe('completed');
		expect(effect?.result).toEqual({ ok: true });
	});

	it('una chiave diversa torna null', async () => {
		const { db } = fakeDb([ROW({ idempotency_key: 'k1' })]);
		const effect = await createEffectsLedger(db).find('b1', 'k2');
		expect(effect).toBeNull();
	});

	it('un altro brand non condivide la chiave (lo scoping è per brand)', async () => {
		const { db } = fakeDb([ROW({ brand_id: 'b1', idempotency_key: 'k1' })]);
		const effect = await createEffectsLedger(db).find('b2', 'k1');
		expect(effect).toBeNull();
	});
});

describe('createEffectsLedger — resolve', () => {
	it('sposta intended → completed col result', async () => {
		const { db, rows } = fakeDb([ROW({ idempotency_key: 'k1', status: 'intended' })]);
		await createEffectsLedger(db).resolve('e-1', 'completed', { post_id: 'p1' });
		expect(rows[0].status).toBe('completed');
		expect(rows[0].result).toEqual({ post_id: 'p1' });
	});

	it('sposta intended → failed in caso di errore', async () => {
		const { db, rows } = fakeDb([ROW({ idempotency_key: 'k1', status: 'intended' })]);
		await createEffectsLedger(db).resolve('e-1', 'failed', { message: 'net' });
		expect(rows[0].status).toBe('failed');
	});
});

describe('createEffectsLedger — reconcileRun', () => {
	it('tira verso ambiguous solo gli intended del run, mai i completed', async () => {
		const { db, rows } = fakeDb([
			ROW({ id: 'e-1', run_id: 'r1', status: 'intended' }),
			ROW({ id: 'e-2', run_id: 'r1', status: 'completed' }),
			ROW({ id: 'e-3', run_id: 'r2', status: 'intended' })
		]);
		const n = await createEffectsLedger(db).reconcileRun('r1');
		expect(n).toBe(1);
		expect(rows.find((r) => r.id === 'e-1')?.status).toBe('ambiguous');
		expect(rows.find((r) => r.id === 'e-2')?.status).toBe('completed');
		expect(rows.find((r) => r.id === 'e-3')?.status).toBe('intended');
	});
});

describe('effectKey — solo il contratto del key non cambia', () => {
	it('produce una chiave che contiene il nome del tool', () => {
		expect(effectKey('content_schedule', { post_id: 'p1' })).toContain('content_schedule');
	});
});
