/**
 * IL GATE ARITMETICO SULLA VOCE — la parte che legge i file e boccia.
 *
 * Sta sul punto di CONSEGNA, non di composizione: `renderMotionMp4` (render-tools.ts) lo chiama
 * prima di aprire la VM, quindi nessun percorso — tool dell'agente, chat, rotta del designer —
 * può produrre un MP4 che lo viola. Il caso guida è il trailer `anomalia` del 21/8/2026 21:23:
 * 6 battute nello script, 3 pause nel take, 4 pezzi tagliati indovinando, beat 4 e 5 muti, pezzo 3
 * troncato a metà parola, video che finisce a metà frase. Tre gate esistenti (wow, stasi,
 * legibility) guardavano la VISTA; questo è il primo che ascolta.
 *
 * Niente modello e niente decodifica esotica: i pezzi di voce sono WAV nel nostro storage,
 * `pcmFromWav` (voiceover-cut.ts) li apre con aritmetica su Int16 — gli stessi strumenti con cui
 * sono stati tagliati. Costo per render: qualche fetch dal nostro storage, zero AI.
 *
 * Regole (tutte deterministiche, tutte sui frame o sui campioni):
 *  1. un pezzo TRONCATO — coda non silenziosa — non si consegna (tailIsTruncated);
 *  2. un pezzo che ECCEDE il suo beat, o che suona oltre la fine della composizione meno il
 *     margine (checkVoicePlacement), non si consegna;
 *  3. se la composizione piazza MENO del 60% del take registrato, delle battute sono state
 *     buttate (i beat muti del caso guida) — non si consegna;
 *  4. un URL di voce che non si legge suonerebbe come un beat muto nel file finale — non si
 *     consegna.
 *
 * Il rimedio è sempre lo stesso ed è nel messaggio: SE LA VOCE NON CI STA, SI ALLUNGA IL VIDEO —
 * mai il contrario. Era già la regola scritta in craft.ts; da qui in poi è codice.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { isOwnStorageUrl } from '$lib/storage-url';
import { pcmFromWav } from '$lib/server/voiceover-cut';
import {
	VOICE_COVERAGE_MIN,
	VOICE_END_MARGIN_S,
	beatsWithoutVoice,
	checkVoicePlacement,
	findVoiceAudioRefs,
	tailIsTruncated
} from '$lib/motion-video/voice-gate';

/**
 * La forma di un url di take valido, PRIMA di qualunque fetch. Il modello a volte ricostruisce
 * l'url a memoria — brand id storpiato, segmento `/voiceover/` perso — e il taglio moriva con un
 * "Could not read the recording back (400)" opaco. Un take vero sta nel NOSTRO storage e sotto
 * `/voiceover/`: tutto il resto non va nemmeno tentato. (Era in output-tools.ts; vive qui perché
 * il gate ne ha bisogno e output-tools importa già da questo lato.)
 */
export function isVoiceoverTakeUrl(url: string, supabaseUrl: string = publicEnv.PUBLIC_SUPABASE_URL): boolean {
	return isOwnStorageUrl(url, supabaseUrl) && url.includes('/voiceover/');
}

/**
 * L'ultimo take INTERO di voce registrato per il brand, ritrovato dallo storage — che è la
 * persistenza che esiste già (`gemini-audio.ts` carica ogni take come `<uuid>-full.wav`). Serve a
 * `cut_voiceover` nelle slice di continuazione e alla regola di copertura di questo gate.
 */
export async function latestVoiceoverTakeUrl(
	supabase: SupabaseClient,
	brandId: string
): Promise<string | null> {
	const { data, error } = await supabase.storage
		.from('media')
		.list(`${brandId}/voiceover`, { limit: 30, sortBy: { column: 'created_at', order: 'desc' } });
	if (error || !data) return null;
	const full = data.find((f) => f.name.endsWith('-full.wav'));
	if (!full) return null;
	return supabase.storage.from('media').getPublicUrl(`${brandId}/voiceover/${full.name}`).data
		.publicUrl;
}

export class MotionVoiceGateError extends Error {
	name = 'MotionVoiceGateError';
	violations: string[];
	/** Il brief da applicare: cosa allungare, di quanto, e cosa NON fare (tagliare la voce). */
	remedy: string;
	constructor(violations: string[], remedy: string) {
		super(`Voice gate failed: ${violations.join(' · ')}`);
		this.violations = violations;
		this.remedy = remedy;
	}
}

/** Durata e coda di un WAV di voce, con aritmetica Int16 e zero dipendenze. */
async function readVoiceWav(
	url: string
): Promise<{ seconds: number; truncated: boolean } | { unreadable: string }> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
		if (!res.ok) return { unreadable: `HTTP ${res.status}` };
		const { samples, sampleRate, channels } = pcmFromWav(new Uint8Array(await res.arrayBuffer()));
		const seconds = samples.length / (sampleRate * Math.max(1, channels));
		// La troncatura si giudica solo sul mono (i take di voce lo sono sempre): su uno stereo i
		// campioni sono interleaved e la finestra di coda mischierebbe i canali.
		const truncated = channels === 1 ? tailIsTruncated(samples, sampleRate) : false;
		return { seconds, truncated };
	} catch (e) {
		return { unreadable: e instanceof Error ? e.message : String(e) };
	}
}

export type MotionVoiceGateResult = {
	/** false = la composizione non parla: niente da controllare (il giudice di craft dirà se doveva). */
	voiced: boolean;
	checkedClips: number;
};

