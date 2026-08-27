import { describe, expect, it, vi } from 'vitest';
import type { AdapterContext } from '@anomalia/agent-kit/types';
import { PostgresMemoryStore, MAX_ENTRY_BYTES, parseMemoryPath, type BrandMemoryRow, type MemoryPostgresDeps } from './memory-postgres';

/**
 * `PostgresMemoryStore` PROVATO CON `loadMemoryEntries`/`writeMemory` FINTI — il comportamento
 * REALE di quelle due funzioni (la query su `brand_memory`, il rinforzo, lo scoping per agente) è
 * già coperto da `brand-memory.test.ts` nell'app (14 test); qui si prova SOLO la traduzione che
 * questo adapter fa sopra (path ↔ categoria/chiave, il tetto di 32KB), con deps canned.
 */
const ctx: AdapterContext = { brandId: 'b1', userId: 'u1', runId: 'r1', locale: 'it' };
const fakeSupabase = {} as never;

function deps(overrides: Partial<MemoryPostgresDeps> = {}): MemoryPostgresDeps {
	return {
		loadMemoryEntries: async () => [],
		writeMemory: async () => undefined,
		...overrides
	};
}

describe('parseMemoryPath', () => {
	it('divide categoria/chiave', () => {
		expect(parseMemoryPath('voice/tono')).toEqual({ category: 'voice', key: 'tono' });
	});

	it('rifiuta una categoria che brand_memory non conosce', () => {
		expect(() => parseMemoryPath('inventata/chiave')).toThrow(/categoria/);
	});

	it('rifiuta un path senza chiave', () => {
		expect(() => parseMemoryPath('voice')).toThrow(/chiave/);
	});
});

describe('PostgresMemoryStore', () => {
	it('describe() dichiara il tetto di 32KB', () => {
		const store = new PostgresMemoryStore(fakeSupabase, deps());
		expect(store.describe().capabilities.maxBytes).toBe(MAX_ENTRY_BYTES);
		expect(MAX_ENTRY_BYTES).toBe(32 * 1024);
	});

	it('read() mappa le righe di brand_memory in MemoryEntry con path = categoria/chiave', async () => {
		const rows: BrandMemoryRow[] = [
			{ category: 'voice', key: 'tono', value: 'Diretto, mai formale.', updated_at: '2026-01-02T00:00:00Z' }
		];
		const store = new PostgresMemoryStore(fakeSupabase, deps({ loadMemoryEntries: async () => rows }));
		const out = await store.read('b1', '', ctx);
		expect(out).toEqual([
			{ path: 'voice/tono', content: '# tono\n\nDiretto, mai formale.', updatedAt: '2026-01-02T00:00:00Z' }
		]);
	});

	it('commit() oltre 32KB rifiuta nominando il tetto, senza chiamare writeMemory', async () => {
		const writeMemory = vi.fn(async () => undefined);
		const store = new PostgresMemoryStore(fakeSupabase, deps({ writeMemory }));
		const big = 'x'.repeat(MAX_ENTRY_BYTES + 1);
		await expect(store.commit('b1', '', { path: 'fact/troppo_grande', content: big }, ctx)).rejects.toThrow(
			/32.?768|32KB|tetto/i
		);
		expect(writeMemory).not.toHaveBeenCalled();
	});

	it('commit() sotto il tetto chiama writeMemory con categoria/chiave giuste', async () => {
		const writeMemory = vi.fn(async () => undefined);
		const store = new PostgresMemoryStore(fakeSupabase, deps({ writeMemory }));

		await store.commit('b1', '', { path: 'fact/sede', content: 'Sede a Milano.' }, ctx);

		expect(writeMemory).toHaveBeenCalledTimes(1);
		expect(writeMemory).toHaveBeenCalledWith(
			fakeSupabase,
			'b1',
			expect.objectContaining({ category: 'fact', key: 'sede', value: 'Sede a Milano.' })
		);
	});
});
