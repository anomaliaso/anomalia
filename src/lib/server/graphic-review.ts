/**
 * Il render che torna indietro a CHI l'ha chiesto.
 *
 * Una grafica era l'unico artefatto che nessuno guardava: le foto hanno `renderWithQC`, i video
 * hanno `review_video`, e la grafica tornava al modello come `source_chars: 4312` — un conteggio
 * di caratteri. Il gate che c'e' (`inspectGraphicTree`) ispeziona l'albero DICHIARATO e non misura
 * geometria: testo che sborda, blocchi sovrapposti e righe che si accavallano gli sono invisibili
 * per costruzione. Cosi' un PNG con la headline tagliata su due lati usciva come `success: true`.
 *
 * Non tutte le rotte sanno portare un'immagine dentro il risultato di un tool: `media-in-tool-result`
 * manca su kie, xiaomi e deepseek, e kie in particolare la scarta IN SILENZIO. Allegarla e basta
 * significherebbe credere di aver risolto su tre rotte su quattro. Quando non si puo', il risultato
 * lo DICE — un modello che sa di non aver visto puo' chiedere; uno che crede di aver visto no.
 */
import { can, route } from '$lib/server/model-routing';

export type GraphicAttachment = {
	_images?: Array<{ mimeType: string; base64: string }>;
	reviewed: boolean;
	review_note?: string;
};

/** Il PNG appena renderizzato, come allegato se la rotta lo regge. */
export function attachRenderForReview(png: Buffer, endpointSupportsMedia: boolean): GraphicAttachment {
	if (!endpointSupportsMedia) {
		return {
			reviewed: false,
			review_note:
				'The rendered image is NOT attached: the active model route drops media inside tool results. You have not seen this graphic. Do not claim it looks right — open media_url if you need to check it, or say you could not.'
		};
	}
	return {
		_images: [{ mimeType: 'image/png', base64: png.toString('base64') }],
		reviewed: true,
		review_note:
			'The rendered graphic is attached. LOOK at it before replying: text running off the canvas, blocks overlapping and lines colliding are invisible to the checks and visible here. If it is wrong, fix it now — you have the source.'
	};
}

/** La rotta della chat regge un media dentro il risultato di un tool? */
export function routeCarriesMedia(): boolean {
	try {
		return can(route('text').endpoint, 'media-in-tool-result');
	} catch {
		return false;
	}
}
