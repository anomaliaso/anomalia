/**
 * `read_posts` tronca a 20 (massimo 50) e restituiva `count: posts.length` — il conto della
 * PAGINA. Su un brand con 60 bozze la risposta comoda è «20», è coerente con tutto ciò che
 * l'agente ha visto, e nessun guardiano la smaschera: il tool non ha mentito, ha risposto a una
 * domanda diversa da quella dell'utente. Visto in produzione il 25/8: 63 dichiarati dove erano 60.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/ai-log', () => ({ logAiCall: () => {}, extractSdkUsage: () => ({}) }));

const { readPostsResult } = await import('./read-posts-count');

describe('read_posts non spaccia la pagina per il totale', () => {
	it('con 60 righe e un tetto di 20, `count` dice 60 e `returned` dice 20', () => {
		const out = readPostsResult({ posts: new Array(20).fill({ id: 'x' }), total: 60, limit: 20 });
		expect(out.count).toBe(60);
		expect(out.returned).toBe(20);
		expect(out.truncated).toMatch(/40/);
	});

	it('quando ci stanno tutte, nessuna nota di troncamento da leggere e fraintendere', () => {
		const out = readPostsResult({ posts: new Array(7).fill({ id: 'x' }), total: 7, limit: 20 });
		expect(out.count).toBe(7);
		expect(out.returned).toBe(7);
		expect(out.truncated).toBeUndefined();
	});

	it('senza un totale dal database si dichiara ignoto, invece di indovinare la pagina', () => {
		const out = readPostsResult({ posts: new Array(20).fill({ id: 'x' }), total: null, limit: 20 });
		expect(out.count).toBeUndefined();
		expect(out.returned).toBe(20);
		expect(out.truncated).toMatch(/non so quante/i);
	});
});
