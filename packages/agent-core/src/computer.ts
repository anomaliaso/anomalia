/**
 * La VM del brand SEMBRA sempre accesa: dopo `sandboxIdleMs()` senza uso e senza run attivo si
 * ferma per davvero (`stop()` sta in adapters/vercel-sandbox.ts, con la nota su perché è sicuro
 * chiamarlo da qui), col workspace salvato fuori. Al prossimo `ensureComputer` torna su e i file
 * tornano con lei. La riga `agent_computers` è la sorgente di verità dello stato.
 *
 * ponytail: un run `waiting_input`/`waiting_takeover` NON tiene accesa la macchina — aspetta una
 * persona che può non tornare per ore. Se servirà una sessione viva mentre aspetta un umano, si
 * aggiunge un conteggio dedicato.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, SandboxRef } from '@anomalia/agent-kit/types';
import type { CheckpointStore, SandboxProvider } from '@anomalia/agent-kit/interfaces';

const TABLE = 'agent_computers';

/**
 * Una riga per (brand, agente). La macchina «senza agente» — i lavori che un agente dietro non ce
 * l'hanno — è quella con `agent_id = ''`: una stringa vuota si confronta con `=` come tutte le
 * altre, mentre un NULL avrebbe voluto `is null` in ogni lettura e `nulls not distinct` sull'indice.
 */
type RowFilter = { eq(column: string, value: unknown): RowFilter };

function rowQuery<T>(query: T, brandId: string, agentId?: string): T {
	// Il cast è sul FILTRO, non sul risultato: i generici di supabase-js su una catena di `.eq()`
	// esplodono in «type instantiation is excessively deep», e qui serve solo che esista `.eq`.
	return (query as RowFilter).eq('brand_id', brandId).eq('agent_id', agentId ?? '') as T;
}
const RUNS_TABLE = 'agent_kit_runs';
/** Solo questi due contano come "brand al lavoro" — vedi la nota in testa al file. */
const ACTIVE_RUN_STATES = ['queued', 'running'] as const;

export const DEFAULT_SANDBOX_IDLE_MS = 10 * 60 * 1000;

/** Override da env, pavimento 30s — sotto quella soglia non è idle, è un bug. */
export function sandboxIdleMs(): number {
	const raw = Number(process.env.SANDBOX_IDLE_MS ?? DEFAULT_SANDBOX_IDLE_MS);
	return Number.isFinite(raw) && raw >= 30_000 ? raw : DEFAULT_SANDBOX_IDLE_MS;
}

export interface ComputerDeps {
	/** Client admin (service role): le scritture su agent_computers non passano da RLS. */
	db: SupabaseClient;
	sandbox: SandboxProvider;
	home: CheckpointStore;
}

type ComputerRow = {
	id: string;
	brand_id: string;
	/** Di chi è la macchina; stringa vuota = quella del brand, senza un agente dietro. */
	agent_id: string;
	provider_ref: string | null;
	state: 'stopped' | 'running' | 'error';
	last_touch_at: string | null;
	checkpoint_path: string | null;
};

function nowIso(): string {
	return new Date().toISOString();
}

/** Il contesto di chi fa girare il sweep — non è un run, non ha un runId vero da riusare. */
function sweepContext(brandId: string): AdapterContext {
	return { brandId, userId: null, runId: 'computer-sweep', locale: 'it' };
}

/**
 * `upsert` con `ignoreDuplicates` e non insert-e-cattura-il-conflitto: due `ensureComputer`
 * concorrenti producono comunque UNA riga (unique su `brand_id`), e il peggio che resta è un
 * `provision()` idempotente chiamato due volte — non serve un claim a due fasi.
 */
async function getOrCreateRow(db: SupabaseClient, brandId: string, agentId?: string): Promise<ComputerRow> {
	const { error: upsertErr } = await db
		.from(TABLE)
		.upsert({ brand_id: brandId, agent_id: agentId ?? '' }, { onConflict: 'brand_id,agent_id', ignoreDuplicates: true });
	if (upsertErr) throw new Error(`computer: upsert riga fallito — ${upsertErr.message}`);
	const { data, error } = await rowQuery(db.from(TABLE).select(), brandId, agentId).single();
	if (error) throw new Error(`computer: lettura riga fallita — ${error.message}`);
	return data as ComputerRow;
}

/**
 * `provision()` si rifà SEMPRE, anche su una VM già running: senza, l'handle del provider in
 * questo processo serverless (nuovo a ogni invocazione) non esisterebbe e ogni
 * `execute`/`readFile`/`writeFile` fallirebbe con "non è provisionata in questo processo".
 * Costa poco: `Sandbox.getOrCreate` la ritrova per nome invece di riaccenderla.
 */
