import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/**
 * La home del brand rimanda al workbench. Due cose che il redirect deve rispettare, e che
 * un percorso relativo scritto a mano non rispetta:
 *
 *   1. la destinazione è DENTRO il brand — da /app/demo si va a /app/demo/workbench,
 *      non a /app/workbench, che non è la rotta di nessuno;
 *   2. la risposta si chiude PRIMA che il layout scriva il cookie dell'ultimo brand,
 *      altrimenti SvelteKit rifiuta con «Cannot use cookies.set(...) after the response
 *      has been generated». Il redirect deve quindi vivere nel layout, in cima, non in
 *      un +page.server.ts che corre in parallelo.
 */

const redirect = vi.fn((status: number, location: string) => {
	const e = new Error(`redirect ${status} ${location}`) as Error & { status: number; location: string };
	e.status = status;
	e.location = location;
	throw e;
});

vi.mock('@sveltejs/kit', async (orig) => ({ ...(await orig<object>()), redirect, error: vi.fn() }));

// Il layout, sotto il rimando, interroga sessione, accesso e tenant. Finché il rimando stava in
// cima nessuna di queste veniva raggiunta e il test passava con `locals: {}` — cioè non provava
// l'ordine, che è precisamente la cosa che si è rotta.
vi.mock('$lib/server/access', () => ({ canEnter: async () => true }));
vi.mock('$lib/server/tenant', () => ({
	resolveTenant: async (_c: unknown, _u: string, slug: string) => ({
		brand: { id: 'b1', slug, brand_kit: null },
		peers: []
	})
}));

async function loadLayout(pathname: string, brand: string, session: unknown = { user: { id: 'u1' } }) {
	const mod = await import('./+layout.server');
	const cookies = { get: vi.fn(() => undefined), set: vi.fn() };
	// Il layout lancia anche `loadDeferred`, che nessuno di questi test guarda ma la cui promessa
	// rifiutata farebbe uscire vitest con errore. Una catena che risponde a qualunque metodo, e che
	// è attendibile in fondo, la lascia finire in silenzio.
	const chain: Record<string, unknown> = new Proxy(
		{ then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(res) },
		{ get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => chain) }
	);
	// `rpc` esattamente come `from`, e per la stessa ragione scritta qui sopra: il differito arriva
	// fino a `remaining()` → `getCreditsUsage()` → `fetchStripePeriodStart()`, che chiama
	// `supabase.rpc(...)`. Senza questa riga moriva con `supabase.rpc is not a function` — e non
	// faceva fallire un test, faceva cadere l'INTERA suite come Unhandled Rejection, perche` quella
	// promessa non l'aspetta nessuno. In modo intermittente: dipende da quando il rifiuto atterra
	// rispetto alla fine del run, cioe` da quanti file di test ci sono e in che ordine girano.
	const supabase = {
		auth: { getSession: async () => ({ data: { session } }) },
		from: () => chain,
		rpc: () => chain
	};
	try {
		await (mod.load as (e: unknown) => Promise<unknown>)({
			url: new URL(`https://app.test${pathname}`),
			params: { brand },
			cookies,
			locals: { supabase, safeGetSession: async () => ({ session, user: session ? { id: 'u1' } : null }) },
			depends: vi.fn()
		});
		return { redirected: null as null | { status: number; location: string }, cookies };
	} catch (e) {
		const err = e as Error & { status?: number; location?: string };
		if (err.location) return { redirected: { status: err.status!, location: err.location }, cookies };
		return { redirected: null, cookies, thrown: err };
	}
}

describe('la home del brand rimanda al workbench del brand', () => {
	it('manda dentro il brand, non alla radice di /app', async () => {
		const { redirected } = await loadLayout('/app/demo', 'demo');
		expect(redirected?.location).toBe('/app/demo/workbench');
	});

	it('uno slug con caratteri da codificare resta integro', async () => {
		const { redirected } = await loadLayout('/app/bar+centrale', 'bar+centrale');
		expect(redirected?.location).toBe('/app/bar%2Bcentrale/workbench');
	});

	it('non scrive nessun cookie prima di rimandare: la risposta si chiude subito', async () => {
		const { cookies } = await loadLayout('/app/demo', 'demo');
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('chi non è autenticato va al login, non al workbench', async () => {
		const { redirected } = await loadLayout('/app/demo', 'demo', null);
		expect(redirected?.status).toBe(303);
		expect(redirected?.location).toBe('/login');
	});

	it('una rotta figlia non viene rimandata', async () => {
		const { redirected } = await loadLayout('/app/demo/calendar', 'demo');
		expect(redirected?.location).not.toBe('/app/demo/workbench');
	});
});

/**
 * Il redirect nel layout non basta a far esistere la rotta. SvelteKit costruisce il manifest
 * dai file: senza né `+page.server.ts` né `+page.svelte`, `/app/<slug>` non è una rotta, e il
 * 404 nasce in `resolve()` PRIMA che un solo `load` parta — layout compreso. Un test sul solo
 * `load` del layout resta verde mentre la home è irraggiungibile per tutti: è già successo.
 */
const brandRouteDir = fileURLToPath(new URL('.', import.meta.url));

function pageFilesIn(dir: string): string[] {
	return readdirSync(join(brandRouteDir, dir)).filter((f) => f === '+page.server.ts' || f === '+page.svelte');
}

describe('/app/[brand] è una rotta, non solo un guscio', () => {
	it('ha un file di pagina, altrimenti il 404 arriva prima del layout', () => {
		expect(pageFilesIn('.')).not.toEqual([]);
	});

	it('il controllo sa dire di no: una cartella di solo endpoint non ha pagina', () => {
		expect(pageFilesIn('credits')).toEqual([]);
	});
});
