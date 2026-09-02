/**
 * L'MP4 con audio, reso lato server. OGNI mp4 passa di qui, mai dal browser: l'encoder del browser
 * comprimeva un 1080 sovracampionato mentre la stessa pagina teneva in memoria l'audio decodificato
 * del Player, e la scheda si chiudeva.
 *
 * Il tempo di macchina è addebitato al brand (`withSandboxBilling` dentro `renderMotionMp4`), a
 * secondi e anche sui fallimenti: la macchina è stata accesa comunque.
 *
 * L'ORDINE dei controlli è la parte delicata: si spende solo DOPO il gate crediti, e chi rende il
 * file è chi lo scrive sulla riga — il client non è il posto dove si decide se una cosa è salvata.
 */
import { json, error } from '@sveltejs/kit';

/**
 * Il tetto della funzione NON è il budget del render: il lavoro è già limitato altrove
 * (`SANDBOX_MAX_LEASE_MS` 900s per la VM, `MOTION_SERVER_RENDER_TIMEOUT_MS` 960s per il client).
 *
 * 1800 e non 960 perché su Vercel ogni valore DISTINTO di `maxDuration` fa emettere ad
 * adapter-vercel una funzione serverless intera (~90 MB): gli scaglioni sono 300/800/1800, e una
 * rotta che ne chiede 960 cade nel più alto. Scendere a 960 non la renderebbe più sicura — la VM
 * muore lo stesso a 900s — aggiungerebbe solo una funzione da 90 MB.
 */
export const config = { maxDuration: 1800 };
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { withBrandContext } from '$lib/server/ai-log';
import { CreditsExhaustedError, gateCredits } from '$lib/server/credits';
import { renderMotionMp4 } from '$lib/server/motion-video/render-tools';
import { isSandboxConfigured } from '$lib/server/sandbox';
import { updateMotionPreviewUrl } from '$lib/server/motion-video/persist';
import { MOTION_SOURCE_MAX_CHARS } from '$lib/motion-video/source';
import { motionMp4Scale, parseMotionMp4Quality } from '$lib/motion-video/mp4-render';
import { compileMotionSource } from '$lib/motion-video/compile';

const Body = z.object({
	source: z.string().min(1).max(MOTION_SOURCE_MAX_CHARS),
	videoId: z.string().optional().nullable(),
	quality: z.string().optional()
});

export const POST: RequestHandler = async ({
	request,
	params,
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const { data: brand } = await supabase
		.from('brands')
		.select('id, slug')
		.eq('slug', params.brand)
		.maybeSingle();
	if (!brand) throw error(404, 'Brand not found');

	const parsed = Body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) throw error(400, 'Invalid body');
	const { source } = parsed.data;

	// Si compila QUI: un sorgente che non compila farebbe fallire il render dopo aver acceso la
	// macchina e speso i crediti.
	let meta: { width: number; height: number };
	try {
		const compiled = compileMotionSource(source);
		meta = { width: compiled.width, height: compiled.height };
	} catch (e) {
		throw error(400, `Source does not compile: ${e instanceof Error ? e.message : String(e)}`);
	}

	// Senza VM non si rende, ma non si esplode (nessun percorso di questo repo hard-failsa per una
	// variabile d'ambiente mancante). Dichiarato PRIMA di toccare i crediti.
	if (!isSandboxConfigured()) {
		return json(
			{
				error: 'render_unavailable',
				message: 'MP4 export is not available on this deployment: no render sandbox is configured.'
			},
			{ status: 503 }
		);
	}

	// `withSandboxBilling` addebita DOPO: senza questo gate un saldo a zero non fermerebbe niente.
	try {
		await gateCredits(brand.id);
	} catch (e) {
		if (e instanceof CreditsExhaustedError) {
			return json({ error: 'credits_exhausted' }, { status: 402 });
		}
		throw e;
	}

	const quality = parseMotionMp4Quality(parsed.data.quality);
	const scale = motionMp4Scale(meta.width, meta.height, quality);
	const videoId = parsed.data.videoId ?? null;

	try {
		const out = await withBrandContext(brand.id, () =>
			renderMotionMp4({
				supabase,
				brandId: brand.id,
				userId: user.id,
				videoId,
				source,
				scale,
				// Stop nel browser → fetch abortita: così l'apertura della VM si accorge di non
				// servire più a nessuno.
				abortSignal: request.signal,
				onLog: (line) => console.log(`[motion mp4] brand=${brand.id} ${line}`)
			})
		);

		// L'anteprima sulla riga è ciò che rende il render VISIBILE: senza, il file c'è nello storage
		// e la galleria mostra una tessera vuota. Si scrive qui e non nel client, che la teneva solo
		// in memoria e `invalidateAll()` gliela portava via.
		let attached = false;
		if (videoId) {
			const saved = await updateMotionPreviewUrl(supabase, brand.id, videoId, out.url);
			attached = saved.ok;
			if (!saved.ok) console.error('[motion mp4] preview attach failed', saved.error);
		}

		return json({ url: out.url, bytes: out.bytes, seconds: out.seconds, quality, attached });
	} catch (e) {
		// Il gate sulla voce rifiuta PRIMA di aprire la VM: non è un 502 del render, è "questo video
		// non va consegnato così" — con il rimedio, e a costo zero.
		const { MotionVoiceGateError } = await import('$lib/server/motion-video/voice-gate');
		if (e instanceof MotionVoiceGateError) {
			return json(
				{ error: 'voice_gate_failed', violations: e.violations, remedy: e.remedy },
				{ status: 422 }
			);
		}
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[motion mp4] render failed', msg);
		throw error(502, msg.slice(0, 500));
	}
};
