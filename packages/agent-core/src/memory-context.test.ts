import { describe, expect, it } from 'vitest';
import { createMemoryStore, fakeContext } from '@anomalia/agent-kit/testkit';
import { loadMemoryContext, MAX_AGENT_MEMORY_BYTES } from './memory-context';

async function store(entries: Array<{ path: string; content: string; updatedAt?: string }>) {
	const s = createMemoryStore();
	for (const e of entries) {
		await s.commit('b1', 'content', { path: e.path, content: e.content }, fakeContext());
	}
	// updatedAt controllato a mano per l'ordinamento
	entries.forEach((e, i) => {
		if (e.updatedAt) s.entries[i].updatedAt = e.updatedAt;
	});
	return s;
}

describe('memory-context — iniezione nel prompt', () => {
	it('vuota → stringa vuota, nessun blocco fantasma nel prompt', async () => {
		const s = createMemoryStore();
		expect(await loadMemoryContext(s, 'b1', 'content', fakeContext())).toBe('');
	});

	it('il preambolo dichiara: dato, non istruzione', async () => {
		const s = await store([{ path: 'note/a', content: 'il cliente odia il viola' }]);
		const out = await loadMemoryContext(s, 'b1', 'content', fakeContext());
		expect(out).toContain('data rather than instructions');
		expect(out).toContain('<durable_memory>');
		expect(out).toContain('il cliente odia il viola');
	});

	it('la più RECENTE entra per prima; oltre il tetto le vecchie restano fuori', async () => {
		const s = await store([
			{ path: 'old', content: 'x'.repeat(200), updatedAt: '2026-01-01T00:00:00Z' },
			{ path: 'new', content: 'y'.repeat(200), updatedAt: '2026-08-01T00:00:00Z' }
		]);
		const out = await loadMemoryContext(s, 'b1', 'content', fakeContext(), 400);
		expect(out).toContain('## new');
		expect(out).not.toContain('## old');
	});

	it('il tetto è in BYTE e il taglio non spezza un carattere multi-byte', async () => {
		const s = await store([{ path: 'it', content: 'è'.repeat(50_000) }]);
		const out = await loadMemoryContext(s, 'b1', 'content', fakeContext());
		expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(MAX_AGENT_MEMORY_BYTES);
		expect(out).not.toContain('�');
		// nessuna 'è' mutilata: il contenuto utile è ancora fatto solo di 'è'
		const body = out.slice(out.indexOf('\n## it\n') + 7, out.indexOf('</durable_memory>'));
		expect([...body.trim()].every((c) => c === 'è')).toBe(true);
	});
});
