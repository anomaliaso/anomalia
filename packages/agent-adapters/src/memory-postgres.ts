/**
 * `MemoryStore` sopra `brand_memory`: `loadMemoryEntries`/`writeMemory` portano già tutta la
 * semantica (rinforzo invece di duplicazione, scoping per agente, cap sulle skill), qui si
 * traduce solo la riga in `MemoryEntry`. Arrivano come deps perché `packages/` non può importare
 * `$lib/server/*` (vedi `packages/no-app-imports.test.ts`), e il client Supabase entra dal
 * costruttore perché l'interfaccia del kit non ne porta uno.
 *
 * `path` è `categoria/chiave` e non un percorso vero: `brand_memory` ha `category` + `key`.
 *
 * `MAX_ENTRY_BYTES` è disciplina nostra, non un CHECK della tabella, e si applica PRIMA di
 * `writeMemory`: una voce troppo grande non tocca mai il database.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, AdapterDescriptor, MemoryCapabilities, MemoryEntry as KitMemoryEntry } from '@anomalia/agent-kit/types';
import type { MemoryStore } from '@anomalia/agent-kit/interfaces';

/** Per singola voce, in byte UTF-8. */
export const MAX_ENTRY_BYTES = 32 * 1024;

const CATEGORIES = ['voice', 'constraint', 'fact', 'preference', 'insight', 'skill'] as const;
export type MemoryCategory = (typeof CATEGORIES)[number];

function isCategory(s: string): s is MemoryCategory {
	return (CATEGORIES as readonly string[]).includes(s);
}

/** `categoria/chiave` → i due campi di `brand_memory`. */
export function parseMemoryPath(path: string): { category: MemoryCategory; key: string } {
	const slash = path.indexOf('/');
	if (slash < 0) throw new Error(`memory-postgres: path '${path}' non ha una chiave — atteso 'categoria/chiave'`);
	const category = path.slice(0, slash);
	const key = path.slice(slash + 1);
	if (!key) throw new Error(`memory-postgres: path '${path}' non ha una chiave — atteso 'categoria/chiave'`);
	if (!isCategory(category)) {
		throw new Error(`memory-postgres: categoria '${category}' sconosciuta — attese: ${CATEGORIES.join(', ')}`);
	}
	return { category, key };
}

/** La stessa riga di `loadMemoryEntries` (brand-memory.ts) — ridichiarata, non importata. */
export interface BrandMemoryRow {
	category: string;
	key: string;
	value: string;
	updated_at: string;
}

export interface MemoryPostgresDeps {
	loadMemoryEntries: (
		supabase: SupabaseClient,
		brandId: string,
		opts: { agent: string | null }
	) => Promise<BrandMemoryRow[]>;
	writeMemory: (
		supabase: SupabaseClient,
		brandId: string,
		// 'chat' è l'unico `source` che `commit()` passa: il letterale evita di ridichiarare
		// l'intera union `MemorySource` di brand-memory.ts per un solo membro.
		entry: { category: MemoryCategory; key: string; value: string; source: 'chat'; agent?: string }
	) => Promise<unknown>;
}

function toKitEntry(row: BrandMemoryRow): KitMemoryEntry {
	return {
		path: `${row.category}/${row.key}`,
		content: `# ${row.key}\n\n${row.value}`,
		updatedAt: row.updated_at
	};
}

export class PostgresMemoryStore implements MemoryStore {
	constructor(
		private readonly supabase: SupabaseClient,
		private readonly deps: MemoryPostgresDeps
	) {}

	describe(): AdapterDescriptor<MemoryCapabilities> {
		return { id: 'memory-postgres', adapterVersion: '1', capabilities: { search: false, maxBytes: MAX_ENTRY_BYTES } };
	}

	async read(brandId: string, agentId: string, _context: AdapterContext): Promise<KitMemoryEntry[]> {
		// Stringa vuota = solo il brand (come `agent: null` nel modulo wrappato); un id = brand +
		// quell'agente, mai i colleghi.
		const rows = await this.deps.loadMemoryEntries(this.supabase, brandId, { agent: agentId ? agentId : null });
		return rows.map(toKitEntry);
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
				`memory-postgres: voce '${entry.path}' di ${bytes} byte supera il tetto di ${MAX_ENTRY_BYTES} byte (32KB)`
			);
		}
		const { category, key } = parseMemoryPath(entry.path);
		await this.deps.writeMemory(this.supabase, brandId, {
			category,
			key,
			value: entry.content,
			source: 'chat',
			agent: agentId || undefined
		});
	}
}
