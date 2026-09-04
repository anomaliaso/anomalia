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

async function loadLayout(pathname: string, brand: string) {
	const mod = await import('./+layout.server');
	const cookies = { get: vi.fn(() => undefined), set: vi.fn() };
	try {
		await (mod.load as (e: unknown) => Promise<unknown>)({
			url: new URL(`https://app.test${pathname}`),
			params: { brand },
			cookies,
			locals: {},
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

	it('una rotta figlia non viene rimandata', async () => {
		const { redirected } = await loadLayout('/app/demo/calendar', 'demo');
		expect(redirected?.location).not.toBe('/app/demo/workbench');
	});
});
