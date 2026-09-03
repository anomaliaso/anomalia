/**
 * Il finto client non parla con nessun database: è una tabella in memoria che risponde alle
 * stesse chiamate (`from().update().eq().eq().select()`...) di supabase-js, applicando i
 * filtri per davvero — così il compare-and-swap si verifica con lo stesso codice che gira
 * in produzione, non con una risposta preconfezionata che nasconderebbe il bug.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	askUser,
	claimRun,
	claimStale,
	closeRunSaving,
	createRun,
	finish,
	renewLease,
	resume,
	transition,
	type RunRow
} from './run-store';

type Row = Record<string, unknown>;

/**
 * `agent_kit_claim_run` è `returns public.agent_kit_runs`: quando l'UPDATE non prende righe la
 * riga composita esce TUTTA NULL, e PostgREST la consegna come oggetto con ogni colonna a null.
 * Non come `null` — ed è la differenza fra una presa persa e un run fantasma.
 */
function nullComposite(): Row {
	return Object.fromEntries(
		[
			'id',
			'brand_id',
			'thread_id',
			'agent_id',
			'user_id',
			'state',
			'reason',
			'question',
			'lease_until',
			'lease_owner',
			'lease_fence',
			'attempt',
			'heartbeat_at',
			'created_at',
			'updated_at'
		].map((column) => [column, null])
	);
}

function fakeDb(seed: Row[] = []) {
	const rows: Row[] = seed.map((r) => ({ ...r }));
	const calls: Array<{ method: string; args: unknown[] }> = [];

	function from(_table: string) {
		let op: 'select' | 'insert' | 'update' = 'select';
		let payload: Row | undefined;
		const eqFilters: Array<[string, unknown]> = [];
		const ltFilters: Array<[string, unknown]> = [];
		let limitN: number | undefined;

		function apply(): { data: Row[] | null; error: { message: string } | null } {
			let matched = rows;
			for (const [col, val] of eqFilters) matched = matched.filter((r) => r[col] === val);
			for (const [col, val] of ltFilters) matched = matched.filter((r) => (r[col] as string) < (val as string));
			if (op === 'insert' && payload) {
				const row: Row = {
					id: `run-${rows.length + 1}`,
					reason: null,
					question: null,
					lease_until: null,
					heartbeat_at: null,
					thread_id: null,
					user_id: null,
					created_at: '2026-08-21T00:00:00.000Z',
					updated_at: '2026-08-21T00:00:00.000Z',
					...payload
				};
				rows.push(row);
				return { data: [row], error: null };
			}
			if (op === 'update' && payload) {
				for (const r of matched) Object.assign(r, payload);
				return { data: matched, error: null };
			}
			if (limitN !== undefined) matched = matched.slice(0, limitN);
			return { data: matched, error: null };
		}

		const b: Record<string, unknown> = {
			insert(p: Row) {
				calls.push({ method: 'insert', args: [p] });
				op = 'insert';
				payload = p;
				return b;
			},
			update(p: Row) {
				calls.push({ method: 'update', args: [p] });
				op = 'update';
				payload = p;
				return b;
			},
			select(cols?: string) {
				calls.push({ method: 'select', args: [cols] });
				return b;
			},
			eq(col: string, val: unknown) {
				calls.push({ method: 'eq', args: [col, val] });
				eqFilters.push([col, val]);
				return b;
			},
			lt(col: string, val: unknown) {
				calls.push({ method: 'lt', args: [col, val] });
				ltFilters.push([col, val]);
				return b;
			},
			limit(n: number) {
				calls.push({ method: 'limit', args: [n] });
				limitN = n;
				return b;
			},
			single() {
				const { data, error } = apply();
				if (error) return Promise.resolve({ data: null, error });
				if (!data || data.length !== 1) {
					return Promise.resolve({ data: null, error: { message: 'not exactly one row' } });
				}
				return Promise.resolve({ data: data[0], error: null });
			},
			then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
				return Promise.resolve(apply()).then(resolve, reject);
			}
		};
		return b;
	}

	// L'emulazione delle due RPC che governano il lease: la stessa semantica del plpgsql,
	// perché è lì che vive il compare-and-swap che questi test devono provare.
	function rpc(fn: string, params: Record<string, unknown>) {
		calls.push({ method: 'rpc', args: [fn, params] });
		const run = rows.find((r) => r.id === params.p_run_id);

		if (fn === 'agent_kit_claim_run') {
			if (!run) return Promise.resolve({ data: nullComposite(), error: null });
			const openState = ['queued', 'waiting_input', 'waiting_takeover'].includes(run.state as string);
			const expired =
				['running'].includes(run.state as string) &&
				(run.lease_until == null || (run.lease_until as string) <= (params.p_now as string));
			if (!openState && !expired) return Promise.resolve({ data: nullComposite(), error: null });
			run.state = 'running';
			run.lease_owner = params.p_owner;
			run.lease_fence = ((run.lease_fence as number) ?? 0) + 1;
			run.attempt = ((run.attempt as number) ?? 0) + 1;
			run.lease_until = params.p_lease_until;
			run.heartbeat_at = params.p_now;
			return Promise.resolve({ data: { ...run }, error: null });
		}

		if (fn === 'agent_kit_close_run') {
			const held =
				run &&
				run.state === 'running' &&
				run.lease_owner === params.p_owner &&
				run.lease_fence === params.p_fence;
			if (!held) return Promise.resolve({ data: { closed: false }, error: null });
			run.state = params.p_to_state;
			run.reason = params.p_reason ?? null;
			return Promise.resolve({ data: { closed: true, message_id: 'msg-1' }, error: null });
		}

		return Promise.resolve({ data: null, error: { message: `rpc sconosciuta: ${fn}` } });
	}

	return { db: { from, rpc } as unknown as SupabaseClient, rows, calls };
}

