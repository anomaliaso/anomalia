/**
 * IL GATE ARITMETICO SULLA VOCE — la parte pura, senza rete.
 *
 * Il caso che l'ha reso necessario è del 21/8/2026, brand `anomalia`, 21:23: uno script di 6
 * battute, un take TTS con solo 3 pause, il modello che taglia 4 pezzi indovinando — i beat 4 e 5
 * muti, il pezzo 3 troncato a metà parola (misurato: −10,8 dB negli ultimi 300 ms), 6,28 s di
 * voce su 22,5 s di video che finisce a metà frase ("…e il team"). Nessuna review l'ha mai
 * guardato. La regola "se la voce non ci sta, allunga il video" esisteva SOLO come prosa in
 * craft.ts, e la prosa non ferma un render.
 *
 * Come il gate wow e il gate stasi (transitions-cookbook.ts, easing.ts): deterministico, sui
 * frame, senza modello. Questo file misura e basta; chi legge i WAV e decide di bocciare sta in
 * `$lib/server/motion-video/voice-gate.ts`. Conservativo nella stessa direzione degli altri due:
 * un'espressione che non si risolve non produce un verdetto — meglio una violazione non vista che
 * un render rifiutato a torto.
 */
import { collectConsts, resolveNumber, stripNonCode } from './easing';

/**
 * L'ultimo campione di parlato deve precedere la fine del video di almeno mezzo secondo.
 *
 * Perché 0.5 s: la coda naturale di una sillaba finale decade in ~250–300 ms (misurato sui pezzi
 * sani del take del 21/8) — servono nel video, o l'orecchio sente un taglio anche se la parola è
 * "intera". Il resto è margine per l'arrotondamento in frame e per l'encoder. Mezzo secondo è il
 * minimo che rende la chiusura UDIBILE invece che mozzata; di più sarebbe gusto, non aritmetica.
 */
export const VOICE_END_MARGIN_S = 0.5;

/** La finestra di coda in cui un pezzo tagliato bene DEVE essere silenzioso (vedi tailIsTruncated). */
export const VOICE_TAIL_WINDOW_S = 0.12;

/**
 * Stessa soglia di `findGaps` (voiceover-cut.ts): sotto questa frazione del fondo scala un
 * campione è silenzio. Duplicata qui perché quel file è `$lib/server` e questo no; il valore è
 * uno solo e questo commento è il filo che li lega.
 */
export const VOICE_TAIL_THRESHOLD = 0.02;

/**
 * Sotto questa frazione del take piazzata nella composizione, delle battute sono state buttate.
 *
 * Un take piazzato per intero somma ≈ la sua durata (i pezzi di `cutAtSeconds` coprono TUTTA la
 * registrazione, silenzi compresi). 0.6 non scatta su un trim di respiri: scatta sul caso guida,
 * dove 6,28 s piazzati su ~16 s di take vale 0.39 — cioè metà copione mai sentito.
 */
export const VOICE_COVERAGE_MIN = 0.6;

export type VoiceAudioRef = {
	url: string;
	/** Offset nel sorgente originale (valido anche in stripNonCode, che preserva la lunghezza). */
	index: number;
};

