import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEffectsLedger, effectKey } from './effects-store';

type Row = Record<string, unknown>;

function fakeDb(seed: Row[] = []) {
	const rows: Row[] = seed.map((row) => ({ ...row }));

	function from(_table: string) {
		let op: 'select' | 'insert' | 'update' = 'select';
		let payload: Row | undefined;
		const filters: Array<[string, unknown]> = [];
		const nullFilters: Array<[string, unknown]> = [];

		function apply(): { data: Row[] | null; error: { code?: string; message: string } | null } {
			let matched = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
			matched = matched.filter((row) => nullFilters.every(([column, value]) => (row[column] ?? null) === value));
			if (op === 'insert' && payload) {
				if (
					payload.invocation_id != null &&
					rows.some((row) => row.brand_id === payload?.brand_id && row.invocation_id === payload?.invocation_id)
				) {
					return { data: null, error: { code: '23505', message: 'duplicate key' } };
				}
				const row: Row = {
					id: `e-${rows.length + 1}`,
					created_at: '2026-08-29T00:00:00.000Z',
					updated_at: '2026-08-29T00:00:00.000Z',
					...payload
				};
				rows.push(row);
				return { data: [row], error: null };
			}
			if (op === 'update' && payload) {
				for (const row of matched) Object.assign(row, payload);
				return { data: matched, error: null };
			}
			return { data: matched, error: null };
		}

		const builder: Record<string, unknown> = {
			insert(value: Row) {
				op = 'insert';
				payload = value;
				return builder;
			},
			update(value: Row) {
				op = 'update';
				payload = value;
				return builder;
			},
			select() {
				return builder;
			},
			eq(column: string, value: unknown) {
				filters.push([column, value]);
				return builder;
			},
			is(column: string, value: unknown) {
				nullFilters.push([column, value]);
				return builder;
			},
			maybeSingle() {
				const result = apply();
				return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
			},
			then(resolve: (value: unknown) => void, reject?: (error: unknown) => void) {
				return Promise.resolve(apply()).then(resolve, reject);
			}
		};
		return builder;
	}

	return { db: { from } as unknown as SupabaseClient, rows };
}

const RECORD = {
	brandId: 'b1',
	runId: 'r1',
	invocationId: 'call-1',
	toolName: 'content_schedule',
	request: { post_id: 'p1' }
};

const ROW = (over: Row = {}): Row => ({
	id: 'e-1',
	brand_id: 'b1',
	run_id: 'r1',
	tool_name: 'content_schedule',
	invocation_id: 'call-1',
	idempotency_key: null,
	status: 'intended',
	request: { post_id: 'p1' },
	result: null,
	created_at: '2026-08-29T00:00:00.000Z',
	updated_at: '2026-08-29T00:00:00.000Z',
	...over
});

describe('createEffectsLedger — claim', () => {
	it('registra l’identità stabile e il payload prima dell’esecuzione', async () => {
		const { db } = fakeDb();
		const claim = await createEffectsLedger(db).claim(RECORD);

		expect(claim.kind).toBe('claimed');
		expect(claim.effect.invocationId).toBe('call-1');
		expect(claim.effect.request).toEqual({ post_id: 'p1' });
	});

	it('due claim concorrenti della stessa identità ne autorizzano uno solo', async () => {
		const { db } = fakeDb();
		const ledger = createEffectsLedger(db);
		const claims = await Promise.all([ledger.claim(RECORD), ledger.claim({ ...RECORD, runId: 'r2' })]);

		expect(claims.filter((claim) => claim.kind === 'claimed')).toHaveLength(1);
		expect(claims.filter((claim) => claim.kind === 'existing')).toHaveLength(1);
	});

	it('due identità nuove con args identici hanno due righe', async () => {
		const { db, rows } = fakeDb();
		const ledger = createEffectsLedger(db);
		await ledger.claim(RECORD);
		await ledger.claim({ ...RECORD, invocationId: 'call-2', runId: 'r2' });

		expect(rows).toHaveLength(2);
	});

	it('la stessa identità con payload diverso è un mismatch', async () => {
		const { db } = fakeDb();
		const ledger = createEffectsLedger(db);
		await ledger.claim(RECORD);

		const claim = await ledger.claim({ ...RECORD, request: { post_id: 'p2' } });

		expect(claim.kind).toBe('mismatch');
	});

	it('il resume di un run legacy continua a riconoscere la riga congelata', async () => {
		const { db, rows } = fakeDb([
			ROW({ invocation_id: null, idempotency_key: effectKey(RECORD.toolName, RECORD.request), status: 'completed' })
		]);
		const ledger = createEffectsLedger(db);

		const claim = await ledger.claim({ ...RECORD, invocationId: 'call-new', legacyKey: effectKey(RECORD.toolName, RECORD.request) });

		expect(claim.kind).toBe('existing');
		expect(rows).toHaveLength(1);
	});

	it('una riga legacy di un run diverso non blocca una nuova identità', async () => {
		const { db, rows } = fakeDb([
			ROW({
				run_id: 'run-old',
				invocation_id: null,
				idempotency_key: effectKey(RECORD.toolName, RECORD.request),
				status: 'completed'
			})
		]);
		const ledger = createEffectsLedger(db);

		const claim = await ledger.claim({ ...RECORD, runId: 'run-new', invocationId: 'call-new', legacyKey: effectKey(RECORD.toolName, RECORD.request) });

		expect(claim.kind).toBe('claimed');
		expect(rows).toHaveLength(2);
	});
});

describe('createEffectsLedger — lifecycle', () => {
	it('un worker tardivo non sovrascrive ambiguous', async () => {
		const { db, rows } = fakeDb();
		const ledger = createEffectsLedger(db);
		const claim = await ledger.claim(RECORD);

		await ledger.reconcileRun(RECORD.runId);
		const resolved = await ledger.resolve(claim.effect.id, 'completed', { ok: true });

		expect(resolved).toBe(false);
		expect(rows[0].status).toBe('ambiguous');
	});

	it('un failed può essere reclamato di nuovo dalla stessa identità', async () => {
		const { db } = fakeDb();
		const ledger = createEffectsLedger(db);
		const first = await ledger.claim(RECORD);
		await ledger.resolve(first.effect.id, 'failed', { message: 'network' });

		const retry = await ledger.claim({ ...RECORD, runId: 'r2' });

		expect(retry.kind).toBe('claimed');
	});
});

describe('effectKey — compatibilità legacy', () => {
	it('conserva la forma della vecchia chiave per le righe esistenti', () => {
		expect(effectKey('content_schedule', { post_id: 'p1' })).toContain('content_schedule');
	});
});
