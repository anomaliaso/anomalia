/**
 * PRENDI IL CONTROLLO — l'URL di un desktop vero sulla VM del brand, mouse e tastiera inclusi.
 *
 * Lo screenshot di `screen/+server.ts` mostra cosa fa l'agente; questo dà all'utente le stesse
 * finestre e lo stesso profilo Chrome persistente, quindi un login fatto qui resta alla macchina e
 * non passa mai dal contesto del modello.
 *
 * POST e non GET: apre la VM se dorme e accende processi (x11vnc, websockify). Non è una lettura,
 * e non deve finire in nessuna cache.
 *
 * Chi può: i membri del brand, con la stessa lettura RLS del resto del pannello. La porta esposta
 * dalla sandbox invece è pubblica per chiunque ne indovini il sottodominio — la password derivata
 * (`agent-desktop.ts`) è l'unico confine, ed è per quello che non esiste un ramo "senza password".
 */
import { json } from '@sveltejs/kit';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { ensureGraphicalMode, ensureRemoteDesktop } from '$lib/agent/adapters/graphical-bootstrap';
import { createVercelSandboxProvider, graphicalBootstrapDeps, sandboxPortUrl } from '$lib/agent/bridge/adapters';
import { desktopPassword, desktopUrl, publishComputerRunning } from '$lib/server/agent-desktop';
import { SANDBOX_MAX_LEASE_MS } from '$lib/server/sandbox';
import { holdDesktop } from '$lib/server/sandbox-leases';
import { createAdminClient } from '$lib/server/supabase-admin';
import { env } from '$env/dynamic/private';
import type { AdapterContext } from '$lib/agent/kit/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, url, locals: { supabase, safeGetSession, locale: uiLocale } }) => {
	const { user } = await safeGetSession();
	if (!user) return new Response('Unauthorized', { status: 401 });

	const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
	if (!brand) return new Response('Not found', { status: 404 });

	let password: string;
	try {
		password = desktopPassword(`${brand.id}:${url.searchParams.get('agent') ?? ''}`, env.APP_SECRET ?? '');
	} catch {
		return json({ error: 'not_configured' }, { status: 503 });
	}

	// DI CHI è il computer: lo schermo `:1` è uno solo per macchina, quindi ogni agente ha la sua.
	// Senza `agent` si cade su quella del brand — i lavori che un agente dietro non ce l'hanno.
	const agentId = url.searchParams.get('agent') || undefined;

	const sandbox = createVercelSandboxProvider();
	const ctx: AdapterContext = { brandId: brand.id, userId: user.id, runId: 'computer-desktop', locale: bilingualNoticeLocale(uiLocale), agentId: url.searchParams.get('agent') || undefined };
	// Accende la macchina se dorme, invece di rispondere «torna quando l'agente l'avrà accesa».
	// È la stessa VM del brand: chi arriva primo la crea, e qui chi arriva è l'utente.
	// L'affitto massimo, non quello di un turno: chi prende il controllo resta lì a lavorare, e
	// con i 5 minuti di default la macchina gli muore sotto senza dire niente. La pagina ripassa
	// di qui a intervalli per tenerla viva (`update` alza la scadenza anche a sessione in corso).
	const ref = await sandbox.provision({ brandId: brand.id, agentId, timeoutMs: SANDBOX_MAX_LEASE_MS }, ctx);
	// Chi guarda è un holder: finché il pannello ripassa di qui, la VM resta accesa anche se nessun
	// turno è in corso. Il TTL scade da solo quando il tab muore.
	await holdDesktop(ref.name, brand.id, agentId);
	// Lo stato lo scrive il service role: `agent_computers` è in sola lettura per i membri (0217),
	// e senza questa riga il pannello continuerebbe a dire «dorme» col desktop acceso davanti.
	await publishComputerRunning(createAdminClient(), brand.id, ref.name, agentId);

	// Xvfb e il window manager PRIMA: x11vnc su un display che non esiste esce subito e lascia una
	// porta che non risponde mai, senza dire perché.
	const graphical = await ensureGraphicalMode(sandbox, ref, ctx, graphicalBootstrapDeps);
	if (!graphical.ok) return json({ error: 'graphical_failed', detail: graphical.error }, { status: 502 });

	const desktop = await ensureRemoteDesktop(sandbox, ref, ctx, graphicalBootstrapDeps, password);
	if (!desktop.ok) return json({ error: 'desktop_failed', detail: desktop.error }, { status: 502 });

	const domain = await sandboxPortUrl(ref.name, desktop.port);
	return json({ url: desktopUrl(domain, password) }, { headers: { 'cache-control': 'no-store' } });
};
