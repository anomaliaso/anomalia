/**
 * STATO DELLA COMPUTER — la card «Computer» del pannello agente (`AgentComputerPanel.svelte`)
 * la legge per sapere se mostrare "dorme"/"mai accesa"/"accesa" e se tentare lo screenshot.
 *
 * `agent_computers` ha già una policy RLS di sola lettura per i membri del brand (0217): niente
 * admin client qui, la sessione dell'utente basta — coerente con `media-refs/+server.ts` e vicini.
 *
 * `graphical` costa un `cat` sul marcatore dentro la VM (poche centinaia di ms) SOLO quando lo
 * stato è `running` — mai il ramo lento di `ensureGraphicalMode` (niente apt/npm da qui). Se la VM
 * non è accesa, `graphical` è `false` senza nessuna chiamata: non c'è niente da leggere.
 */
import { json } from '@sveltejs/kit';
import { probeGraphicalMode } from '$lib/agent/adapters/graphical-bootstrap';
import { createVercelSandboxProvider } from '$lib/agent/bridge/adapters';
import type { AdapterContext } from '$lib/agent/kit/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return new Response('Unauthorized', { status: 401 });

	const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
	if (!brand) return new Response('Not found', { status: 404 });

	const { data: row } = await supabase
		.from('agent_computers')
		.select('state, provider_ref, last_touch_at, checkpoint_path')
		.eq('agent_id', url.searchParams.get('agent') ?? '')
		.eq('brand_id', brand.id)
		.maybeSingle();

	const state = (row?.state as 'stopped' | 'running' | 'error' | undefined) ?? 'stopped';
	const hasCheckpoint = Boolean(row?.checkpoint_path);

	let graphical = false;
	if (state === 'running' && row?.provider_ref) {
		try {
			const sandbox = createVercelSandboxProvider();
			const ctx: AdapterContext = { brandId: brand.id, userId: user.id, runId: 'computer-status', locale: 'it', agentId: url.searchParams.get('agent') || undefined };
			const ref = await sandbox.provision({ brandId: brand.id, agentId: url.searchParams.get('agent') || undefined }, ctx);
			graphical = (await probeGraphicalMode(sandbox, ref, ctx)).active;
		} catch {
			// Una VM che non risponde per lo status non è un errore da far esplodere: resta `false`,
			// coerente col fatto che non sappiamo — mai un 500 per una card di stato.
			graphical = false;
		}
	}

	return json({
		state,
		everActivated: Boolean(row),
		lastTouchAt: row?.last_touch_at ?? null,
		hasCheckpoint,
		graphical
	});
};
