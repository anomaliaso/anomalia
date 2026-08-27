/**
 * DOVE SONO LE SCENE, lette dal TSX — il pezzo che mancava per guardare un video PRIMA di farlo.
 *
 * `render_stills` sapeva rendere qualsiasi fotogramma, ma non sapeva QUALI: senza indicazioni
 * spargeva N fotogrammi a intervalli regolari sulla clip. Su una composizione a sei battute con
 * quattro still, due battute non venivano guardate da nessuno — e le battute non durano uguali,
 * quindi quella lunga finiva fotografata due volte e quella corta mai.
 *
 * Qui il sorgente dice dove sono i tagli, perché li ha scritti lui: `<Series.Sequence>`,
 * `<TransitionSeries.Sequence>` o `<Sequence from=…>`. Da lì esce UN fotogramma per scena, ed è
 * lo storyboard: la cosa che il proprietario ha chiesto di poter guardare prima di spendere il
 * render vero.
 *
 * ## Il fotogramma scelto, e perché non è il centro
 *
 * Al 55% della battuta. L'inizio è l'entrata (metà degli elementi non è ancora arrivata), la fine
 * è la transizione di uscita (metà è già andata via): entrambi mostrano una composizione che
 * l'occhio dello spettatore non vede mai ferma. Il 55% è dopo che tutto è entrato e prima che
 * qualcosa esca — la posa che la scena tiene, che è quella da giudicare.
 *
 * ## Quello che questa lettura NON vede, e va detto
 *
 * Un fotogramma non ha movimento. Code morte, interpolazioni lineari, transizioni che leggono
 * come tagli secchi, ritmo: nessuna di queste cose si vede in uno still, e nessuna va cercata
 * qui. Le vedono i controlli aritmetici sul sorgente (`findStaticTails`, `findLinearMotion`,
 * `detectWowMechanisms`), che girano sullo stesso TSX. Storyboard e aritmetica sono le due metà,
 * non due modi di fare la stessa cosa.
 */
import { collectConsts, resolveNumber, stripNonCode } from './easing';

export type MotionBeat = {
	/** 1-based, nell'ordine in cui appaiono nel sorgente. */
	index: number;
	startFrame: number;
	durationInFrames: number;
	/** Il fotogramma da rendere per questa scena. */
	frame: number;
};

/** Il tag di una scena e il suo attributo `durationInFrames` / `from` / `offset`. */
const SEQUENCE_TAG = /<(?:(?:Transition)?Series\.Sequence|Sequence)\b[^>]*>/g;
const TRANSITION_TAG = /<TransitionSeries\.Transition\b[^>]*>/g;

function attr(tag: string, name: string, consts: Map<string, number>): number | null {
	// `durationInFrames={…}` con un'espressione dentro le graffe, oppure `="90"`.
	const braced = new RegExp(`\\b${name}\\s*=\\s*\\{([^}]*)\\}`).exec(tag);
	if (braced) return resolveNumber(braced[1], consts);
	const quoted = new RegExp(`\\b${name}\\s*=\\s*["'](\\d+)["']`).exec(tag);
	return quoted ? Number(quoted[1]) : null;
}

/**
 * Le scene del sorgente, in ordine, con il fotogramma da guardare per ognuna.
 *
 * Vuoto quando il sorgente non dichiara scene leggibili (una composizione a `useCurrentFrame`
 * senza `<Sequence>`, o durate che non si risolvono): chi chiama ripiega sullo spargimento
 * regolare. Meglio nessuno storyboard che uno storyboard sbagliato — un fotogramma attribuito
 * alla scena sbagliata fa correggere all'agente una scena che non ha il difetto.
 */