/** Gli URL di voce nel sorgente: solo roba sotto `/voiceover/` — la musica vive sotto `/music/`. */
export function findVoiceAudioRefs(source: string): VoiceAudioRef[] {
	const out: VoiceAudioRef[] = [];
	for (const m of source.matchAll(/https?:\/\/[^"'`\s)}]+\/voiceover\/[^"'`\s)}]+/g)) {
		out.push({ url: m[0], index: m.index! });
	}
	return out;
}

/**
 * Un pezzo tagliato su una PAUSA VERA finisce nel silenzio da cui è stato tagliato: la sua coda è
 * quieta per costruzione (il taglio cade al centro di ≥180 ms di silenzio). Un pezzo troncato a
 * metà parola — il pezzo 3 del caso guida — ha voce fino all'ultimo campione. Quindi: se più del
 * 20% della finestra di coda sta sopra la soglia di silenzio, il taglio è caduto DENTRO il
 * parlato. Il 20% assorbe click e fruscio; una parola vera riempie la finestra quasi tutta.
 */
export function tailIsTruncated(samples: Int16Array, sampleRate: number): boolean {
	if (!samples.length) return false;
	const win = Math.min(samples.length, Math.max(1, Math.round(VOICE_TAIL_WINDOW_S * sampleRate)));
	const cutoff = Math.max(1, Math.round(VOICE_TAIL_THRESHOLD * 32768));
	let loud = 0;
	for (let i = samples.length - win; i < samples.length; i++) {
		if (Math.abs(samples[i]) >= cutoff) loud++;
	}
	return loud > win * 0.2;
}

export type VoicePlacementViolation =
	| {
			rule: 'piece_exceeds_beat';
			url: string;
			component: string;
			clipFrames: number;
			beatFrames: number;
	  }
	| {
			rule: 'voice_past_end';
			url: string;
			/** Frame assoluto in cui il pezzo finirebbe di suonare. */
			endFrame: number;
			durationInFrames: number;
			marginFrames: number;
	  };

const HOST_SEQUENCE_RE =
	/<(?:TransitionSeries\.Sequence|Series\.Sequence|Sequence)\b[^>]*?durationInFrames=\{([^}]+)\}[^>]*>[^<]*<([A-Z][\w$]*)/g;

/** Le dichiarazioni top-level, come in findStaticTails: da qui si sa in che componente sta un indice. */
function componentDecls(code: string): Array<{ name: string; start: number }> {
	const decls: Array<{ name: string; start: number }> = [];
	for (const m of code.matchAll(
		/(?:^|\n)(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z][\w$]*)\s*\(|const\s+([A-Z][\w$]*)\s*(?::[^=\n]*)?=)/g
	)) {
		decls.push({ name: m[1] ?? m[2], start: m.index! });
	}
	return decls.sort((a, b) => a.start - b.start);
}

/** Il tag `<Audio …>` che contiene l'indice dato, o null. Serve a leggere trim e wrapper. */
function enclosingTag(source: string, index: number): string | null {
	const open = source.lastIndexOf('<', index);
	if (open < 0) return null;
	const close = source.indexOf('>', index);
	if (close < 0) return null;
	return source.slice(open, close + 1);
}

/**
 * Le violazioni ARITMETICHE di piazzamento: un pezzo che eccede il suo beat, o che suona oltre la
 * fine della composizione (margine incluso — vedi VOICE_END_MARGIN_S). `clips` porta le durate
 * REALI in secondi, lette dai WAV da chi chiama: qui non c'è rete.
 *
 * Conservativo: un `<Audio>` con trim (`startFrom`/`endAt`/`trimBefore`/`trimAfter`) suona meno
 * del file e non è giudicabile con questa aritmetica — si salta. Un beat o un `from` che non si
 * risolve — si salta. Quando parla, ha ragione.
 */
