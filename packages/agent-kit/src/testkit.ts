/**
 * EMULATORI IN-MEMORY — niente rete, database o VM. Vivono accanto al contratto e non dentro un
 * singolo test, così i mock non si duplicano in ogni file.
 */
import type {
	AdapterContext,
	AdapterDescriptor,
	CommandRequest,
	EffectsLedger,
	FileEntry,
	MemoryCapabilities,
	MemoryEntry,
	ProcessEvent,
	SandboxCapabilities,
	SandboxRef,
	ToolCall,
	ToolEffect,
	ToolResult
} from './index';
import type { BrandFs, MemoryStore, SandboxProvider, ToolPlugin } from './index';

const INTENDED_STATUS: ToolEffect['status'] = 'intended';
const FAILED_STATUS: ToolEffect['status'] = 'failed';

export function fakeContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
	return {
		brandId: 'brand-test',
		userId: 'user-test',
		runId: 'run-test',
		locale: 'it',
		...overrides
	};
}

export function createMemoryBrandFs(
	files: Record<string, string> = {},
	opts: { writable?: boolean } = {}
): BrandFs {
	const store = new Map(Object.entries(files));
	const writable = opts.writable ?? true;
	return {
		describe: (): AdapterDescriptor<{ writable: boolean }> => ({
			id: 'memory-fs',
			adapterVersion: '0',
			capabilities: { writable }
		}),
		async list(path, recursive): Promise<FileEntry[]> {
			const prefix = path === '/' || path === '' ? '' : path.replace(/\/$/, '') + '/';
			const entries: FileEntry[] = [];
			for (const [p, content] of store) {
				if (!p.startsWith(prefix)) continue;
				const rest = p.slice(prefix.length);
				if (!recursive && rest.includes('/')) continue;
				entries.push({ path: p, kind: 'file', size: content.length });
			}
			return entries;
		},
		async read(path) {
			const content = store.get(path);
			if (content === undefined) throw new Error(`read: '${path}' non esiste`);
			return content;
		},
		async grep(pattern, path) {
			const re = new RegExp(pattern);
			const lines: string[] = [];
			for (const [p, content] of store) {
				if (path && !p.startsWith(path)) continue;
				content.split('\n').forEach((line, i) => {
					if (re.test(line)) lines.push(`${p}:${i + 1}:${line}`);
				});
			}
			return lines.join('\n');
		},
		...(writable
			? {
					async write(path: string, content: string) {
						store.set(path, content);
					}
				}
			: {})
	};
}

/** `execute` restituisce sempre gli eventi passati in input, qualunque sia il comando. */
export function createMemorySandbox(scriptedEvents: ProcessEvent[] = [{ type: 'exit', code: 0 }]): SandboxProvider {
	return {
		describe: (): AdapterDescriptor<SandboxCapabilities> => ({
			id: 'memory-sandbox',
			adapterVersion: '0',
			capabilities: { graphical: false, persistent: false }
		}),
		async provision() {
			return { kind: 'memory', name: 'test' };
		},
		async *execute(_sandbox: SandboxRef, _request: CommandRequest) {
			for (const event of scriptedEvents) yield event;
		},
		async listFiles() {
			return [];
		},
		async readFile() {
			return new Uint8Array();
		},
		async writeFile() {
			/* no-op */
		},
		async stop() {
			/* no-op */
		}
	};
}

export function createMemoryStore(): MemoryStore & { entries: MemoryEntry[] } {
	const entries: MemoryEntry[] = [];
	return {
		entries,
		describe: (): AdapterDescriptor<MemoryCapabilities> => ({
			id: 'memory-store',
			adapterVersion: '0',
			capabilities: { search: false, maxBytes: 1_000_000 }
		}),
		async read() {
			return entries;
		},
		async commit(_brandId, _agentId, entry) {
			entries.push({ ...entry, updatedAt: new Date().toISOString() });
		}
	};
}

/** Risponde a un solo nome: serve a verificare la risoluzione per nome. */
export function fakePlugin(name: string, reply: ToolResult): ToolPlugin {
	return {
		name: `plugin-${name}`,
		tools: [{ name, description: `tool di test per ${name}`, effectful: false, consequential: false, inputSchema: { type: 'object' } }],
		async execute(_call: ToolCall) {
			return reply;
		}
	};
}

/**
 * IL LEDGER IN MEMORIA per i test del gate: claim/resolve/reconcileRun su una mappa per
 * (brand, invocationId). Così il gate dell'executor si verifica senza montare un database.
 */
export function createMemoryEffectsLedger(seed: { [key: string]: unknown } = {}): EffectsLedger & { rows: ToolEffect[] } {
	const rows: ToolEffect[] = [];

	for (const [status, request] of Object.entries(seed)) {
		rows.push({
			id: `e-${rows.length + 1}`,
			brandId: 'brand-test',
			runId: 'run-test',
			toolName: 'content_schedule',
			invocationId: 'seed',
			status: status as ToolEffect['status'],
			request: request as unknown,
			result: null,
			createdAt: '2026-08-29T00:00:00.000Z',
			updatedAt: '2026-08-29T00:00:00.000Z'
		});
	}

	return {
		rows,
		async claim(record) {
			const existing = rows.find((r) => r.brandId === record.brandId && r.invocationId === record.invocationId);
			if (existing) {
				if (existing.toolName !== record.toolName || stableSerialize(existing.request) !== stableSerialize(record.request)) {
					return { kind: 'mismatch', effect: existing };
				}
				if (existing.status === FAILED_STATUS) {
					existing.runId = record.runId;
					existing.status = 'intended';
					existing.result = null;
					return { kind: 'claimed', effect: existing };
				}
				return { kind: 'existing', effect: existing };
			}
			const effect: ToolEffect = {
				id: `e-${rows.length + 1}`,
				brandId: record.brandId,
				runId: record.runId,
				toolName: record.toolName,
				invocationId: record.invocationId,
				status: INTENDED_STATUS,
				request: record.request,
				result: null,
				createdAt: '2026-08-29T00:00:00.000Z',
				updatedAt: '2026-08-29T00:00:00.000Z'
			};
			rows.push(effect);
			return { kind: 'claimed', effect };
		},
		async resolve(id, status, result) {
			const effect = rows.find((r) => r.id === id);
			if (effect?.status === INTENDED_STATUS) {
				effect.status = status;
				effect.result = result;
				effect.updatedAt = '2026-08-29T00:00:00.000Z';
				return true;
			}
			return false;
		},
		async reconcileRun(runId) {
			let n = 0;
			for (const r of rows) {
				if (r.runId === runId && r.status === 'intended') {
					r.status = 'ambiguous';
					n += 1;
				}
			}
			return n;
		}
	};
}

function stableSerialize(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableSerialize).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

/** Sempre avanti rispetto all'orologio: una data scritta a mano invecchia e diventa passato. */
export function aDateInTheFuture(): string {
	return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
