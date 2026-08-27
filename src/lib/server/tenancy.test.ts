import { afterEach, describe, expect, it, vi } from 'vitest';

const fake: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: fake }));

const { hasManyTenants, soleTenantId } = await import('./tenancy');

afterEach(() => {
	delete fake.TENANT_BRAND_ID;
});

describe('quanti tenant ha questa installazione', () => {
	it('senza la variabile: molti, come oggi', () => {
		expect(hasManyTenants()).toBe(true);
		expect(soleTenantId()).toBeNull();
	});

	it("con lo UUID: uno solo, e l'id è quello", () => {
		fake.TENANT_BRAND_ID = '22bf9fdc-9fcd-4f8c-a6e0-54cfa7ffec37';
		expect(hasManyTenants()).toBe(false);
		expect(soleTenantId()).toBe('22bf9fdc-9fcd-4f8c-a6e0-54cfa7ffec37');
	});

	// Una variabile impostata a stringa vuota è un errore di configurazione comune (un `export`
	// senza valore, una riga copiata a metà). Trattarla come "un tenant chiamato stringa vuota"
	// darebbe una risoluzione che non trova niente e un'app che sembra vuota senza dire perché.
	it('stringa vuota o spazi valgono come non impostata, non come tenant senza nome', () => {
		fake.TENANT_BRAND_ID = '   ';
		expect(hasManyTenants()).toBe(true);
		expect(soleTenantId()).toBeNull();
	});

	it('si rilegge a ogni chiamata: si passa da uno a molti senza ricostruire', () => {
		expect(hasManyTenants()).toBe(true);
		fake.TENANT_BRAND_ID = 'abc';
		expect(hasManyTenants()).toBe(false);
	});
});
