/**
 * IL CANCELLO DELLA FASE 3: con un tenant solo, il guscio multi-brand non è vuoto — non esiste.
 *
 * Ognuno di questi tre punti è un modo in cui l'utente potrebbe finire davanti a una pagina che
 * parla di «altri brand» in un'installazione che ne ha uno. Un guscio mezzo spento è peggio di uno
 * acceso: mostra scelte che non portano da nessuna parte.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const fake: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: fake }));

const { hasManyTenants, soleTenantId } = await import('./tenancy');

const SOLE = '22bf9fdc-9fcd-4f8c-a6e0-54cfa7ffec37';

afterEach(() => {
	delete fake.TENANT_BRAND_ID;
});

describe('il guscio multi-brand risponde a una domanda sola', () => {
	it('acceso: i tre punti del guscio hanno ragione di esistere', () => {
		expect(hasManyTenants()).toBe(true);
		expect(soleTenantId()).toBeNull();
	});

	it('spento: nessuno dei tre ha più senso, e lo sanno tutti dalla stessa riga', () => {
		fake.TENANT_BRAND_ID = SOLE;
		// 1. lo switcher — `resolveTenant` non chiede nemmeno gli altri brand (tenant.test.ts)
		// 2. la lista in /app — reindirizza al brand unico invece di offrire una scelta
		// 3. gli inviti in settings/team — 404
		expect(hasManyTenants()).toBe(false);
		expect(soleTenantId()).toBe(SOLE);
	});
});

describe('le route del guscio leggono la stessa dichiarazione, non una copia', () => {
	it('il codice del guscio importa da tenancy.ts e non rilegge la variabile per conto suo', async () => {
		const { readFileSync } = await import('node:fs');
		const sorgenti = [
			'src/routes/app/+page.server.ts',
			'src/routes/app/[brand]/settings/team/+page.server.ts',
			'src/routes/app/[brand]/settings/danger/+page.server.ts',
			'src/lib/server/settings-actions.ts',
			'src/routes/app/onboarding/+page.server.ts',
			'src/lib/server/tenant.ts'
		];
		for (const f of sorgenti) {
			const src = readFileSync(f, 'utf8');
			expect(src, `${f} deve importare da tenancy`).toMatch(/from '\$lib\/server\/tenancy'/);
			// Una seconda lettura di env qui sarebbe la copia che diverge: la regola sta in un punto.
			expect(src.includes('TENANT_BRAND_ID') && !src.includes("from '$lib/server/tenancy'"), f).toBe(false);
		}
	});
});

describe("cancellare l'unico brand non deve essere possibile", () => {
	// La riga sparisce, TENANT_BRAND_ID resta a puntarla, e ogni pagina risponde 500 con «esegui il
	// seed». Un bottone che mura l'installazione non e' una scelta da offrire.
	it("l'azione si difende da sola, non solo la pagina", async () => {
		const { readFileSync } = await import('node:fs');
		const azione = readFileSync('src/lib/server/settings-actions.ts', 'utf8');
		const dopoDelete = azione.slice(azione.indexOf('export async function deleteBrand'));
		const guardia = dopoDelete.indexOf('hasManyTenants');
		const cancella = dopoDelete.indexOf(".delete()");
		expect(guardia, 'la guardia deve esistere dentro deleteBrand').toBeGreaterThan(-1);
		// In SvelteKit un POST raggiunge l'azione anche se il `load` della route risponde 404:
		// la guardia deve stare PRIMA della cancellazione, non solo sulla pagina.
		expect(guardia).toBeLessThan(cancella);
	});
});