const QUEUED = (over: Row = {}): Row => ({ id: 'run-1', brand_id: 'b1', agent_id: 'gtm', state: 'queued', ...over });

describe('createRun', () => {
	it('inserisce una riga queued', async () => {
		const { db } = fakeDb();
		const run = await createRun(db, { brandId: 'b1', agentId: 'gtm', userId: 'u1' });
		expect(run.state).toBe('queued');
		expect(run.brand_id).toBe('b1');
		expect(run.agent_id).toBe('gtm');
	});
});

describe('transition — lecite', () => {
	it('queued → running scrive lo stato e non tocca altri campi a caso', async () => {
		const { db, rows } = fakeDb([QUEUED()]);
		const run = await transition(db, 'run-1', 'queued', 'running');
		expect(run.state).toBe('running');
		expect(rows[0].state).toBe('running');
	});

	it('running → done accetta gli extra (reason)', async () => {
		const { db } = fakeDb([QUEUED({ state: 'running' })]);
		const run = await transition(db, 'run-1', 'running', 'done', { reason: 'completed' });
		expect(run.state).toBe('done');
		expect(run.reason).toBe('completed');
	});
});

describe('transition — illecite', () => {
	it('esplode PRIMA di qualunque scrittura, e nomina i due stati', async () => {
		const { db, calls, rows } = fakeDb([QUEUED({ state: 'done' })]);
		await expect(transition(db, 'run-1', 'done', 'running')).rejects.toThrow(/done.*running|transizione illecita/);
		// il finto non deve aver ricevuto NESSUNA chiamata: assertTransition esplode prima di db.from()
		expect(calls).toHaveLength(0);
		expect(rows[0].state).toBe('done');
	});
});

describe('transition — compare-and-swap', () => {
	it('a 0 righe aggiornate dà l’errore giusto, che nomina "from"', async () => {
		// la riga è già 'running' (qualcun altro l'ha già mossa): l'update .eq('state','queued') non trova nulla
		const { db } = fakeDb([QUEUED({ state: 'running' })]);
		await expect(transition(db, 'run-1', 'queued', 'aborted')).rejects.toThrow(/queued/);
	});
});

