/**
 * EMULATORI IN-MEMORY — niente rete, database o VM. Vivono accanto al contratto e non dentro un
 * singolo test, così i mock non si duplicano in ogni file.
 */
import type {
	AdapterContext,
	AdapterDescriptor,
	CommandRequest,
	FileEntry,
	MemoryCapabilities,
	MemoryEntry,
	ProcessEvent,
	SandboxCapabilities,
	SandboxRef,
	ToolCall,
	ToolResult
} from './index';
import type { BrandFs, MemoryStore, SandboxProvider, ToolPlugin } from './index';

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
		tools: [{ name, description: `tool di test per ${name}`, inputSchema: { type: 'object' } }],
		async execute(_call: ToolCall) {
			return reply;
		}
	};
}
