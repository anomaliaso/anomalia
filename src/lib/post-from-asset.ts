/**
 * Come una riga `posts` viene scritta a partire da un asset gia' prodotto — una riga per tipo,
 * invece di uno `switch` che cresce di un ramo per volta.
 *
 * Questa tabella esiste per la differenza che nessun provider segnala: `content_type`, `format` e
 * `media_origin` devono muoversi INSIEME. Un post con un mp4 in `media_url` ma `format: 'image'`
 * e' un reel che l'editor apre come una foto e che l'utente scopre rotto in pubblicazione, senza
 * un errore da nessuna parte. Scriverli in tre punti diversi e' esattamente come e' successo.
 *
 * Il prefisso di `contentType` NON e' un'etichetta: `publish.ts` ne ricava
 * `aiGeneratedMedia: !content_type.startsWith('uploaded')`, cioe' la dichiarazione di contenuto AI
 * al momento della pubblicazione. Un asset preso dalla libreria puo' essere AI o caricato
 * dall'utente — la libreria lo sa (`brand_media.source`), questa tabella no — quindi qui si
 * dichiara SEMPRE, che e' il verso prudente: sotto-dichiarare e' il rischio, sovra-dichiarare no.
 */
import type { PostContentType } from './contracts/post-tools';

export const POST_ASSET_TYPES = ['image', 'video', 'carousel'] as const;
export type PostAssetType = (typeof POST_ASSET_TYPES)[number];

export type PostAssetShape = {
	/** Il `kind` di libreria che questo tipo accetta: il filtro, non un'etichetta. */
	mediaKind: 'image' | 'video';
	/** Quanti asset servono: il carosello e' l'unico che ne vuole piu' di uno. */
	multiple: boolean;
	contentType: PostContentType;
	format: string;
	/** Cosa il post ricordera' di se stesso — `read_posts` lo rilegge per sapere come modificarlo. */
	mediaOrigin: string;
};

const SHAPES: Record<PostAssetType, PostAssetShape> = {
	image: { mediaKind: 'image', multiple: false, contentType: 'generated_image', format: 'image', mediaOrigin: 'user_uploaded' },
	video: { mediaKind: 'video', multiple: false, contentType: 'generated_video', format: 'video', mediaOrigin: 'video' },
	carousel: { mediaKind: 'image', multiple: true, contentType: 'generated_image', format: 'carousel', mediaOrigin: 'user_uploaded' }
};

export function postAssetShape(type: unknown): PostAssetShape | undefined {
	return SHAPES[String(type ?? '') as PostAssetType];
}

/** Il minimo di slide sotto cui un carosello non e' un carosello: sarebbe una foto sola. */
export const CAROUSEL_MIN_SLIDES = 2;

export type AssetCountProblem = 'unknown_type' | 'none' | 'too_few' | 'too_many';

/**
 * Quanti asset servono per questo tipo. Il carosello vuole almeno due slide, gli altri esattamente
 * uno: passarne tre a un post immagine non e' un dettaglio da ignorare in silenzio, perche' due
 * delle tre immagini le abbiamo pagate e non finirebbero da nessuna parte.
 */
export function checkAssetCount(type: unknown, count: number): AssetCountProblem | null {
	const shape = postAssetShape(type);
	if (!shape) return 'unknown_type';
	if (count < 1) return 'none';
	if (shape.multiple) return count < CAROUSEL_MIN_SLIDES ? 'too_few' : null;
	return count > 1 ? 'too_many' : null;
}
