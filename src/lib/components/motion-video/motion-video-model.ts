import {
	MOTION_SERVER_RENDER_TIMEOUT_MS,
	type MotionMp4Quality
} from '$lib/motion-video/mp4-render';
import type { MotionDurationPreset } from '$lib/motion-video/source';
import type { MotionAspectRatio } from '$lib/motion-video/source';
import type { MotionVideoListItem, MotionVideoRow } from '$lib/motion-video/source';

export type GridItem = MotionVideoListItem & { rendering?: boolean };

export type PromptHistoryEntry = {
	id: string;
	prompt: string;
	at: number;
	selectedCount: number;
};

export type PickedAd = {
	id: string;
	pageName: string;
	body: string | null;
	thumbnailUrl: string;
	libraryUrl: string | null;
};

export type ComposerMenu = 'none' | 'plus' | 'ads' | 'aspect' | 'duration' | 'quality';

export const MAX_UPLOADS = 4;
export const MAX_ADS = 6;

/**
 * Anche `TimeoutError`, o l'utente legge "signal timed out".
 *
 * `AbortSignal.timeout()` non rigetta con un AbortError: rigetta con un **TimeoutError**. Con
 * il solo controllo su AbortError la scadenza del render finiva nel ramo dell'errore vero e in
 * pagina compariva la stringa grezza del browser, in inglese, invece del messaggio tradotto.
 */
export function isAbortError(e: unknown) {
	const name = (e as { name?: string })?.name;
	return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Stop deve fermare ANCHE il render.
 *
 * La fetch del render portava solo `AbortSignal.timeout`, quindi premere Stop non la toccava:
 * il pannello si chiudeva e il video continuava a rendersi (e a essere addebitato) alle spalle
 * dell'utente. Qui i due segnali diventano uno solo. `AbortSignal.any` esiste da Safari 17.4,
 * sotto il target di build di questo repo, quindi si combina a mano.
 */
export function renderSignal(outer: AbortSignal | null | undefined): {
	signal: AbortSignal;
	done: () => void;
} {
	const ctl = new AbortController();
	const timer = setTimeout(
		() => ctl.abort(new DOMException('render timed out', 'TimeoutError')),
		MOTION_SERVER_RENDER_TIMEOUT_MS
	);
	const onAbort = () => ctl.abort(new DOMException('stopped', 'AbortError'));
	if (outer?.aborted) onAbort();
	else outer?.addEventListener('abort', onAbort, { once: true });
	return {
		signal: ctl.signal,
		done: () => {
			clearTimeout(timer);
			outer?.removeEventListener('abort', onAbort);
		}
	};
}

export async function fetchVideo(apiBase: string, id: string): Promise<MotionVideoRow | null> {
	const res = await fetch(apiBase, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'get', id })
	});
	if (!res.ok) return null;
	const json = (await res.json()) as { video?: MotionVideoRow };
	return json.video ?? null;
}

export type { MotionAspectRatio, MotionDurationPreset, MotionMp4Quality };
