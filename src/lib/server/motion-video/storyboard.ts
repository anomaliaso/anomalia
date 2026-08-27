/**
 * LO STORYBOARD: una scena, un'immagine, un giudizio — e solo alla fine il video.
 *
 * L'ordine di prima era: scrivi il TSX → apri una VM e renderizza l'MP4 (p50 85s, casi peggiori
 * 342s) → estrai i fotogrammi dal file finito → giudica. Un'autopsia. Se il video era brutto,
 * i soldi erano già spesi e il giudizio arrivava su una cosa fatta.
 *
 * Qui i fotogrammi arrivano PRIMA, dallo stesso TSX, in una sola apertura di macchina. I numeri
 * dalla produzione (`ai_calls`, label `sandbox.*`, 21-22/8/2026):
 *
 *   sandbox.motion_stills   n=21   p50 21s   (fino a 4 fotogrammi per chiamata)
 *   sandbox.motion_render   n=14   p50 85s   avg 116s   max 229s   (+7 falliti, avg 162s)
 *
 * L'apertura pesa ~5s, ogni fotogramma dopo ~4-5s: uno storyboard da sei scene sta in ~30s, cioè
 * un terzo dell'MP4 che evita di sprecare. Misurato dal vivo il 22/8 sul trailer bocciato 3,5:
 * quattro fotogrammi in 25,2s con l'installazione della VM dentro, contro i 167s dell'MP4 dello
 * stesso video lo stesso giorno. Ed è lo stesso progetto di render già installato sulla
 * macchina — la cache è per dipendenze, non per run: uno still non paga niente che un MP4 non
 * paghi.
 *
 * ## Cosa lo storyboard NON vede
 *
 * Il movimento. Un fotogramma fermo non mostra una coda morta, un'interpolazione lineare, una
 * transizione che legge come un taglio secco, il ritmo. Quelle le vede l'aritmetica sul sorgente
 * — `findLinearMotion`, `findStaticTails`, `detectWowMechanisms` — che gira sullo stesso TSX e
 * quindi può girare nello stesso momento. Le due metà viaggiano insieme nella stessa risposta:
 * le immagini per la composizione, i numeri per il movimento. Chi scrive che lo storyboard copre
 * anche il movimento si sta raccontando una storia.
 *
 * ## Il freno, che sta in codice e non nel prompt
 *
 * Il rischio vero non è il costo: è un agente che lucida le scene all'infinito. Quindi il
 * cancello è deterministico e limitato in due modi che si sommano — si rifiuta UNA VOLTA per
 * versione del sorgente (chiave: l'hash), e al massimo `MAX_STORYBOARD_REFUSALS` volte per turno.
 * Dopo, il render parte comunque, qualunque cosa dicano i fotogrammi. È la stessa forma di
 * `MAX_REVIEW_REFUSALS` in `agent-base.ts` e di `MAX_FINISH_REFUSALS`: un giudice che boccia
 * sempre deve fermarsi al tetto, non girare per sempre.
 *
 * ## Perché non si aspetta l'utente
 *
 * Lo storyboard si MOSTRA (i PNG tornano attaccati al risultato del tool, quindi finiscono sia
 * negli occhi del modello sia in chat) ma non si aspetta. Un'AI che chiede il permesso prima di
 * continuare non è un autopilota.
 */
import { createHash } from 'node:crypto';
import { motionBeats } from '$lib/motion-video/beats';
import { defaultStillFrames } from '$lib/server/motion-video/render-tools';
import {
	findDurationMismatch,
	findFrozenBackplate,
	findLinearMotion,
	findStaticTails,
	formatEasingViolations,
	formatStasisViolations,
	formatDurationMismatch,
	formatFrozenBackplate
} from '$lib/motion-video/easing';
import { detectWowMechanisms } from '$lib/motion-video/transitions-cookbook';

/** Scene per storyboard. Oltre, il contesto si riempie di PNG e il modello smette di guardarli. */
export const MAX_STORYBOARD_FRAMES = 8;
/**
 * Quante volte un turno può rimandare indietro un render per farlo guardare. Due: il primo
 * storyboard e quello dopo la patch. Al terzo si rende, qualunque cosa si veda nei fotogrammi.
 */
export const MAX_STORYBOARD_REFUSALS = 2;
/** Sotto questo non si apre la VM per lo storyboard: si rende e basta, dicendolo. */
export const STORYBOARD_MIN_MS = 90_000;

/**
 * I fotogrammi dello storyboard: uno per scena quando il sorgente dichiara le sue scene, lo
 * spargimento regolare quando non le dichiara (una composizione a `useCurrentFrame` senza
 * `<Sequence>` non ha battute da leggere, e indovinarle sarebbe peggio).
 */
