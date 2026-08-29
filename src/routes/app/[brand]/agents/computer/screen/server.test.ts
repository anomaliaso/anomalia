/**
 * IL CONTRATTO — 404 senza brand, 204 quando non c'è niente da mostrare (VM non running, o la
 * cattura fallisce), 200 image/png quando c'è. Mai un 500 per una card che fa polling ogni 2.5s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provisionMock = vi.fn();
const captureScreenshotMock = vi.fn();

// La route monta la sandbox via `$lib/agent/bridge/adapters` (il cablaggio DI del lotto 2b), non
// più con `new VercelSandboxProvider()` diretto — mockare quel modulo, non il pacchetto sotto.
vi.mock('$lib/server/agent-desktop', () => ({ agentDesktopEnabled: () => true }));
vi.mock('$lib/agent/bridge/adapters', () => ({
	createVercelSandboxProvider: () => ({ provision: provisionMock })
}));
vi.mock('$lib/agent/adapters/graphical-bootstrap', () => ({
	captureScreenshot: (...args: unknown[]) => captureScreenshotMock(...args)
}));

const { GET } = await import('./+server');

// Un brand id DIVERSO per test: la cache dello screenshot è per-brand e in-process (vedi il
// commento nell'endpoint) — riusare lo stesso id fra test farebbe leggere la cache di un test
// nell'altro invece del percorso che quel test vuole provare.
let brandCounter = 0;

// La riga si cerca per agente E per brand: due `eq` in catena da quando ogni agente ha la sua
// computer, non il brand (e244dedf). La catena si richiama da sola, così non conta quanti sono.
function rows(data: unknown) {
	const chain: Record<string, unknown> = { maybeSingle: async () => ({ data }) };
	chain.eq = () => chain;
	return { select: () => chain };
}

function makeSupabase(computerRow: unknown) {
	const brand = { id: `brand-${++brandCounter}` };
	return {
		brand,
		supabase: {
			from: (table: string) => (table === 'brands' ? rows(brand) : rows(computerRow))
		}
	};
}

function get(supabase: unknown) {
	const event = {
		params: { brand: 'acme' },
		url: new URL('http://localhost/app/acme/agents/computer/screen?agent=a1'),
		locals: { supabase, safeGetSession: async () => ({ user: { id: 'u1' }, session: {} }) }
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (GET as any)(event) as Promise<Response>;
}

describe('GET .../computer/screen', () => {
	beforeEach(() => {
		provisionMock.mockReset().mockResolvedValue({ kind: 'vercel-sandbox', name: 'sb-1' });
		captureScreenshotMock.mockReset();
	});

	it('brand inesistente: 404', async () => {
		const supabase = { from: () => rows(null) };
		const res = await get(supabase);
		expect(res.status).toBe(404);
	});

	it('nessuna riga computer: 204, nessuna chiamata alla sandbox', async () => {
		const res = await get(makeSupabase(null).supabase);
		expect(res.status).toBe(204);
		expect(provisionMock).not.toHaveBeenCalled();
	});

	it('computer stopped: 204', async () => {
		const res = await get(makeSupabase({ state: 'stopped', provider_ref: 'sb-1' }).supabase);
		expect(res.status).toBe(204);
		expect(provisionMock).not.toHaveBeenCalled();
	});

	it('running ma la cattura fallisce (niente Xvfb): 204, non 500', async () => {
		captureScreenshotMock.mockResolvedValue({ ok: false, error: 'no display' });
		const res = await get(makeSupabase({ state: 'running', provider_ref: 'sb-1' }).supabase);
		expect(res.status).toBe(204);
	});

	it('running e la cattura riesce: 200 image/png con i byte giusti', async () => {
		const png = Buffer.from('finto-png').toString('base64');
		captureScreenshotMock.mockResolvedValue({ ok: true, base64: png });
		const res = await get(makeSupabase({ state: 'running', provider_ref: 'sb-1' }).supabase);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/png');
		const body = Buffer.from(await res.arrayBuffer());
		expect(body.toString()).toBe('finto-png');
	});

	it('un provision() che esplode diventa 204, non 500', async () => {
		provisionMock.mockRejectedValue(new Error('sandbox down'));
		const res = await get(makeSupabase({ state: 'running', provider_ref: 'sb-1' }).supabase);
		expect(res.status).toBe(204);
	});
});
