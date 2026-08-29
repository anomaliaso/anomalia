/**
 * LO SCHERMO — un PNG dello schermo grafico della VM del brand, o 204 se non c'è niente da
 * mostrare (VM spenta, mai stata in modo grafico, o la cattura fallisce per qualsiasi motivo: mai
 * un 500 per una card che fa polling ogni 2.5s).
 *
 * Non chiama MAI `ensureGraphicalMode` (il ramo lento con apt/npm) — solo `captureScreenshot`,
 * che è un `import -window root` più un `readFile`: se Xvfb non è vivo, fallisce e basta, 204.
 * Accendere il modo grafico è una scelta dell'agente (tool `observe`/`act`), non di chi guarda
 * il pannello.
 *
 * ## La cache è best-effort, non uno SLA
 *
 * Un modulo serverless non ha stato affidabile fra un'invocazione e la successiva — due richieste
 * ravvicinate possono benissimo finire su due processi diversi, la Map sotto vuota su entrambi.
 * Quando FINISCE sullo stesso processo (warm start, tutt'altro che raro con Fluid Compute), evita
 * di rifare uno screenshot a ogni singolo poll del pannello (~2.5s) dentro la stessa finestra di
 * freschezza dichiarata (`FRESH_MS`).
 */
import { swallow } from '$lib/server/swallow';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { agentDesktopEnabled } from '$lib/server/agent-desktop';
import { captureScreenshot, ensureGraphicalMode } from '$lib/agent/adapters/graphical-bootstrap';
import { createVercelSandboxProvider, graphicalBootstrapDeps } from '$lib/agent/bridge/adapters';
import { holdDesktop } from '$lib/server/sandbox-leases';
import type { AdapterContext } from '$lib/agent/kit/types';
import type { RequestHandler } from './$types';

const FRESH_MS = 2_000;
/** ponytail: Map in-process, niente TTL sweep — poche entry (una per computer attiva), si svuota da sola al cold start. */
const cache = new Map<string, { at: number; png: Buffer }>();

export const GET: RequestHandler = async ({ params, url, locals: { supabase, safeGetSession, locale: uiLocale } }) => {
	const { user } = await safeGetSession();
	if (!user) return new Response('Unauthorized', { status: 401 });
	if (!agentDesktopEnabled()) return new Response(null, { status: 404 });

	const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
	if (!brand) return new Response('Not found', { status: 404 });

	const { data: row } = await supabase
		.from('agent_computers')
		.select('state, provider_ref')
		.eq('agent_id', url.searchParams.get('agent') ?? '')
		.eq('brand_id', brand.id)
		.maybeSingle();
	if (row?.state !== 'running' || !row.provider_ref) return new Response(null, { status: 204 });

	// La chiave è (brand, AGENTE): ogni agente ha la sua macchina e il suo schermo, e una cache
	// per brand servirebbe a un agente il fotogramma di un altro.
	const screenKey = `${brand.id}:${url.searchParams.get('agent') ?? ''}`;
	const cached = cache.get(screenKey);
	if (cached && Date.now() - cached.at < FRESH_MS) {
		return new Response(new Uint8Array(cached.png), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
	}

	try {
		const sandbox = createVercelSandboxProvider();
		const ctx: AdapterContext = { brandId: brand.id, userId: user.id, runId: 'computer-screen', locale: bilingualNoticeLocale(uiLocale), agentId: url.searchParams.get('agent') || undefined };
		const ref = await sandbox.provision({ brandId: brand.id, agentId: url.searchParams.get('agent') || undefined }, ctx);
		// Il poll è il battito di chi guarda: rinfresca l'holder del desktop mentre la pagina è viva.
		await holdDesktop(ref.name, brand.id, url.searchParams.get('agent') || undefined);
		let shot = await captureScreenshot(sandbox, ref, ctx);
		// Xvfb muore col riavvio della VM ma il marker resta: la cattura fallisce con «unable to
		// open X server» per sempre, finché nessuno rilancia i processi. Il rilancio è la parte
		// ECONOMICA di ensureGraphicalMode (la lenta — apt/download — è dietro il marker, già
		// passato se siamo qui): un solo tentativo, poi ricattura. Visto dal vivo il 23/8.
		if (!shot.ok && /X server/i.test(shot.error ?? '')) {
			await ensureGraphicalMode(sandbox, ref, ctx, graphicalBootstrapDeps).catch(swallow('ensure graphical mode'));
			shot = await captureScreenshot(sandbox, ref, ctx);
		}
		// La ragione viaggia in un header: la card smette di dire «sto accendendo» per sempre
		// quando la verità è «la cattura fallisce, ecco perché».
		if (!shot.ok) {
			return new Response(null, {
				status: 204,
				headers: { 'x-screen-reason': (shot.error ?? 'capture failed').slice(0, 180).replace(/[\r\n]+/g, ' ') }
			});
		}
		const png = Buffer.from(shot.base64, 'base64');
		cache.set(screenKey, { at: Date.now(), png });
		return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		return new Response(null, { status: 204, headers: { 'x-screen-reason': reason.slice(0, 180).replace(/[\r\n]+/g, ' ') } });
	}
};