export function storyboardFrames(source: string, durationInFrames: number): number[] {
	const beats = motionBeats(source, durationInFrames);
	if (!beats.length) return defaultStillFrames(durationInFrames, 4);
	if (beats.length <= MAX_STORYBOARD_FRAMES) return beats.map((b) => b.frame);
	// Più scene del tetto: si tiene la prima, l'ultima e un campione regolare in mezzo — mai le
	// prime otto, o la chiusura del video non la guarda nessuno.
	const step = (beats.length - 1) / (MAX_STORYBOARD_FRAMES - 1);
	return [
		...new Set(
			Array.from({ length: MAX_STORYBOARD_FRAMES }, (_, i) => beats[Math.round(i * step)]!.frame)
		)
	];
}

/**
 * Quello che un fotogramma non può mostrare, letto dal sorgente. Righe vuote = niente da dire:
 * un check che parla sempre è un check che nessuno legge.
 */
export function motionSourceFindings(source: string, fps: number): string[] {
	const out: string[] = [];
	const linear = (() => {
		try {
			return findLinearMotion(source);
		} catch {
			return [];
		}
	})();
	if (linear.length) {
		out.push(
			`MOVIMENTO LINEARE (un fotogramma non lo mostra, il sorgente sì) — ${formatEasingViolations(linear)}`
		);
	}
	const stalls = (() => {
		try {
			return findStaticTails(source);
		} catch {
			return [];
		}
	})();
	if (stalls.length) out.push(formatStasisViolations(stalls, fps));
	// I due numeri: quanto dura la composizione contro quanto coprono le scene. Se il brief della
	// QC non lo dice, il giudice guarda i fotogrammi e ci arriva comunque — ma li chiama
	// «anello debole» invece di «gli ultimi 75 fotogrammi sono vuoti».
	const arith = (() => {
		try {
			return findDurationMismatch(source);
		} catch {
			return null;
		}
	})();
	const arithText = formatDurationMismatch(arith, fps);
	if (arithText) out.push(arithText);
	const frozenText = (() => {
		try {
			return formatFrozenBackplate(findFrozenBackplate(source));
		} catch {
			return '';
		}
	})();
	if (frozenText) out.push(frozenText);
	const wow = (() => {
		try {
			return detectWowMechanisms(source);
		} catch {
			return null;
		}
	})();
	if (wow && wow.beats >= 4) {
		const missing: string[] = [];
		if (!wow.sharedElement) missing.push('un match-cut / elemento condiviso (MATCH_CUT_DOT, ELEMENT_CARRYOVER, SCENE_SHRINK_TO_DOT)');
		if (!wow.fullCanvasScale) missing.push('una scala a tutto schermo (FULL_CANVAS_SCALE, MASK_REVEAL_TYPE, WORD_ZOOM_CUT)');
		if (missing.length) {
			out.push(
				`${wow.beats} battute e manca ${missing.join(' e ')}. Il codice di ogni meccanismo è nel TRANSITIONS COOKBOOK che hai nel prompt: copia la voce più vicina e adattala. La QC boccia una composizione da 4+ battute senza queste forme, marker o non marker.`
			);
		}
	}
	// LA VOCE CHE NON C'È.
	//
	// Il gate sulla voce (`assertMotionVoiceGate`) controlla il PIAZZAMENTO della voce che esiste:
	// su un sorgente senza nemmeno un `<Audio>` esce subito con `voiced: false` e non dice niente.
	// Ma le craft specs impongono voce e musica ACCESE di default, e la rubrica del giudice conta
	// l'assenza di audio come difetto. Il trailer del 22/8 bocciato 3,5 aveva zero `<Audio>` e non
	// l'ha mai fatto notare nessuno prima che il file fosse fatto.
	// Qui è un RILIEVO, non un rifiuto: il silenzio a volte è la scelta giusta, e chi la fa deve
	// poterla fare — ma non per distrazione.
	if (!/<Audio\b/.test(source)) {
		out.push(
			'NESSUN <Audio> nella composizione: questo video uscirà MUTO. Le craft specs vogliono voce e musica accese di default — generate_voiceover per il parlato, generate_music per il letto. Se il silenzio è voluto, dillo all\'utente invece di lasciarlo scoprire a video fatto.'
		);
	}
	return out;
}

/**
 * Il cancello, con la sua memoria. Vive per la durata del turno (la closure dei tool), come
 * `renders` e `voiceovers` accanto a lui: è il turno l'unità in cui "l'ho già guardato" ha senso.
 */
export function createStoryboardGate() {
	const seen = new Set<string>();
	let refusals = 0;
	const key = (source: string) => createHash('sha1').update(source).digest('hex');
	return {
		/** True quando questa versione del sorgente non è ancora stata guardata e il tetto regge. */
		shouldStoryboard(source: string): boolean {
			return refusals < MAX_STORYBOARD_REFUSALS && !seen.has(key(source));
		},
		/** Segna questa versione come guardata e consuma un rifiuto. */
		record(source: string): { refusals: number; left: number } {
			seen.add(key(source));
			refusals += 1;
			return { refusals, left: Math.max(0, MAX_STORYBOARD_REFUSALS - refusals) };
		},
		get refusals() {
			return refusals;
		}
	};
}
