/**
 * IL CONTRATTO — tipi puri. Ciò che deve essere sostituibile è un tipo qui più un'interfaccia in
 * `interfaces.ts`; le implementazioni vivono altrove e ognuna porta il suo emulatore.
 *
 * Zero import di proposito: un contratto che importa un'implementazione non è più un contratto.
 */

/** Chi gira, per conto di chi, su quale brand. Per parametro, mai per globale. */
export interface AdapterContext {
	brandId: string;
	userId: string | null;
	runId: string;
	/** Chiave di continuità della sessione harness: stessa chiave = stessa storia. */
	sessionKey?: string;
	/**
	 * CHI sta lavorando. La macchina è dell'agente (lo schermo `:1` di una VM è uno solo: due
	 * agenti sopra si muovono il puntatore a vicenda), quindi `observe`/`act` devono sapere di chi
	 * è la scrivania su cui atterrano. Assente = la macchina del brand.
	 */
	agentId?: string;
	locale: 'en' | 'it';
	signal?: AbortSignal;
	/** Log strutturato verso ai_calls — l'adapter dichiara, non scrive query. */
	log?: (event: { label: string; detail?: Record<string, unknown> }) => void;
}

export interface AdapterDescriptor<TCapabilities> {
	id: string;
	adapterVersion: string;
	capabilities: TCapabilities;
}

/** Dichiarazione pura: NIENTE handler qui, l'esecuzione sta nell'executor (applyTool). */
export interface ToolSpec {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	/**
	 * La modalità di chat minima che autorizza questo strumento. Assente = non cambia niente,
	 * quindi vive anche dove si può solo leggere.
	 */
	requiresMode?: 'plan' | 'agent';
	terminal?: boolean;
	/**
	 * Il tool ha un effetto collaterale reale (scrive/post/schedula/rende un file): va avvolto dal
	 * ledger, così un resume a metà turno non lo riesegue. Assente = si legge e basta, mai una riga.
	 */
	effectful?: boolean;
}

/** Testo e/o immagini, più un flag d'errore che INSEGNA. */
export type ToolResultContent =
	| { type: 'text'; text: string }
	| { type: 'image'; mimeType: string; base64: string };

export interface ToolResult {
	content: ToolResultContent[];
	isError?: boolean;
}

/** Lo stato di un effetto collaterale nel ledger — la macchina a stati di `agent_kit_effects`. */
export type EffectStatus = 'intended' | 'completed' | 'failed' | 'ambiguous' | 'reconciled';

/** Una riga del ledger degli effetti: chi, cosa, con quale chiave, in che stato. */
export interface ToolEffect {
	id: string;
	brandId: string;
	runId: string | null;
	toolName: string;
	idempotencyKey: string;
	status: EffectStatus;
	request?: unknown;
	result?: unknown;
	createdAt: string;
	updatedAt: string;
}

export interface ToolCall {
	name: string;
	args: Record<string, unknown>;
	/** Id della chiamata sul filo (SDK `toolCallId`). Ancora un artefatto alla chip giusta. */
	id?: string;
}

/** Gli eventi del runtime mentre un run gira: lo streaming è questo, non altro. */
export interface RunTokenUsage {
	inputTokens: number;
	outputTokens: number;
}

export type RunEvent =
	| { type: 'text'; text: string }
	| { type: 'reasoning'; text: string }
	| { type: 'tool_call'; call: ToolCall; id: string }
	| { type: 'tool_result'; id: string; result: ToolResult }
	| { type: 'done'; reason: RunStopReason; usage?: RunTokenUsage }
	| { type: 'error'; message: string };

export type RunStopReason =
	| 'completed' // il modello ha smesso di chiamare strumenti
	| 'reply' // atto esplicito di parlare all'utente
	| 'waiting_input' // il run resta VIVO nel db, non finisce
	| 'step_limit'
	| 'token_budget'
	| 'deadline'
	| 'aborted';

export interface RunRequest {
	runId: string;
	/** Il prompt di sistema INTERO. Tenuto corto per contratto: vedi contracts.ts. */
	system: string;
	messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: unknown }>;
	tools: ToolSpec[];
	model: ModelRef;
	limits: { maxSteps: number; tokenBudget: number; deadlineMs: number };
}

/** Il provider è una chiave di registro, quindi swappabile. */
export interface ModelRef {
	provider: string;
	id: string;
}

export interface CommandRequest {
	command: string;
	cwd?: string;
	timeoutMs?: number;
}

export type ProcessEvent =
	| { type: 'stdout'; data: string }
	| { type: 'stderr'; data: string }
	| { type: 'exit'; code: number };

export interface SandboxRef {
	kind: string;
	name: string;
}

export interface SandboxCapabilities {
	graphical: boolean;
	persistent: boolean;
}

export interface FileEntry {
	path: string;
	kind: 'file' | 'dir';
	size: number;
}

export interface MemoryEntry {
	path: string;
	content: string;
	updatedAt: string;
}

export interface MemoryCapabilities {
	search: boolean;
	maxBytes: number;
}