describe('askUser / resume', () => {
	it('askUser salva la domanda, resume la restituisce e riporta a running', async () => {
		const { db } = fakeDb([QUEUED({ state: 'running' })]);
		const question = { text: 'Confermi il budget?' };
		const asked = await askUser(db, 'run-1', question);
		expect(asked.state).toBe('waiting_input');
		expect(asked.question).toEqual(question);

		const { run, question: got } = await resume(db, 'run-1');
		expect(run.state).toBe('running');
		expect(got).toEqual(question);
	});

	it('resume rimette il cuore a battere: il run ripreso non è già stantio', async () => {
		// Un run rimasto in waiting_input per ore tornava 'running' col battito vecchio: il reaper
		// dello sweep (heartbeat < now-10') lo abortiva DA VIVO e i guard anti-concorrenza lo
		// vedevano morto, lasciando partire un secondo run sullo stesso thread.
		const stale = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
		const { db } = fakeDb([QUEUED({ state: 'waiting_input', heartbeat_at: stale })]);
		const before = Date.now();
		const { run } = await resume(db, 'run-1');
		expect(run.state).toBe('running');
		expect(Date.parse(run.heartbeat_at as string)).toBeGreaterThanOrEqual(before);
	});

	it('resume da waiting_takeover funziona allo stesso modo', async () => {
		const { db } = fakeDb([QUEUED({ state: 'waiting_takeover' })]);
		const { run } = await resume(db, 'run-1');
		expect(run.state).toBe('running');
	});

	it('resume da uno stato non riprendibile rifiuta', async () => {
		const { db } = fakeDb([QUEUED({ state: 'done' })]);
		await expect(resume(db, 'run-1')).rejects.toThrow(/non riprendibile/);
	});
});

describe('renewLease', () => {
	it('sposta lease_until in avanti e aggiorna heartbeat_at', async () => {
		const { db, rows } = fakeDb([
			QUEUED({ state: 'running', lease_until: null, lease_owner: 'w1', lease_fence: 1 })
		]);
		const before = Date.now();

		expect(await renewLease(db, 'run-1', { owner: 'w1', fence: 1 }, 60_000)).toBe(true);

		expect(new Date(rows[0].lease_until as string).getTime()).toBeGreaterThan(before);
		expect(rows[0].heartbeat_at).toBeTruthy();
	});
});

describe('claimStale', () => {
	it('filtra solo i running col lease scaduto oltre olderThanMs', async () => {
		const now = Date.now();
		const stale = new Date(now - 120_000).toISOString(); // scaduto da 2 minuti
		const fresh = new Date(now + 60_000).toISOString(); // ancora valido
		const { db } = fakeDb([
			QUEUED({ id: 'run-stale', state: 'running', lease_until: stale }),
			QUEUED({ id: 'run-fresh', state: 'running', lease_until: fresh }),
			QUEUED({ id: 'run-queued', state: 'queued', lease_until: stale })
		]);
		const claimable = (await claimStale(db, { olderThanMs: 60_000, limit: 10 })) as RunRow[];
		expect(claimable.map((r) => r.id)).toEqual(['run-stale']);
	});
});

describe('finish', () => {
	it('completed/reply → done', async () => {
		const { db } = fakeDb([QUEUED({ state: 'running' })]);
		const run = await finish(db, 'run-1', 'completed');
		expect(run.state).toBe('done');
		expect(run.reason).toBe('completed');
	});

	it('step_limit/token_budget/deadline → failed', async () => {
		const { db } = fakeDb([QUEUED({ state: 'running' })]);
		const run = await finish(db, 'run-1', 'token_budget');
		expect(run.state).toBe('failed');
	});

	it('aborted → aborted', async () => {
		const { db } = fakeDb([QUEUED({ state: 'running' })]);
		const run = await finish(db, 'run-1', 'aborted');
		expect(run.state).toBe('aborted');
	});

	it('waiting_input non è un finish valido', async () => {
		const { db } = fakeDb([QUEUED({ state: 'running' })]);
		await expect(finish(db, 'run-1', 'waiting_input')).rejects.toThrow(/askUser/);
	});
});