export async function ensureComputer(
	deps: ComputerDeps,
	brandId: string,
	ctx: AdapterContext,
	/** Di chi è la macchina. Senza, è quella del brand: una sola, come prima. */
	agentId?: string
): Promise<SandboxRef> {
	const row = await getOrCreateRow(deps.db, brandId, agentId);
	const wasRunning = row.state === 'running';
	const ref = await deps.sandbox.provision({ brandId, agentId }, ctx);
	// Restore SOLO al risveglio da uno stop vero: su una VM già running riscriverebbe il lavoro
	// in corso col checkpoint di ieri.
	if (!wasRunning && row.checkpoint_path) {
		await deps.home.restore(brandId, row.checkpoint_path, ref, ctx);
	}
	const { error } = await rowQuery(
		deps.db
			.from(TABLE)
			.update({ state: 'running', provider_ref: ref.name, last_touch_at: nowIso(), updated_at: nowIso() }),
		brandId,
		agentId
	);
	if (error) throw new Error(`computer: attivazione riga fallita — ${error.message}`);
	return ref;
}

/** Riprogramma il sonno spostando `last_touch_at` in avanti. */
export async function touchComputer(
	deps: Pick<ComputerDeps, 'db'>,
	brandId: string,
	agentId?: string
): Promise<void> {
	const { error } = await rowQuery(
		deps.db.from(TABLE).update({ last_touch_at: nowIso(), updated_at: nowIso() }),
		brandId,
		agentId
	);
	if (error) throw new Error(`computer: touch fallito — ${error.message}`);
}

export async function markComputerRunning(
	deps: Pick<ComputerDeps, 'db'>,
	brandId: string,
	refName: string,
	agentId?: string
): Promise<void> {
	const stamp = nowIso();
	const { data, error } = await rowQuery(
		deps.db
			.from(TABLE)
			.update({ state: 'running', provider_ref: refName, last_touch_at: stamp, updated_at: stamp }),
		brandId,
		agentId
	).select('id');
	if (error) throw new Error(`computer: pubblicazione fallita — ${error.message}`);
	if (data && data.length > 0) return;
	const { error: insErr } = await deps.db
		.from(TABLE)
		.insert({ brand_id: brandId, agent_id: agentId ?? '', state: 'running', provider_ref: refName, last_touch_at: stamp });
	if (insErr) throw new Error(`computer: creazione riga fallita — ${insErr.message}`);
}

async function hasActiveRun(db: SupabaseClient, brandId: string): Promise<boolean> {
	const { data, error } = await db
		.from(RUNS_TABLE)
		.select('id')
		.eq('brand_id', brandId)
		.in('state', ACTIVE_RUN_STATES as unknown as string[])
		.limit(1);
	if (error) throw new Error(`computer: verifica run attivi fallita — ${error.message}`);
	return Boolean(data && data.length > 0);
}

export type SweepReport = {
	stopped: string[];
	/** Scaduti ma con un run attivo: lasciati accesi. */
	skippedActive: string[];
	errors: Array<{ brandId: string; message: string }>;
};

/**
 * Ogni riga `running` scaduta e senza run attivo va a checkpoint + stop. Una computer rotta non
 * blocca le altre: l'errore si raccoglie nel report e il giro continua.
 */
export async function sleepIdleComputers(deps: ComputerDeps, now: Date = new Date()): Promise<SweepReport> {
	const cutoff = new Date(now.getTime() - sandboxIdleMs()).toISOString();
	const { data, error } = await deps.db.from(TABLE).select().eq('state', 'running').lt('last_touch_at', cutoff);
	if (error) throw new Error(`computer: ricerca inattive fallita — ${error.message}`);
	const rows = (data ?? []) as ComputerRow[];

	const report: SweepReport = { stopped: [], skippedActive: [], errors: [] };
	for (const row of rows) {
		try {
			if (await hasActiveRun(deps.db, row.brand_id)) {
				report.skippedActive.push(row.brand_id);
				continue;
			}
			const ctx = sweepContext(row.brand_id);
			// `kind` da describe() e non da un letterale: qui non si sa quale provider c'è dietro.
			const ref: SandboxRef = { kind: deps.sandbox.describe().id, name: row.provider_ref ?? '' };
			const checkpointPath = await deps.home.save(row.brand_id, ref, ctx);
			await deps.sandbox.stop(ref, ctx);
			// Per (brand, AGENTE): filtrare solo sul brand portava a dormire tutte le macchine del
			// brand perché ne era scaduta una — compreso l'agente che in quel momento lavorava.
			const { error: updErr } = await rowQuery(
				deps.db.from(TABLE).update({ state: 'stopped', checkpoint_path: checkpointPath, updated_at: nowIso() }),
				row.brand_id,
				row.agent_id || undefined
			);
			if (updErr) throw new Error(`aggiornamento riga fallito — ${updErr.message}`);
			report.stopped.push(row.brand_id);
		} catch (e) {
			report.errors.push({ brandId: row.brand_id, message: e instanceof Error ? e.message : String(e) });
		}
	}
	return report;
}
