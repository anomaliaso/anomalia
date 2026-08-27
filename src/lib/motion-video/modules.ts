/**
 * COSA PUÒ IMPORTARE UN VIDEO, in un posto solo.
 *
 * Questa lista è la superficie di attacco del prodotto messa per iscritto: il TSX lo scrive un
 * modello, e `compile.ts` lo esegue nel browser di chi guarda con `new Function`. Quindi la regola
 * non è "quali pacchetti sono comodi" ma **quali pacchetti accettiamo di eseguire lì dentro**.
 * npm arbitrario nel browser dell'utente non è sul tavolo, oggi né dopo: qui stanno solo moduli
 * che importiamo staticamente noi, che finiscono nel bundle alla build, e che sono di Remotion o
 * di React alla stessa versione del resto.
 *
 * PERCHÉ ERA TROPPO STRETTA. Fino a ieri erano due, `react` e `remotion`, e la conseguenza si
 * leggeva nelle craft specs: chiedevano "slide con sovrapposizione" e "iris che si apre e diventa
 * la maschera della scena dopo", cioè esattamente `@remotion/transitions`, e il modello doveva
 * rifarle a mano con `interpolate` e `clipPath` a ogni video. Una transizione riscritta da zero
 * ogni volta è una transizione che ogni volta esce un po' diversa e un po' peggio.
 *
 * PERCHÉ NON È PIÙ LARGA. Fuori restano, e ognuno per una ragione sua:
 *  - `three` / `@react-three/fiber`: mezzo megabyte nel bundle per una cosa che le craft specs
 *    dichiarano fuori perimetro (questi video NON sono 3D — c'è scritto nel prompt dell'hub).
 *  - `@remotion/google-fonts`: centinaia di sotto-export, uno per famiglia, che una allowlist per
 *    stringa non sa esprimere; e i font di questo prodotto li carica già il renderer.
 *  - `@remotion/media-utils`: legge metadati di audio e video via rete. Un motion video qui non ha
 *    audio, e non voglio una fetch dentro il compile.
 *  - Le transizioni "da effetto" (`film-burn`, `zoom-blur`, `dreamy-zoom`, `crosswarp`, `ripple`,
 *    `cross-zoom`, `book-flip`, `swap`): sono l'effetto per sé stesso contro cui le craft specs
 *    argomentano per intero, e alcune si portano dietro degli shader.
 *
 * CHI LA LEGGE. Tre posti, e devono restare d'accordo — è il motivo per cui il file esiste invece
 * di avere la lista scritta due volte:
 *  1. `compile.ts` — il gate statico e il `require` del player.
 *  2. `motion-video/render-tools.ts` — il `package.json` del progetto di render nella VM. Se
 *     divergesse, un video che compila nel browser fallirebbe il render, o viceversa.
 *  3. Il contratto TSX nel prompt dell'agente.
 */

/**
 * Una sola versione per il player, per la VM di render e per il package.json del repo — **esatta**,
 * senza caret, e con un test che lo verifica (`modules.test.ts`).
 *
 * Non è prudenza generica. I pacchetti di Remotion si controllano a vicenda a runtime e **lanciano**
 * su disallineamento ("Multiple versions of Remotion detected"). Con `^4.0.498` su tutti, npm ha
 * risolto `remotion` a 4.0.506 e i tre pacchetti nuovi a 4.0.498, se li è annidati, e il compile è
 * morto all'import — prima ancora di arrivare a un video. Il caret qui non è una comodità, è un
 * generatore di quel guasto.
 */
export const MOTION_REMOTION_VERSION = '4.0.506';
export const MOTION_REACT_VERSION = '19.2.0';

/**
 * Ogni specificatore ammesso, con la riga che spiega a cosa serve. La riga non è ornamento: finisce
 * nel prompt, ed è l'unica cosa che il modello legge prima di decidere se importare qualcosa.
 */
export const MOTION_MODULE_NOTES = {
	react: 'React itself — hooks, components.',
	remotion:
		'AbsoluteFill, Img, Audio, Series, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing, random.',
	'@remotion/shapes':
		'Ready-made SVG shapes: Circle, Ellipse, Rect, Triangle, Star, Pie. Use instead of hand-written path data for discs, masks, badges and rating stars.',
	'@remotion/paths':
		'SVG path maths: getLength, evolvePath, getPointAtLength. This is how a line, an underline or an icon stroke draws itself on.',
	'@remotion/transitions':
		'TransitionSeries plus linearTiming / springTiming — the same beat structure as <Series>, but with a real transition between beats instead of a cut.',
	'@remotion/transitions/slide':
		'slide() — the default transition of the craft rules: outgoing scene still moving as the next enters.',
	'@remotion/transitions/iris':
		'iris() — a circle grows from a point and becomes the mask that reveals the next scene.',
	'@remotion/transitions/wipe': 'wipe() — the next scene sweeps across the outgoing one.',
	'@remotion/transitions/clock-wipe': 'clockWipe() — a radial sweep, for timers and cycles.',
	'@remotion/transitions/flip': 'flip() — a 3D card flip between two beats.',
	'@remotion/transitions/fade': 'fade() — only where a cross-dissolve is genuinely the right move.',
	'@remotion/transitions/none': 'none() — a hard cut, when a beat must land without any blend.'
} as const;

export type MotionAllowedModule = keyof typeof MOTION_MODULE_NOTES;

export const MOTION_ALLOWED_MODULES = Object.keys(MOTION_MODULE_NOTES) as MotionAllowedModule[];

export function isMotionAllowedModule(spec: string): spec is MotionAllowedModule {
	return Object.prototype.hasOwnProperty.call(MOTION_MODULE_NOTES, spec);
}

/**
 * I pacchetti npm dietro quei specificatori — i sotto-export collassano sul pacchetto che li
 * contiene, perché è quello che si installa. `@remotion/cli` non è qui: serve a rendere, non a
 * essere importato da un video, e vive solo nel package.json della VM.
 */
export const MOTION_RENDER_PACKAGES: Record<string, string> = {
	react: MOTION_REACT_VERSION,
	'react-dom': MOTION_REACT_VERSION,
	remotion: MOTION_REMOTION_VERSION,
	'@remotion/shapes': MOTION_REMOTION_VERSION,
	'@remotion/paths': MOTION_REMOTION_VERSION,
	'@remotion/transitions': MOTION_REMOTION_VERSION
};

/** La sezione del contratto TSX che elenca cosa si può importare, generata dalla lista sopra. */
export function motionImportContract(): string {
	const lines = MOTION_ALLOWED_MODULES.map((m) => `  - '${m}' — ${MOTION_MODULE_NOTES[m]}`);
	return [
		'Imports allowed — this exact list, nothing else (any other specifier is refused by the compiler):',
		...lines,
		'  Anything outside this list (three.js, tailwind, lottie, @remotion/google-fonts, next/image, a CDN URL) is rejected before the video ever runs. Do not try it and do not require() local files.'
	].join('\n');
}