/**
 * Lancia `MotionVoiceGateError` se il video NON va consegnato. Ritorna in silenzio se passa.
 * `supabaseUrl` è iniettabile solo per i test.
 */
export async function assertMotionVoiceGate(opts: {
	supabase: SupabaseClient;
	brandId: string;
	source: string;
	fps: number;
	durationInFrames: number;
	supabaseUrl?: string;
}): Promise<MotionVoiceGateResult> {
	const refs = findVoiceAudioRefs(opts.source);
	if (!refs.length) return { voiced: false, checkedClips: 0 };
	const fps = opts.fps > 0 ? opts.fps : 30;
	const urls = [...new Set(refs.map((r) => r.url))];

	const violations: string[] = [];
	const clips: Array<{ url: string; seconds: number }> = [];
	for (const url of urls) {
		if (!isVoiceoverTakeUrl(url, opts.supabaseUrl)) {
			violations.push(
				`"${url.slice(0, 120)}" non è un take/pezzo di voce di questo brand: nel file finale quel beat suonerebbe MUTO. Usa esattamente gli url tornati da generate_voiceover/cut_voiceover.`
			);
			continue;
		}
		const read = await readVoiceWav(url);
		if ('unreadable' in read) {
			violations.push(
				`la voce ${url.split('/').pop()} non si legge (${read.unreadable}): nel file finale quel beat suonerebbe MUTO.`
			);
			continue;
		}
		clips.push({ url, seconds: read.seconds });
		if (read.truncated) {
			// Il pezzo 3 del caso guida: il taglio è caduto DENTRO una parola, non su una pausa.
			violations.push(
				`il pezzo ${url.split('/').pop()} è TRONCATO a metà parola (la coda non finisce nel silenzio). Ritaglia il take con cut_voiceover scegliendo un timestamp dentro una pausa VERA dell'elenco \`pauses\` — mai a orecchio.`
			);
		}
	}

	// Copertura del take: quanta della voce registrata suona davvero nel video. Se il take intero
	// è piazzato com'è, la copertura è soddisfatta per costruzione.
	const placedSeconds = clips.reduce((acc, c) => acc + c.seconds, 0);
	const fullPlaced = clips.some((c) => c.url.endsWith('-full.wav'));
	if (clips.length && !fullPlaced) {
		const takeUrl = await latestVoiceoverTakeUrl(opts.supabase, opts.brandId).catch((error) => { swallow('latest voiceover take url', error); return null; });
		// I pezzi non portano il nome del loro take: si confronta con l'ULTIMO take del brand, che
		// al momento del render è quello della sessione. Un take più vecchio e più lungo potrebbe
		// far scattare la regola a torto — per questo la soglia è al 60%, non al 90.
		if (takeUrl) {
			const take = await readVoiceWav(takeUrl);
			if (!('unreadable' in take) && take.seconds > 1 && placedSeconds < VOICE_COVERAGE_MIN * take.seconds) {
				const mute = beatsWithoutVoice(opts.source);
				violations.push(
					`il take registrato dura ${take.seconds.toFixed(1)}s ma nella composizione ne suonano solo ${placedSeconds.toFixed(1)}: delle battute dello script NON si sentono da nessuna parte${
						mute.length ? ` (beat senza voce: ${mute.slice(0, 6).join(', ')})` : ''
					}. Ogni battuta va nel suo beat — se non ci sta, ALLUNGA la composizione, non tagliare la voce.`
				);
			}
		}
	}

	// L'aritmetica sui frame: pezzo vs beat, e ultima voce vs fine del video.
	const placement = checkVoicePlacement(opts.source, clips, {
		fps,
		durationInFrames: opts.durationInFrames
	});
	let neededFrames = 0;
	for (const v of placement) {
		if (v.rule === 'piece_exceeds_beat') {
			violations.push(
				`il pezzo ${v.url.split('/').pop()} dura ${v.clipFrames} frame ma il beat ${v.component} ne ha ${v.beatFrames}: la battuta verrebbe mozzata. Porta il beat ad almeno ${v.clipFrames + Math.round(VOICE_END_MARGIN_S * fps)} frame.`
			);
		} else {
			neededFrames = Math.max(neededFrames, v.endFrame + v.marginFrames);
			violations.push(
				`la voce ${v.url.split('/').pop()} suona fino al frame ${v.endFrame} ma il video finisce al ${v.durationInFrames} (margine minimo ${v.marginFrames} frame = ${VOICE_END_MARGIN_S}s): finirebbe a metà frase.`
			);
		}
	}

	if (violations.length) {
		const extend = neededFrames > opts.durationInFrames ? neededFrames : null;
		throw new MotionVoiceGateError(
			violations,
			[
				'LA VOCE NON CI STA NEL VIDEO — e la regola è: si allunga il video, MAI si taglia la voce.',
				extend
					? `Porta \`export const durationInFrames\` ad almeno ${extend} (oggi ${opts.durationInFrames}) e allunga di conseguenza l'ultimo beat.`
					: 'Allunga i beat nominati qui sopra finché ogni battuta ci sta con il suo margine di mezzo secondo.',
				'Se un pezzo è troncato, il difetto è il TAGLIO: richiama cut_voiceover su una pausa vera (gratis), non generate_voiceover.',
				'Poi rendi di nuovo. Il render è stato RIFIUTATO prima di aprire la VM: non è costato nulla.'
			].join(' ')
		);
	}
	return { voiced: true, checkedClips: clips.length };
}
