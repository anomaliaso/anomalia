/**
 * La grafica renderizzata da un BROWSER vero, invece che da satori.
 *
 * Satori è un sottoinsieme stretto di flexbox — niente `grid`, `clamp()`, `text-wrap: balance`,
 * percentuali su `max-width` — e il compositore chiede al modello «full HTML with <style>». Un
 * sorgente che in Chrome sta in piedi lì trabocca e si sovrappone, e `inspectGraphicTree` ispeziona
 * l'albero DICHIARATO: non misura larghezze né estensioni, quindi non lo vede. È così che è uscita
 * una headline tagliata su due lati con `success: true`, due volte di fila.
 *
 * IL BUNDLE SI PAGA UNA VOLTA. Misurato: 1.35s il bundle, ~220ms lo still riusando lo stesso
 * serveUrl. Il primo giro che sembrava costare 6.6s era boot di Chromium più bundle insieme —
 * numeri che, presi per il costo a grafica, avrebbero fatto scartare la strada giusta.
 *
 * Il ripiego su satori resta e NON è una formalità: `@remotion/renderer` porta un Chromium da
 * 193 MB, e finché un deploy non lo dimostra montato e caldo, un percorso che fallisce senza rete
 * di sicurezza toglierebbe le grafiche invece di migliorarle.
 */
import { env } from '$env/dynamic/private';

export const GRAPHIC_CHROMIUM_FLAG = 'GRAPHIC_RENDERER';

/** Acceso solo quando l'operatore lo chiede: il default resta satori finché una preview non misura. */
export function chromiumGraphicsEnabled(): boolean {
	return (env[GRAPHIC_CHROMIUM_FLAG] ?? '').trim().toLowerCase() === 'chromium';
}

/**
 * Il sito bundlato, una volta per processo. Una Promise e non un valore: due render concorrenti
 * al primo colpo devono ASPETTARE lo stesso bundle, non farne due.
 */
let bundled: Promise<string> | null = null;

async function serveUrl(): Promise<string> {
	if (!bundled) {
		bundled = (async () => {
			const { bundle } = await import('@remotion/bundler');
			return bundle({ entryPoint: 'src/remotion/graphic-entry.tsx' });
		})().catch((e) => {
			// Un bundle fallito non deve restare memorizzato: il prossimo render riprova.
			bundled = null;
			throw e;
		});
	}
	return bundled;
}

export type ChromiumRenderResult = { png: Buffer; width: number; height: number };

/**
 * Renderizza il sorgente e torna il PNG, o `undefined` se questa via non è disponibile.
 *
 * `undefined` e non un'eccezione: il chiamante ripiega su satori e la grafica esce comunque. Una
 * eccezione qui trasformerebbe un renderer assente in un post senza immagine.
 */
export async function renderGraphicWithChromium(
	source: string,
	opts: { width: number; height: number }
): Promise<ChromiumRenderResult | undefined> {
	if (!chromiumGraphicsEnabled()) return undefined;
	try {
		const [{ selectComposition, renderStill }, url] = await Promise.all([
			import('@remotion/renderer'),
			serveUrl()
		]);
		const inputProps = { source };
		const composition = await selectComposition({ serveUrl: url, id: 'Graphic', inputProps });
		const { buffer } = await renderStill({
			composition: { ...composition, width: opts.width, height: opts.height },
			serveUrl: url,
			inputProps,
			imageFormat: 'png',
			output: null
		});
		if (!buffer?.length) return undefined;
		return { png: Buffer.from(buffer), width: opts.width, height: opts.height };
	} catch (e) {
		console.error('[design-render] chromium still failed, falling back to satori:', e instanceof Error ? e.message : e);
		return undefined;
	}
}