export function motionBeats(source: string, durationInFrames: number): MotionBeat[] {
	const total = Math.max(1, Math.floor(durationInFrames));
	const code = stripNonCode(source);
	const consts = collectConsts(code);

	type Tag = { at: number; text: string; kind: 'seq' | 'trans' };
	const tags: Tag[] = [];
	for (const m of code.matchAll(SEQUENCE_TAG)) tags.push({ at: m.index!, text: m[0], kind: 'seq' });
	for (const m of code.matchAll(TRANSITION_TAG)) {
		// `<TransitionSeries.Transition>` matcha anche SEQUENCE_TAG? No: quel pattern chiede
		// `.Sequence`. Ma le transizioni vanno raccolte lo stesso, perché ACCORCIANO la timeline.
		tags.push({ at: m.index!, text: m[0], kind: 'trans' });
	}
	tags.sort((a, b) => a.at - b.at);
	if (!tags.some((t) => t.kind === 'seq')) return gatedBeats(code, consts, total);

	const beats: MotionBeat[] = [];
	let cursor = 0;
	for (const tag of tags) {
		if (tag.kind === 'trans') {
			// In una TransitionSeries la transizione SOVRAPPONE le due sequenze che separa: la
			// timeline si accorcia della sua durata. Ignorarlo sposta in avanti ogni scena
			// successiva, cioè fotografa la scena sbagliata proprio nei video ben fatti.
			//
			// La durata qui non è un attributo del tag ma un argomento del timing
			// (`timing={linearTiming({ durationInFrames: 20 })}`), quindi si legge col due punti.
			// ponytail: `springTiming` non dichiara fotogrammi e non si indovina — quella
			// transizione non viene sottratta, e le scene dopo di lei risultano spostate in avanti
			// al più della sua durata (~mezzo secondo). Si accetta: lo still resta dentro la scena.
			const m = /\bdurationInFrames\s*[:=]\s*\{?\s*([^,})]+)/.exec(tag.text);
			const t = m ? resolveNumber(m[1], consts) : null;
			if (t != null && t > 0) cursor -= t;
			continue;
		}
		const dur = attr(tag.text, 'durationInFrames', consts);
		if (dur == null || dur <= 0) return [];
		const from = attr(tag.text, 'from', consts);
		const offset = attr(tag.text, 'offset', consts) ?? 0;
		const start = from != null ? from : cursor + offset;
		if (start < 0 || start >= total) {
			cursor = Math.max(cursor, start + dur);
			continue;
		}
		const usable = Math.min(dur, total - start);
		beats.push({
			index: beats.length + 1,
			startFrame: start,
			durationInFrames: dur,
			frame: Math.min(total - 1, start + Math.round(usable * 0.55))
		});
		cursor = from != null ? Math.max(cursor, from + dur) : start + dur;
	}
	return beats;
}

/**
 * LE SCENE SCRITTE A MANO, che è come il modello le scrive davvero.
 *
 * Sonda del 22/8/2026 su un trailer vero in produzione (18s, giudizio 3,5 «kill»): **zero**
 * `<Sequence>` di qualunque tipo. Tredici `<AbsoluteFill>` accesi e spenti da condizioni sul
 * frame — `frame >= 82 && frame < 172` — e sei battute che nessun lettore di tag può vedere.
 * Il ricettario insegna le `<Series.Sequence>`, il modello scrive i confronti: leggere solo i
 * tag significa non leggere niente proprio sulle composizioni che finiscono in produzione.
 *
 * Si accetta una coppia solo se ha ENTRAMBI i lati (inizio e fine): un `frame > 60` da solo è
 * una condizione qualsiasi — l'opacità di un accento, un cursore che appare — non un confine di
 * scena, e prenderlo per tale sposterebbe ogni fotogramma dopo di lui.
 */
function gatedBeats(code: string, consts: Map<string, number>, total: number): MotionBeat[] {
	const spans: Array<[number, number]> = [];
	for (const m of code.matchAll(
		/frame\s*(>=|>)\s*([\w$.]+)\s*&&\s*frame\s*(<=|<)\s*([\w$.]+)/g
	)) {
		const from = resolveNumber(m[2], consts);
		const to = resolveNumber(m[4], consts);
		if (from == null || to == null || to <= from) continue;
		const start = m[1] === '>' ? from + 1 : from;
		const end = m[3] === '<=' ? to + 1 : to;
		if (start >= total) continue;
		spans.push([start, Math.min(total, end)]);
	}
	if (spans.length < 2) return [];
	// I DUE ESTREMI, che sono scritti a un lato solo perché non hanno un lato.
	//
	// La prima battuta è `frame < 92` e l'ultima `frame >= 436`: nessuna delle due ha la coppia,
	// quindi il filtro qui sopra le scarta — e sono l'apertura e la CTA, cioè i due secondi che
	// decidono se qualcuno guarda e se qualcuno clicca. Non serve leggerle: esistono per
	// costruzione, un video ha sempre qualcosa al frame 0 e qualcosa alla fine.
	// Stesso intervallo scritto in due componenti della stessa battuta: è una scena, non due.
	const seen = new Set<string>();
	const unique = spans
		.filter(([a, b]) => (seen.has(`${a}:${b}`) ? false : (seen.add(`${a}:${b}`), true)))
		.sort((x, y) => x[0] - y[0]);
	if (unique[0]![0] > 1) unique.unshift([0, unique[0]![0]]);
	const last = unique[unique.length - 1]!;
	if (last[1] < total - 1) unique.push([last[1], total]);
	return unique.map(([start, end], i) => {
		const dur = end - start;
		return {
			index: i + 1,
			startFrame: start,
			durationInFrames: dur,
			frame: Math.min(total - 1, start + Math.round(dur * 0.55))
		};
	});
}
