/**
 * Il finto database, multi-tabella: stessa idea di run-store.test.ts (una tabella in memoria che
 * risponde alle chiamate reali di supabase-js, filtri applicati per davvero), estesa a `.in()` e
 * `.upsert()` perché computer.ts le usa entrambe e agent_kit_runs è una seconda tabella, non una.
 * Il provider e lo store sono i VERI emulatori del kit (`SandboxEmulator`,
 * `createCheckpointEmulator`): niente VM, niente rete, ma la stessa forma di produzione.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureComputer, touchComputer, markComputerRunning, sleepIdleComputers, sandboxIdleMs, DEFAULT_SANDBOX_IDLE_MS } from './computer';
import { SandboxEmulator } from '@anomalia/agent-adapters/sandbox-emulator';
import { createCheckpointEmulator } from '@anomalia/agent-adapters/checkpoint-emulator';
import type { AdapterContext, SandboxRef } from '@anomalia/agent-kit/types';

const ctx: AdapterContext = { brandId: 'b1', userId: null, runId: 'test', locale: 'it' };

type Row = Record<string, unknown>;

function fakeDb(seed: Record<string, Row[]> = {}) {
	const tables: Record<string, Row[]> = {};
	for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));

	function from(table: string) {
		if (!tables[table]) tables[table] = [];
		const rows = tables[table];
		let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
		let payload: Row | undefined;
		let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | undefined;
		const eqFilters: Array<[string, unknown]> = [];
		const ltFilters: Array<[string, unknown]> = [];
		const inFilters: Array<[string, unknown[]]> = [];
		let limitN: number | undefined;

		function matched(): Row[] {
			let m = rows;
			for (const [col, val] of eqFilters) m = m.filter((r) => r[col] === val);
			for (const [col, val] of ltFilters) m = m.filter((r) => (r[col] as string) < (val as string));
			for (const [col, vals] of inFilters) m = m.filter((r) => vals.includes(r[col]));
			if (limitN !== undefined) m = m.slice(0, limitN);
			return m;
		}

		function apply(): { data: Row[] | null; error: { message: string } | null } {
			if (op === 'insert' && payload) {
				const row: Row = { id: `row-${rows.length + 1}`, created_at: 'x', updated_at: 'x', ...payload };
				rows.push(row);
				return { data: [row], error: null };
			}
			if (op === 'upsert' && payload) {
				const conflictCol = upsertOpts?.onConflict ?? 'id';
				const existing = rows.find((r) => r[conflictCol] === (payload as Row)[conflictCol]);
				if (existing) {
					if (!upsertOpts?.ignoreDuplicates) Object.assign(existing, payload);
					return { data: [existing], error: null };
				}
				const row: Row = {
					id: `row-${rows.length + 1}`,
					state: 'stopped',
					provider_ref: null,
					last_touch_at: null,
					checkpoint_path: null,
					created_at: 'x',
					updated_at: 'x',
					...payload
				};
				rows.push(row);
				return { data: [row], error: null };
			}
			if (op === 'update' && payload) {
				const m = matched();
				for (const r of m) Object.assign(r, payload);
				return { data: m, error: null };
			}
			return { data: matched(), error: null };
		}

		const b: Record<string, unknown> = {
			insert(p: Row) {
				op = 'insert';
				payload = p;
				return b;
			},
			upsert(p: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
				op = 'upsert';
				payload = p;
				upsertOpts = opts;
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
			in(col: string, vals: unknown[]) {
				inFilters.push([col, vals]);
				return b;
			},
			lt(col: string, val: unknown) {
				ltFilters.push([col, val]);
				return b;
			},
			limit(n: number) {
				limitN = n;
				return b;
			},
			single() {
				const { data, error } = apply();
				if (error) return Promise.resolve({ data: null, error });
				if (!data || data.length !== 1) return Promise.resolve({ data: null, error: { message: 'not exactly one row' } });
				return Promise.resolve({ data: data[0], error: null });
			},
			then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
				return Promise.resolve(apply()).then(resolve, reject);
			}
		};
		return b;
	}

	return { db: { from } as unknown as SupabaseClient, tables };
}

const OLD = new Date('2026-01-01T00:00:00.000Z').toISOString();
const NOW = new Date('2026-01-01T01:00:00.000Z'); // un'ora dopo: oltre qualunque idle di default

function computerRow(over: Row = {}): Row {
	// `agent_id: ''` è la macchina del brand, quella senza agente dietro: dal 26/8 le righe sono
	// una per (brand, agente) e il filtro passa sempre da qui.
	return { id: 'c1', brand_id: 'b1', agent_id: '', provider_ref: null, state: 'stopped', last_touch_at: null, checkpoint_path: null, ...over };
}

describe('ensureComputer', () => {
	it('provisiona, e da stopped-con-checkpoint ripristina i file prima di segnare running', async () => {
		const sandbox = new SandboxEmulator();
		const home = createCheckpointEmulator(sandbox);
		// Un checkpoint "salvato ieri": lo si semina direttamente nell'emulatore dello store.
		home.saved.set('b1/42', new Map([['note.txt', new TextEncoder().encode('ciao dal checkpoint')]]));
		const { db, tables } = fakeDb({
			agent_computers: [computerRow({ state: 'stopped', checkpoint_path: 'b1/42', provider_ref: 'emu-b1' })]
		});

		const ref = await ensureComputer({ db, sandbox, home }, 'b1', ctx);

		expect(ref).toEqual({ kind: 'sandbox-emulator', name: 'emu-b1' });
		expect(sandbox.files.get('work/note.txt')).toBe('ciao dal checkpoint');
		expect(tables.agent_computers[0].state).toBe('running');
		expect(tables.agent_computers[0].provider_ref).toBe('emu-b1');
	});

	it('già running: NON ripristina di nuovo sopra il lavoro in corso', async () => {
		const sandbox = new SandboxEmulator();
		const home = createCheckpointEmulator(sandbox);
		home.saved.set('b1/old', new Map([['note.txt', new TextEncoder().encode('vecchio')]]));
		await sandbox.provision({ brandId: 'b1' }, ctx);
		sandbox.files.set('work/note.txt', 'lavoro in corso, non toccare');
		const { db } = fakeDb({
			agent_computers: [computerRow({ state: 'running', checkpoint_path: 'b1/old', provider_ref: 'emu-b1' })]
		});

		await ensureComputer({ db, sandbox, home }, 'b1', ctx);

		expect(sandbox.files.get('work/note.txt')).toBe('lavoro in corso, non toccare');
	});
});

describe('touchComputer', () => {
	it('sposta last_touch_at in avanti', async () => {
		const { db, tables } = fakeDb({ agent_computers: [computerRow({ state: 'running', last_touch_at: OLD })] });
		await touchComputer({ db }, 'b1');
		expect(new Date(tables.agent_computers[0].last_touch_at as string).getTime()).toBeGreaterThan(new Date(OLD).getTime());
	});
});

describe('markComputerRunning', () => {
	it('una riga assente nasce running col ref dato, senza provision né checkpoint', async () => {
		const { db, tables } = fakeDb({});
		await markComputerRunning({ db }, 'b1', 'anomalia-b1-research-g2');
		expect(tables.agent_computers[0].state).toBe('running');
		expect(tables.agent_computers[0].provider_ref).toBe('anomalia-b1-research-g2');
		expect(tables.agent_computers[0].last_touch_at).toBeTruthy();
	});

	it('una riga stopped torna running e il ref segue la macchina viva', async () => {
		const { db, tables } = fakeDb({ agent_computers: [computerRow({ state: 'stopped' })] });
		await markComputerRunning({ db }, 'b1', 'anomalia-b1-research-g3');
		expect(tables.agent_computers[0].state).toBe('running');
		expect(tables.agent_computers[0].provider_ref).toBe('anomalia-b1-research-g3');
	});
});


describe('sleepIdleComputers', () => {
	it('idle scaduto, nessun run attivo → checkpoint + stop vero', async () => {
		const sandbox = new SandboxEmulator();
		const ref = await sandbox.provision({ brandId: 'b1' }, ctx);
		sandbox.files.set('work/note.txt', 'hello\n');
		const home = createCheckpointEmulator(sandbox);
		const { db, tables } = fakeDb({
			agent_computers: [computerRow({ state: 'running', last_touch_at: OLD, provider_ref: ref.name })],
			agent_kit_runs: []
		});

		const report = await sleepIdleComputers({ db, sandbox, home }, NOW);

		expect(report).toEqual({ stopped: ['b1'], skippedActive: [], errors: [] });
		expect(tables.agent_computers[0].state).toBe('stopped');
		expect(tables.agent_computers[0].checkpoint_path).toBeTruthy();
		const saved = home.saved.get(tables.agent_computers[0].checkpoint_path as string);
		expect(saved?.get('note.txt')).toEqual(new TextEncoder().encode('hello\n'));
		// stop() vero: la VM non è più "provisionata" in questo processo.
		await expect(async () => {
			for await (const _e of sandbox.execute(ref, { command: 'echo hi' }, ctx)) void _e;
		}).rejects.toThrow(/non provisionata/);
	});

	it('idle scaduto MA run attivo → resta accesa, il touch riprogramma il sonno', async () => {
		const sandbox = new SandboxEmulator();
		const ref = await sandbox.provision({ brandId: 'b1' }, ctx);
		const home = createCheckpointEmulator(sandbox);
		const { db, tables } = fakeDb({
			agent_computers: [computerRow({ state: 'running', last_touch_at: OLD, provider_ref: ref.name })],
			agent_kit_runs: [{ id: 'r1', brand_id: 'b1', state: 'running' }]
		});

		const report = await sleepIdleComputers({ db, sandbox, home }, NOW);

		expect(report).toEqual({ stopped: [], skippedActive: ['b1'], errors: [] });
		expect(tables.agent_computers[0].state).toBe('running'); // mai toccata

		// Il touch — indipendente dal sweep — è quello che davvero riprogramma il prossimo giro:
		// dopo un touch la riga non è più "scaduta" per un cutoff vicino ad adesso.
		await touchComputer({ db }, 'b1');
		const cutoff = new Date(NOW.getTime() - 1000);
		expect(new Date(tables.agent_computers[0].last_touch_at as string).getTime()).toBeGreaterThan(cutoff.getTime());
	});

	it('una VM rotta non blocca il giro sulle altre', async () => {
		const sandbox = new SandboxEmulator();
		const refA = await sandbox.provision({ brandId: 'a' }, ctx);
		const refB = await sandbox.provision({ brandId: 'b' }, ctx);
		const home = createCheckpointEmulator(sandbox);
		const realStop = sandbox.stop.bind(sandbox);
		sandbox.stop = async (ref: SandboxRef, c: AdapterContext) => {
			if (ref.name === refA.name) throw new Error('VM rotta, la API risponde 500');
			return realStop(ref, c);
		};
		const { db, tables } = fakeDb({
			agent_computers: [
				computerRow({ id: 'ca', brand_id: 'a', state: 'running', last_touch_at: OLD, provider_ref: refA.name }),
				computerRow({ id: 'cb', brand_id: 'b', state: 'running', last_touch_at: OLD, provider_ref: refB.name })
			],
			agent_kit_runs: []
		});

		const report = await sleepIdleComputers({ db, sandbox, home }, NOW);

		expect(report.stopped).toEqual(['b']);
		expect(report.errors).toEqual([{ brandId: 'a', message: 'VM rotta, la API risponde 500' }]);
		expect(tables.agent_computers.find((r) => r.brand_id === 'a')?.state).toBe('running'); // non aggiornata: lo stop è fallito
		expect(tables.agent_computers.find((r) => r.brand_id === 'b')?.state).toBe('stopped');
	});

	it('nessuna riga scaduta: nessuno stop, report vuoto', async () => {
		const sandbox = new SandboxEmulator();
		const home = createCheckpointEmulator(sandbox);
		const fresh = new Date(NOW.getTime() - 1000).toISOString(); // ancora dentro l'idle di default
		const { db } = fakeDb({ agent_computers: [computerRow({ state: 'running', last_touch_at: fresh })], agent_kit_runs: [] });

		const report = await sleepIdleComputers({ db, sandbox, home }, NOW);
		expect(report).toEqual({ stopped: [], skippedActive: [], errors: [] });
	});
});

describe('sandboxIdleMs', () => {
	const original = process.env.SANDBOX_IDLE_MS;
	afterEach(() => {
		if (original === undefined) delete process.env.SANDBOX_IDLE_MS;
		else process.env.SANDBOX_IDLE_MS = original;
	});
	beforeEach(() => {
		delete process.env.SANDBOX_IDLE_MS;
	});

	it('default: 10 minuti', () => {
		expect(sandboxIdleMs()).toBe(DEFAULT_SANDBOX_IDLE_MS);
		expect(DEFAULT_SANDBOX_IDLE_MS).toBe(10 * 60 * 1000);
	});

	it('rispetta l\'override valido', () => {
		process.env.SANDBOX_IDLE_MS = '60000';
		expect(sandboxIdleMs()).toBe(60_000);
	});

	it('sotto il pavimento (30s) o non-numerico: ignora l\'override, torna al default', () => {
		process.env.SANDBOX_IDLE_MS = '1000';
		expect(sandboxIdleMs()).toBe(DEFAULT_SANDBOX_IDLE_MS);
		process.env.SANDBOX_IDLE_MS = 'not-a-number';
		expect(sandboxIdleMs()).toBe(DEFAULT_SANDBOX_IDLE_MS);
	});
});


describe('lo sweep con una macchina per agente', () => {
	it('spegne SOLO la riga scaduta, non tutte quelle del brand', async () => {
		const sandbox = new SandboxEmulator();
		const home = createCheckpointEmulator(sandbox);
		const { db, tables } = fakeDb({
			agent_computers: [
				computerRow({ id: 'c-motion', agent_id: 'motion', state: 'running', last_touch_at: OLD, provider_ref: 'vm-motion' }),
				computerRow({ id: 'c-web', agent_id: 'web', state: 'running', last_touch_at: NOW.toISOString(), provider_ref: 'vm-web' })
			]
		});

		await sleepIdleComputers({ db, sandbox, home }, NOW);

		expect(tables.agent_computers.find((r) => r.agent_id === 'motion')?.state).toBe('stopped');
		// Prima della correzione questa era 'stopped' anche lei: l'update filtrava solo sul brand,
		// e un agente inattivo portava a dormire quello che stava lavorando.
		expect(tables.agent_computers.find((r) => r.agent_id === 'web')?.state).toBe('running');
	});
});
