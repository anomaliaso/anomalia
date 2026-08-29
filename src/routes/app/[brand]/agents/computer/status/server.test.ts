import { beforeEach, describe, expect, it, vi } from 'vitest';

const provisionMock = vi.fn();
const probeGraphicalModeMock = vi.fn();

// La route monta la sandbox via `$lib/agent/bridge/adapters` (il cablaggio DI del lotto 2b), non
// più con `new VercelSandboxProvider()` diretto — mockare quel modulo, non il pacchetto sotto.
vi.mock('$lib/server/agent-desktop', () => ({ agentDesktopEnabled: () => true }));
vi.mock('$lib/agent/bridge/adapters', () => ({
	createVercelSandboxProvider: () => ({ provision: provisionMock })
}));
vi.mock('$lib/agent/adapters/graphical-bootstrap', () => ({
	probeGraphicalMode: (...args: unknown[]) => probeGraphicalModeMock(...args)
}));

const { GET } = await import('./+server');

// La riga si cerca per agente E per brand: due `eq` in catena da quando ogni agente ha la sua
// computer, non il brand (e244dedf). La catena si richiama da sola, così non conta quanti sono.
function rows(data: unknown) {
	const chain: Record<string, unknown> = { maybeSingle: async () => ({ data }) };
	chain.eq = () => chain;
	return { select: () => chain };
}

function makeSupabase(computerRow: unknown, brandId = 'brand-1') {
	return {
		from: (table: string) => (table === 'brands' ? rows({ id: brandId }) : rows(computerRow))
	};
}

function get(supabase: unknown) {
	const event = {
		params: { brand: 'acme' },
		url: new URL('http://localhost/app/acme/agents/computer/status?agent=a1'),
		locals: { supabase, safeGetSession: async () => ({ user: { id: 'u1' }, session: {} }) }
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (GET as any)(event) as Promise<Response>;
}

describe('GET .../computer/status', () => {
	beforeEach(() => {
		provisionMock.mockReset().mockResolvedValue({ kind: 'vercel-sandbox', name: 'sb-1' });
		probeGraphicalModeMock.mockReset().mockResolvedValue({ active: false, browser: false });
	});

	it('brand inesistente: 404', async () => {
		const supabase = { from: () => rows(null) };
		const res = await get(supabase);
		expect(res.status).toBe(404);
	});

	it('mai attivata: stopped, everActivated:false, nessuna chiamata alla VM', async () => {
		const res = await get(makeSupabase(null));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ state: 'stopped', everActivated: false, graphical: false });
		expect(provisionMock).not.toHaveBeenCalled();
	});

	it('dorme (stopped con checkpoint): lo dice, niente chiamata alla VM', async () => {
		const res = await get(makeSupabase({ state: 'stopped', provider_ref: 'sb-1', last_touch_at: '2026-08-01T00:00:00Z', checkpoint_path: 'x/y' }));
		const body = await res.json();
		expect(body).toMatchObject({ state: 'stopped', hasCheckpoint: true, graphical: false });
		expect(provisionMock).not.toHaveBeenCalled();
	});

	it('accesa + grafica: interroga il marcatore e lo riporta', async () => {
		probeGraphicalModeMock.mockResolvedValue({ active: true, browser: true });
		const res = await get(makeSupabase({ state: 'running', provider_ref: 'sb-1', last_touch_at: '2026-08-23T10:00:00Z' }));
		const body = await res.json();
		expect(body).toMatchObject({ state: 'running', graphical: true });
	});

	it('accesa ma la sonda esplode: graphical resta false, mai un 500', async () => {
		provisionMock.mockRejectedValue(new Error('down'));
		const res = await get(makeSupabase({ state: 'running', provider_ref: 'sb-1' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.graphical).toBe(false);
	});
});