export function checkVoicePlacement(
	source: string,
	clips: Array<{ url: string; seconds: number }>,
	meta: { fps: number; durationInFrames: number }
): VoicePlacementViolation[] {
	const fps = meta.fps > 0 ? meta.fps : 30;
	const marginFrames = Math.round(VOICE_END_MARGIN_S * fps);
	const seconds = new Map(clips.map((c) => [c.url, c.seconds]));
	const code = stripNonCode(source);
	const consts = collectConsts(code);
	const decls = componentDecls(code);

	// component → durata del beat che lo ospita (la peggiore = la più corta, qui: taglierebbe prima).
	const hosted = new Map<string, number>();
	for (const m of code.matchAll(HOST_SEQUENCE_RE)) {
		const frames = resolveNumber(m[1], consts);
		if (frames == null || frames <= 0) continue;
		const prev = hosted.get(m[2]);
		if (prev == null || frames < prev) hosted.set(m[2], frames);
	}

	// Tutte le aperture di Sequence con i loro attributi, per il caso `<Sequence …><Audio …/>`.
	const seqOpens: Array<{ index: number; from: number | null; frames: number | null }> = [];
	for (const m of code.matchAll(
		/<(?:TransitionSeries\.Sequence|Series\.Sequence|Sequence)\b[^>]*>/g
	)) {
		const tag = m[0];
		const fromAttr = /\bfrom=\{([^}]+)\}/.exec(tag);
		const durAttr = /\bdurationInFrames=\{([^}]+)\}/.exec(tag);
		seqOpens.push({
			index: m.index!,
			from: fromAttr ? resolveNumber(fromAttr[1], consts) : null,
			frames: durAttr ? resolveNumber(durAttr[1], consts) : null
		});
	}

	const out: VoicePlacementViolation[] = [];
	for (const ref of findVoiceAudioRefs(source)) {
		const clipSeconds = seconds.get(ref.url);
		if (clipSeconds == null || !(clipSeconds > 0)) continue;
		const clipFrames = Math.ceil(clipSeconds * fps);

		const tag = enclosingTag(source, ref.index);
		// Un Audio con trim suona una fetta del file: l'aritmetica qui sotto non vale. Si salta.
		if (tag && /\b(?:startFrom|endAt|trimBefore|trimAfter)=/.test(tag)) continue;

		// In che componente sta questo Audio, e quanto dura il beat che ospita quel componente.
		let decl: { name: string; start: number } | null = null;
		for (const d of decls) if (d.start <= ref.index) decl = d;
		let beatFrames = decl ? (hosted.get(decl.name) ?? null) : null;
		const component = decl?.name ?? '(root)';

		// Il wrapper diretto: `<Sequence from={F} durationInFrames={D}><Audio …/>` nel componente
		// stesso. Vince sul beat ospitante quando è più vicino all'Audio.
		let from: number | null = null;
		let nearest: (typeof seqOpens)[number] | null = null;
		for (const s of seqOpens) {
			if (s.index < ref.index && (!decl || s.index >= decl.start)) nearest = s;
		}
		if (nearest) {
			if (nearest.frames != null && nearest.frames > 0) {
				beatFrames = beatFrames == null ? nearest.frames : Math.min(beatFrames, nearest.frames);
			}
			from = nearest.from;
		}

		if (beatFrames != null && clipFrames > beatFrames) {
			out.push({ rule: 'piece_exceeds_beat', url: ref.url, component, clipFrames, beatFrames });
		}

		// Fine assoluta: solo dove `from` è leggibile (Sequence semplice) o dove l'Audio suona dal
		// frame 0 (nessuna Sequence attorno). Dentro una TransitionSeries il `from` è implicito e
		// non si giudica.
		const isTransitionHosted = decl ? code.slice(decl.start, ref.index).includes('TransitionSeries') : false;
		const startFrame = from != null ? from : nearest == null && !isTransitionHosted ? 0 : null;
		if (startFrame != null) {
			const endFrame = startFrame + clipFrames;
			if (endFrame > meta.durationInFrames - marginFrames) {
				out.push({
					rule: 'voice_past_end',
					url: ref.url,
					endFrame,
					durationInFrames: meta.durationInFrames,
					marginFrames
				});
			}
		}
	}
	return out;
}

/**
 * I beat (componenti ospitati in una Sequence, come in findStaticTails) senza NESSUN pezzo di
 * voce, né proprio né in un figlio diretto. Non è una violazione da solo — un hook può tacere di
 * proposito — ma quando la copertura del take è bassa, questi sono i nomi delle battute mute.
 */
export function beatsWithoutVoice(source: string): string[] {
	const code = stripNonCode(source);
	const decls = componentDecls(code);
	if (!decls.length) return [];
	const slices = new Map<string, string>();
	for (let i = 0; i < decls.length; i++) {
		const end = i + 1 < decls.length ? decls[i + 1].start : code.length;
		// Lo slice si legge dal SORGENTE (stripNonCode maschera le stringhe, e gli URL sono stringhe).
		slices.set(decls[i].name, source.slice(decls[i].start, end));
	}
	const voiced = new Set<string>();
	for (const [name, slice] of slices) {
		if (/\/voiceover\//.test(slice)) voiced.add(name);
	}
	const hosted: string[] = [];
	for (const m of code.matchAll(HOST_SEQUENCE_RE)) {
		if (!hosted.includes(m[2])) hosted.push(m[2]);
	}
	return hosted.filter((name) => {
		if (voiced.has(name)) return false;
		const slice = slices.get(name) ?? '';
		for (const child of slice.matchAll(/<([A-Z][\w$]*)[\s/>]/g)) {
			if (voiced.has(child[1])) return false;
		}
		return true;
	});
}
