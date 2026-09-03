/**
 * La grafica renderizzata da un BROWSER, nella sandbox che il brand ha già.
 *
 * Satori è un sottoinsieme stretto di flexbox — niente `grid`, `clamp()`, `text-wrap: balance`,
 * percentuali su `max-width` — e il compositore chiede al modello «full HTML with <style>». Un
 * sorgente che in Chrome sta in piedi lì trabocca e si sovrappone, e `inspectGraphicTree` ispeziona
 * l'albero DICHIARATO: non misura, quindi non lo vede. Così è uscita una headline tagliata su due
 * lati con `success: true`.
 *
 * DOVE GIRA, E PERCHÉ NON ALTROVE. Remotion documenta la Vercel Sandbox come la strada per chi sta
 * su Vercel, e qui c'è già: `render-tools.ts` lancia `npx remotion still` per i fotogrammi del
 * motion, sulla stessa VM per brand, con gli stessi `node_modules` in cache e lo stesso Chromium.
 * Una grafica È un motion video da UN fotogramma, quindi non serve nessuna macchina nuova, nessun
 * Chromium nel pacchetto della funzione e nessun ciclo di vita da gestire: la VM è condivisa, ha
 * holder e lease, e un turno di chat che compone una grafica spesso ce l'ha già aperta.
 *
 * La strada in-process (`@remotion/bundler` + `renderStill` dentro la funzione) è quella che
 * Remotion mette per ultima, ed è quella che avevo scritto: portava Chromium dove non deve stare.
 */
import { env } from '$env/dynamic/private';

export const GRAPHIC_CHROMIUM_FLAG = 'GRAPHIC_RENDERER';

/** Acceso solo quando l'operatore lo chiede: il default resta satori finché non è misurato. */
export function chromiumGraphicsEnabled(): boolean {
	return (env[GRAPHIC_CHROMIUM_FLAG] ?? '').trim().toLowerCase() === 'chromium';
}

export type ChromiumRenderResult = { png: Buffer; width: number; height: number };

/**
 * Il sorgente del modello nella forma che il progetto di render si aspetta.
 *
 * `Video.tsx` deve esportare il componente di default e le misure, perché è da quegli export che
 * `ROOT_TSX` costruisce la `<Composition>` — i numeri renderizzati sono per costruzione quelli
 * dichiarati qui, e una grafica è un fotogramma solo.
 */
export function wrapGraphicAsComposition(source: string, width: number, height: number): string {
	return `${source}

export const width = ${width};
export const height = ${height};
export const fps = 30;
export const durationInFrames = 1;
export default (typeof Graphic !== 'undefined' ? Graphic : (() => null));
`;
}

/**
 * Renderizza e torna il PNG, o `undefined` se questa via non è disponibile.
 *
 * `undefined` e non un'eccezione: il chiamante ripiega su satori e la grafica esce comunque. Senza
 * sandbox configurata — un self-host, una preview senza credenziali — un'eccezione qui
 * trasformerebbe un renderer assente in un post senza immagine.
 */
export async function renderGraphicWithChromium(
	source: string,
	opts: { width: number; height: number; brandId?: string | null; userId?: string | null }
): Promise<ChromiumRenderResult | undefined> {
	if (!chromiumGraphicsEnabled()) return undefined;
	if (!opts.brandId) return undefined;
	try {
		const { isSandboxConfigured } = await import('$lib/server/sandbox');
		if (!isSandboxConfigured()) return undefined;

		const { renderMotionStills } = await import('$lib/server/motion-video/render-tools');
		const { rendered, failures } = await renderMotionStills({
			brandId: opts.brandId,
			userId: opts.userId ?? undefined,
			source: wrapGraphicAsComposition(source, opts.width, opts.height),
			frames: [0],
			detail: 'graphic'
		});
		const png = rendered[0]?.png;
		if (!png?.length) {
			console.error('[design-render] graphic still failed, falling back to satori:', failures[0]?.error ?? 'no frame');
			return undefined;
		}
		return { png, width: opts.width, height: opts.height };
	} catch (e) {
		console.error('[design-render] graphic still failed, falling back to satori:', e instanceof Error ? e.message : e);
		return undefined;
	}
}
