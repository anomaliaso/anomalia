/**
 * Ciò che si può sostituire senza toccare il resto: il runtime non sa quale provider parla,
 * l'executor non sa dove gira la shell. Ogni implementazione ha un `*-emulator.ts` accanto, e i
 * test girano su quello.
 *
 * ponytail: solo le interfacce che hanno un'implementazione oggi — una senza è peso, non
 * architettura.
 */
import type {
	AdapterContext,
	AdapterDescriptor,
	CommandRequest,
	EffectStatus,
	FileEntry,
	MemoryCapabilities,
	MemoryEntry,
	ModelRef,
	ProcessEvent,
	RunEvent,
	RunRequest,
	SandboxCapabilities,
	SandboxRef,
	ToolCall,
	ToolEffect,
	ToolResult,
	ToolSpec
} from './types';

/**
 * IL LEDGER DEGLI EFFETTI — il port che l'executor usa per non rieseguire un tool dal un effetto
 * collaterale già avvenuto (o avviato e lasciato ambiguo da un segmento morto). Declarato qui, nel
 * contratto: l'executor non sa dove viva la riga, la superficie gliela passa come implementazione.
 */
export interface EffectsLedger {
	/** Registra `intended` PRIMA di eseguire. Se esiste già la chiave, la restituisce senza toccare. */
	intend(record: { brandId: string; runId: string; toolName: string; key: string; request: unknown }): Promise<ToolEffect>;
	/** Risolve dopo l'esecuzione: completed (con result) o failed. */
	resolve(id: string, status: 'completed' | 'failed', result: unknown): Promise<void>;
	/** Legge per chiave: la riga esistente, o null. */
	find(brandId: string, key: string): Promise<ToolEffect | null>;
	/** Attira gli `intended` orfani di un run morto verso `ambiguous` — il ripiego che non duplica. */
	reconcileRun(runId: string): Promise<number>;
}

/** Chi fa girare il ciclo. Oggi: ai-runtime (SDK v6). */
export interface AgentRuntime {
	describe(): AdapterDescriptor<{ streaming: boolean; tools: boolean }>;
	run(request: RunRequest, context: AdapterContext): AsyncIterable<RunEvent>;
	abort(runId: string): Promise<void>;
}

/**
 * Il punto dove kie/deepseek/gemini/xiaomi diventano UNA cosa: stesso trasporto misurato, stessi
 * errori, stessi retry, invece di SDK per la chat e fetch a mano per i job.
 */
export interface ModelAdapter {
	describe(): AdapterDescriptor<{ vision: boolean; reasoning: boolean }>;
	/** `unknown` per non legare il contratto alla versione dell'SDK. */
	resolve(ref: ModelRef, context: AdapterContext): unknown;
}

export interface SandboxProvider {
	describe(): AdapterDescriptor<SandboxCapabilities>;
	/**
	 * `agentId`: la macchina è dell'AGENTE, non del brand — lo schermo di una VM è uno solo, e due
	 * agenti sopra si muovono il puntatore a vicenda. Senza, è la macchina del brand.
	 * `timeoutMs`: quanto deve restare accesa; senza, quello che decide l'implementazione.
	 */
	provision(
		request: { brandId: string; agentId?: string; timeoutMs?: number },
		context: AdapterContext
	): Promise<SandboxRef>;
	execute(
		sandbox: SandboxRef,
		request: CommandRequest,
		context: AdapterContext
	): AsyncIterable<ProcessEvent>;
	listFiles(sandbox: SandboxRef, path: string, context: AdapterContext): Promise<FileEntry[]>;
	readFile(sandbox: SandboxRef, path: string, context: AdapterContext): Promise<Uint8Array>;
	writeFile(
		sandbox: SandboxRef,
		path: string,
		content: Uint8Array,
		context: AdapterContext
	): Promise<void>;
	stop(sandbox: SandboxRef, context: AdapterContext): Promise<void>;
}

/**
 * Dove va il workspace quando la VM si ferma davvero, e da dove torna al risveglio. `path` è
 * opaco: lo store lo sceglie, computer.ts lo salva e lo ripassa senza mai interpretarlo.
 */
export interface CheckpointStore {
	describe(): AdapterDescriptor<{ maxFileBytes: number; maxFiles: number }>;
	save(brandId: string, ref: SandboxRef, context: AdapterContext): Promise<string>;
	restore(brandId: string, path: string, ref: SandboxRef, context: AdapterContext): Promise<void>;
}

export interface MemoryStore {
	describe(): AdapterDescriptor<MemoryCapabilities>;
	read(brandId: string, agentId: string, context: AdapterContext): Promise<MemoryEntry[]>;
	commit(
		brandId: string,
		agentId: string,
		entry: { path: string; content: string },
		context: AdapterContext
	): Promise<void>;
}

/**
 * L'albero dei file del brand: non un filesystem vero, una proiezione del database (brand/,
 * work/, market/, how/). Stessa interfaccia, così l'executor non vede la differenza.
 */
export interface BrandFs {
	describe(): AdapterDescriptor<{ writable: boolean }>;
	list(path: string, recursive: boolean, context: AdapterContext): Promise<FileEntry[]>;
	read(path: string, context: AdapterContext): Promise<string>;
	grep(pattern: string, path: string | null, context: AdapterContext): Promise<string>;
	write?(path: string, content: string, context: AdapterContext): Promise<void>;
}

/**
 * Come i tool di prodotto si agganciano SENZA entrare nel catalogo builtin: dichiarazione ed
 * esecuzione nello stesso oggetto, montato per mestiere dal registro.
 */
export interface ToolPlugin {
	name: string;
	tools: ToolSpec[];
	execute(call: ToolCall, context: AdapterContext): Promise<ToolResult>;
}
