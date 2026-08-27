import { describe, expect, it } from 'vitest';
import { MemoryEmulator, MAX_ENTRY_BYTES } from './memory-emulator';

describe('MemoryEmulator', () => {
	it('describe() dichiara lo stesso tetto di memory-postgres.ts', () => {
		const store = new MemoryEmulator();
		expect(store.describe().capabilities.maxBytes).toBe(32 * 1024);
	});

	it('commit poi read: round-trip su path = categoria/chiave', async () => {
		const store = new MemoryEmulator();
		await store.commit('b1', '', { path: 'voice/tono', content: 'Diretto, mai formale.' }, {} as never);
		const out = await store.read('b1', '', {} as never);
		expect(out).toEqual([
			expect.objectContaining({ path: 'voice/tono', content: 'Diretto, mai formale.' })
		]);
	});

	it('read scopes: brand + il proprio agente, mai i colleghi', async () => {
		const store = new MemoryEmulator();
		await store.commit('b1', '', { path: 'fact/sede', content: 'Milano' }, {} as never);
		await store.commit('b1', 'motion', { path: 'skill/caroselli', content: 'Prezzo alla terza slide' }, {} as never);
		await store.commit('b1', 'content', { path: 'skill/hook', content: 'Mai la domanda retorica' }, {} as never);

		const brandOnly = await store.read('b1', '', {} as never);
		expect(brandOnly.map((e) => e.path)).toEqual(['fact/sede']);

		const motion = await store.read('b1', 'motion', {} as never);
        const paths = motion.map((e) => e.path).sort();
		expect(paths).toEqual(['fact/sede', 'skill/caroselli']);
	});

	it('commit oltre 32KB rifiuta nominando il tetto', async () => {
		const store = new MemoryEmulator();
		const big = 'x'.repeat(MAX_ENTRY_BYTES + 1);
		await expect(store.commit('b1', '', { path: 'fact/troppo', content: big }, {} as never)).rejects.toThrow(
			/32KB|tetto/i
		);
	});

	it('brand diversi non si vedono', async () => {
		const store = new MemoryEmulator();
		await store.commit('b1', '', { path: 'fact/a', content: '1' }, {} as never);
		const out = await store.read('b2', '', {} as never);
		expect(out).toEqual([]);
	});
});