describe('il lease del run: proprietario e fence', () => {
	const seed = (over: Row = {}): Row => ({
		id: 'run-1',
		brand_id: 'b1',
		thread_id: 't1',
		agent_id: 'a1',
		user_id: 'u1',
		state: 'running',
		lease_owner: 'worker-vecchio',
		lease_fence: 3,
		attempt: 1,
		lease_until: '2026-08-30T10:00:00.000Z',
		heartbeat_at: '2026-08-30T09:59:00.000Z',
		...over
	});

	it('il fence cresce a ogni presa, e la presa torna il proprietario nuovo', async () => {
		const { db, rows } = fakeDb([seed()]);

		const claimed = await claimRun(db, 'run-1', 'worker-nuovo', {
			ttlMs: 300_000,
			now: new Date('2026-08-30T10:05:00.000Z')
		});

		expect(claimed?.fence).toBe(4);
		expect(claimed?.run.lease_owner).toBe('worker-nuovo');
		expect(rows[0].attempt).toBe(2);
	});

	it('un lease ancora valido non si porta via: la presa perde e lo dice', async () => {
		const { db, rows } = fakeDb([seed()]);

		const claimed = await claimRun(db, 'run-1', 'worker-nuovo', {
			ttlMs: 300_000,
			now: new Date('2026-08-30T09:59:30.000Z')
		});

		expect(claimed).toBeNull();
		expect(rows[0].lease_owner).toBe('worker-vecchio');
		expect(rows[0].lease_fence).toBe(3);
	});

	it('la riga di NULL che torna dal plpgsql è una presa PERSA, non un run senza id', async () => {
		const rpc = async () => ({
			data: {
				id: null,
				brand_id: null,
				thread_id: null,
				agent_id: null,
				user_id: null,
				state: null,
				lease_owner: null,
				lease_fence: null,
				attempt: null,
				heartbeat_at: null,
				created_at: null,
				updated_at: null
			},
			error: null
		});

		const claimed = await claimRun({ rpc } as unknown as SupabaseClient, 'run-1', 'worker-nuovo', {
			ttlMs: 300_000,
			now: new Date('2026-08-30T10:05:00.000Z')
		});

		expect(claimed).toBeNull();
	});

	it('LO ZOMBIE NON CHIUDE: dopo la presa, il worker sfrattato non salva niente', async () => {
		const { db, rows } = fakeDb([seed()]);
		const vecchio = { owner: 'worker-vecchio', fence: 3 };

		await claimRun(db, 'run-1', 'worker-nuovo', {
			ttlMs: 300_000,
			now: new Date('2026-08-30T10:05:00.000Z')
		});

		const closed = await closeRunSaving(db, 'run-1', { kind: 'finish', reason: 'reply' }, null, vecchio);

		expect(closed.closed).toBe(false);
		expect(rows[0].state).toBe('running');
		expect(rows[0].lease_owner).toBe('worker-nuovo');
	});

	it('chi tiene il lease chiude', async () => {
		const { db, rows } = fakeDb([seed()]);

		const claimed = await claimRun(db, 'run-1', 'worker-nuovo', {
			ttlMs: 300_000,
			now: new Date('2026-08-30T10:05:00.000Z')
		});
		const closed = await closeRunSaving(
			db,
			'run-1',
			{ kind: 'finish', reason: 'reply' },
			null,
			{ owner: 'worker-nuovo', fence: claimed!.fence }
		);

		expect(closed.closed).toBe(true);
		expect(rows[0].state).toBe('done');
	});

	it('il rinnovo con un fence vecchio fallisce invece di tenere in vita un morto', async () => {
		const { db } = fakeDb([seed()]);

		await claimRun(db, 'run-1', 'worker-nuovo', {
			ttlMs: 300_000,
			now: new Date('2026-08-30T10:05:00.000Z')
		});

		expect(await renewLease(db, 'run-1', { owner: 'worker-vecchio', fence: 3 }, 300_000)).toBe(false);
		expect(await renewLease(db, 'run-1', { owner: 'worker-nuovo', fence: 4 }, 300_000)).toBe(true);
	});
});
