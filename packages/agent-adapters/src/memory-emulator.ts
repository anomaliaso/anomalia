/**
 * `MemoryStore` in-memory: stesso tetto e stessa forma di `path` di `memory-postgres.ts`, zero
 * database. La costante è duplicata di proposito — un emulatore che dipende dall'adapter vero è
 * un secondo adapter, non un emulatore.
 */
import type { AdapterContext, AdapterDescriptor, MemoryCapabilities, MemoryEntry as KitMemoryEntry } from '@anomalia/agent-kit/types';
import type { MemoryStore } from '@anomalia/agent-kit/interfaces';

/** Lo stesso tetto di `memory-postgres.ts` — in byte UTF-8. */
export const MAX_ENTRY_BYTES = 32 * 1024;

export class MemoryEmulator implements MemoryStore {
	/** brandId → agentId ('' = il brand) → path → voce. Pubblico: i test seminano e ispezionano. */
	readonly store = new Map<string, Map<string, Map<string, KitMemoryEntry>>>();

	describe(): AdapterDescriptor<MemoryCapabilities> {
		return { id: 'memory-emulator', adapterVersion: '1', capabilities: { search: false, maxBytes: MAX_ENTRY_BYTES } };
	}

	async read(brandId: string, agentId: string, _context: AdapterContext): Promise<KitMemoryEntry[]> {
		const byAgent = this.store.get(brandId);
		if (!byAgent) return [];
		// Brand + quell'agente, mai i colleghi: la regola di lettura di brand-memory.ts.
		const scopes = agentId ? ['', agentId] : [''];
		const out: KitMemoryEntry[] = [];
		for (const scope of scopes) {
			for (const entry of byAgent.get(scope)?.values() ?? []) out.push(entry);
		}
		return out;
	}

	async commit(
		brandId: string,
		agentId: string,
		entry: { path: string; content: string },
		_context: AdapterContext
	): Promise<void> {
		const bytes = new TextEncoder().encode(entry.content).length;
		if (bytes > MAX_ENTRY_BYTES) {
			throw new Error(
				`memory-emulator: voce '${entry.path}' di ${bytes} byte supera il tetto di ${MAX_ENTRY_BYTES} byte (32KB)`
			);
		}
		const scope = agentId || '';
		if (!this.store.has(brandId)) this.store.set(brandId, new Map());
		const byAgent = this.store.get(brandId)!;
		if (!byAgent.has(scope)) byAgent.set(scope, new Map());
		byAgent.get(scope)!.set(entry.path, {
			path: entry.path,
			content: entry.content,
			updatedAt: new Date().toISOString()
		});
	}
}
