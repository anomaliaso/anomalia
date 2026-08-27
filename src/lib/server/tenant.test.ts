/**
 * Fissa il comportamento di OGGI, prima che qualcosa cambi. È un test di caratterizzazione: non
 * dice cosa vorremmo, dice cosa fa — ed è ciò che accorgerà la differenza il giorno che una build
 * a tenant singolo risponderà senza interrogare il database.
 *
 * La riga che conta è l'ultima: `peers` è l'unico campo che esiste perché i brand sono più di uno.
 */
import { describe, expect, it, vi } from 'vitest';

const cache = new Map<string, { brand: unknown; brandRows: unknown }>();
vi.mock('$lib/server/nav-cache', () => ({
	BRAND_SHELL_SELECT: 'id, slug',
	BRAND_SWITCHER_SELECT: 'id, slug',
	getBrandShell: (u: string, s: string) => cache.get(`${u}:${s}`) ?? null,
	setBrandShell: (u: string, s: string, v: { brand: unknown; brandRows: unknown }) =>
		cache.set(`${u}:${s}`, v)
}));

const tenancy: { many: boolean } = { many: true };
vi.mock('$lib/server/tenancy', () => ({ hasManyTenants: () => tenancy.many }));

const { resolveTenant } = await import('./tenant');

/** Due letture: il brand per slug, e tutti i brand. Conta quante volte viene interrogato. */
function fakeDb(brand: unknown, peers: unknown[], hits: { n: number }) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const chain = (result: any): any => ({
		select: () => chain(result),
		eq: () => chain(result),
		order: async () => result,
		maybeSingle: async () => result
	});
	let call = 0;
	return {
		from: () => {
			hits.n += 1;
			call += 1;
			return call % 2 === 1 ? chain({ data: brand }) : chain({ data: peers });
		}
	} as never;
}

describe('resolveTenant — la domanda «quale brand» ha una risposta sola', () => {
	it('restituisce il brand dello slug, e gli altri a parte', async () => {
		cache.clear();
		const hits = { n: 0 };
		const out = await resolveTenant(fakeDb({ id: 'b1', slug: 'fornace' }, [{ id: 'b1' }, { id: 'b2' }], hits), 'u1', 'fornace');
		expect(out.brand).toEqual({ id: 'b1', slug: 'fornace' });
		expect(out.peers).toHaveLength(2);
	});

	it('la seconda volta non interroga il database: la cache è parte del contratto', async () => {
		cache.clear();
		const hits = { n: 0 };
		const db = fakeDb({ id: 'b1', slug: 'fornace' }, [{ id: 'b1' }], hits);
		await resolveTenant(db, 'u1', 'fornace');
		const dopo = hits.n;
		await resolveTenant(db, 'u1', 'fornace');
		expect(hits.n).toBe(dopo);
	});

	it('slug che non esiste: brand null, e NON si mette in cache un buco', async () => {
		cache.clear();
		const hits = { n: 0 };
		const db = fakeDb(null, [], hits);
		const out = await resolveTenant(db, 'u1', 'mai-esistito');
		expect(out.brand).toBeNull();
		const dopo = hits.n;
		await resolveTenant(db, 'u1', 'mai-esistito');
		expect(hits.n).toBeGreaterThan(dopo);
	});

	it('`peers` è separato dal brand: il giorno che i tenant sono uno, si toglie un campo', async () => {
		cache.clear();
		const out = await resolveTenant(fakeDb({ id: 'b1' }, [{ id: 'b1' }], { n: 0 }), 'u1', 's');
		expect(Object.keys(out).sort()).toEqual(['brand', 'peers']);
	});
});

describe('con un tenant solo, gli altri brand non si chiedono nemmeno', () => {
	it('peers è null, e il brand arriva lo stesso', async () => {
		cache.clear();
		tenancy.many = false;
		const out = await resolveTenant(fakeDb({ id: 'b1', slug: 'unico' }, [{ id: 'b1' }, { id: 'b2' }], { n: 0 }), 'u1', 'unico');
		expect(out.brand).toEqual({ id: 'b1', slug: 'unico' });
		expect(out.peers).toBeNull();
		tenancy.many = true;
	});

	// La cache e' condivisa fra le due configurazioni: una riga messa quando i brand erano molti
	// non deve far ricomparire lo switcher dopo che l'installazione e' passata a uno.
	it('nemmeno dalla cache: una riga vecchia non fa ricomparire lo switcher', async () => {
		cache.clear();
		const db = fakeDb({ id: 'b1' }, [{ id: 'b1' }, { id: 'b2' }], { n: 0 });
		await resolveTenant(db, 'u1', 'unico');
		tenancy.many = false;
		const out = await resolveTenant(db, 'u1', 'unico');
		expect(out.peers).toBeNull();
		tenancy.many = true;
	});
});
