/**
 * MP4 encode settings for Motion video.
 *
 * 2K supersamples a 1080 canvas to 2160 on the short edge. 4K (Pro) targets 3840 on the short
 * edge, clamped so the long edge stays within 4096 — 1:1 becomes 3840×3840; 9:16 / 16:9 land near
 * 2304×4096. The 4096 cap outlived the WebCodecs encoder it was written for (the browser render
 * path is gone, every MP4 is made by Remotion in a VM), but it is kept: it is also what keeps the
 * files playable on phone decoders.
 */
export const MOTION_MP4_QUALITIES = ['2k', '4k'] as const;
export type MotionMp4Quality = (typeof MOTION_MP4_QUALITIES)[number];

export const MOTION_MP4_MAX_EDGE = 4096;

const TARGET_SHORT_EDGE: Record<MotionMp4Quality, number> = {
	'2k': 2160,
	'4k': 3840
};

export function isMotionMp4Quality(value: unknown): value is MotionMp4Quality {
	return MOTION_MP4_QUALITIES.includes(value as MotionMp4Quality);
}

export function parseMotionMp4Quality(
	value: unknown,
	fallback: MotionMp4Quality = '2k'
): MotionMp4Quality {
	return isMotionMp4Quality(value) ? value : fallback;
}

/**
 * Remotion `scale` so the encoded MP4 hits the quality target with even H.264 dimensions.
 */
export function motionMp4Scale(
	width: number,
	height: number,
	quality: MotionMp4Quality = '2k'
): number {
	const w = Math.max(1, width);
	const h = Math.max(1, height);
	const short = Math.min(w, h);
	const long = Math.max(w, h);
	let scale = TARGET_SHORT_EDGE[quality] / short;
	if (long * scale > MOTION_MP4_MAX_EDGE) scale = MOTION_MP4_MAX_EDGE / long;
	const outW = Math.round(w * scale);
	const outH = Math.round(h * scale);
	const evenW = outW - (outW % 2);
	const evenH = outH - (outH % 2);
	if (evenW <= 0 || evenH <= 0) return 1;
	return Math.min(evenW / w, evenH / h);
}

export function motionMp4PixelSize(
	width: number,
	height: number,
	quality: MotionMp4Quality = '2k'
): { width: number; height: number } {
	const scale = motionMp4Scale(width, height, quality);
	const outW = Math.round(width * scale);
	const outH = Math.round(height * scale);
	return {
		width: outW - (outW % 2),
		height: outH - (outH % 2)
	};
}

/**
 * Quanto il browser aspetta il render server prima di dichiararlo perso.
 *
 * Più lungo del render vero (minuti, e la PRIMA volta su una macchina nuova anche parecchi, perché
 * ci si installa dentro il progetto Remotion) ma finito: una richiesta senza tetto che non riceve
 * risposta lascia la tessera a girare per sempre, ed è esattamente com'è arrivata in produzione.
 *
 * Era esattamente 900_000, cioè lo stesso identico numero del lease della VM: il client mollava
 * nello stesso istante in cui il server finiva di caricare il file, e un render riuscito poteva
 * arrivare a una pagina che l'aveva già dichiarato perso. Un minuto in più del lease — quanto
 * basta a leggere l'MP4, caricarlo su Storage e rispondere.
 *
 * NON è più lo stesso numero del `maxDuration` della rotta: quello ora sta sullo scaglione
 * condiviso 1800 (un valore distinto = una funzione serverless intera nel bundle Vercel). Il
 * tetto che conta per l'utente è questo, non quello.
 */
export const MOTION_SERVER_RENDER_TIMEOUT_MS = 960_000;
