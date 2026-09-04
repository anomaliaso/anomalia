/**
 * Voce e musica per i motion video: qui la parte che tocca la rete (generare, incapsulare,
 * caricare). Il taglio è puro e sta in `voiceover-cut.ts`, testabile senza una chiave API.
 *
 * **UNA generazione, sempre.** `generateVoiceOver` prende tutte le righe e fa una chiamata sola:
 * non è risparmio, è che due generazioni non danno la stessa voce nemmeno con lo stesso
 * `voiceName` — timbro e intonazione ripartono da capo, e sei beat generati uno per uno sono sei
 * persone diverse che leggono lo stesso copione. Si genera una volta e si taglia.
 *
 * Le righe si uniscono chiedendo una pausa esplicita: è il silenzio a dire dove tagliare, quindi va
 * chiesto. `findGaps` riporta le pause come CANDIDATI — chi decide è l'agente, che ha il copione.
 *
 * Gli id dei modelli si leggono dall'ambiente: la suite audio di Gemini si muove più in fretta
 * della nostra release, e un id cablato costa un deploy mentre una variabile costa un minuto.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { env } from '$env/dynamic/private';
import { logAiCall } from '$lib/server/ai-log';
import { generateSpeechOnKie, kieFlatCostUsd, kieTtsModel } from '$lib/server/kie-jobs';
import { route } from '$lib/server/model-routing';
import {
	LYRIA_CLIP_SECONDS,
	LYRIA_COST_USD,
	llmChatCompletions,
	lyriaModel,
	musicBytesFromChatCompletion,
	type MusicTier
} from '$lib/server/llm';
import {
	TTS_PCM,
	cutAtSeconds,
	findGaps,
	pcmFromWav,
	planCuts,
	sliceToWav,
	type DroppedCut,
	type Gap
} from '$lib/server/voiceover-cut';

/** Il modello TTS. Sovrascrivibile senza deploy — vedi l'intestazione. */
export function ttsModel(): string {
	return env.GEMINI_TTS_MODEL?.trim() || 'gemini-2.5-flash-preview-tts';
}

/**
 * Le voci che offriamo, non tutte quelle che esistono: trenta nomi in un tool è un elenco che il
 * modello sceglie a caso. Poche e caratterizzate — si sceglie un REGISTRO, non un nome proprio.
 */
export const VOICE_OVER_VOICES = {
	kore: 'Kore — neutral and steady. The default: it does not act, it reads.',
	puck: 'Puck — brighter and quicker, for something playful.',
	charon: 'Charon — deeper and slower, for something serious or premium.',
	aoede: 'Aoede — warm, conversational, closer to a person talking than to a narrator.',
	fenrir: 'Fenrir — hard and direct, for a challenge or a provocation.'
} as const;
export type VoiceOverVoice = keyof typeof VOICE_OVER_VOICES;
export const DEFAULT_VOICE: VoiceOverVoice = 'kore';

export function isVoiceOverVoice(v: unknown): v is VoiceOverVoice {
	return typeof v === 'string' && Object.prototype.hasOwnProperty.call(VOICE_OVER_VOICES, v);
}

/** Nome del preset lato Gemini: le chiavi qui sono minuscole, i voiceName sono capitalizzati. */
function voiceName(v: VoiceOverVoice): string {
	return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * Un tentativo in più, uno solo: un 500 qui è quasi sempre passeggero, ma se non lo è, riprovare
 * cinque volte ritarda l'errore vero e consuma il tempo che serviva a finire il video.
 */
/**
 * Il messaggio di un errore che non è un `Error`: `String(ErrorEvent)` vale `"[object Object]"`, e
 * finiva tale e quale nel dettaglio riferito all'utente. Qui si cercano i campi dove un messaggio
 * vero può stare, e in ultima istanza si serializza invece di concatenare.
 */
export function errorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === 'string') return e;
	if (e && typeof e === 'object') {
		const o = e as Record<string, unknown>;
		for (const k of ['message', 'reason', 'error', 'detail', 'statusText']) {
			const v = o[k];
			if (typeof v === 'string' && v.trim()) return v;
			if (v && typeof v === 'object') {
				const inner = (v as Record<string, unknown>).message;
				if (typeof inner === 'string' && inner.trim()) return inner;
			}
		}
		try {
			const json = JSON.stringify(e);
			if (json && json !== '{}') return json.slice(0, 500);
		} catch {
			/* oggetti ciclici: si cade sul fallback qui sotto */
		}
	}
	return 'unknown error';
}

export async function withRetry<T>(fn: () => Promise<T>, retryable: (e: unknown) => boolean): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (!retryable(e)) throw e;
		await new Promise((r) => setTimeout(r, 1500));
		return fn();
	}
}

/**
 * La pausa fra le righe è ciò che rende tagliabile il risultato, quindi si chiede esplicitamente e
 * in modo misurabile. E si chiede di NON recitare: un TTS libero su un copione pubblicitario fa la
 * voce dello spot, il registro esatto da cui questi video stanno lontani.
 */
export function voiceOverDirection(style?: string | null): string {
	const delivery =
		style?.trim() ||
		'calm and matter-of-fact, like someone explaining something to a colleague — not performing, not selling, no announcer energy';
	return `Read this aloud, ${delivery}. Pause for a full beat between paragraphs.`;
}

export function buildVoiceOverPrompt(lines: string[], style?: string | null): string {
	const clean = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
	// Una riga di stile e poi SOLO il testo, righe separate da una riga vuota. Niente numerazione:
	// chiedere a un modello che parla di ignorare parte di ciò che gli si dà è un modo affidabile
	// di sentirselo leggere. La riga vuota è già la pausa su cui poi si taglia.
	return [voiceOverDirection(style), '', clean.join('\n\n')].join('\n');
}

export type VoiceOverPiece = {
	/** La riga del copione a cui questo pezzo corrisponde. */
	line: string;
	url: string;
	durationSeconds: number;
	startSeconds: number;
};

export type VoiceOverResult = {
	/** La registrazione intera: una voce sola, ed è quella che poi si taglia. */
	fullUrl: string;
	fullDurationSeconds: number;
	/** CANDIDATI: nessuna è un taglio finché non lo decide chi ha il copione. Vedi `findGaps`. */
	gaps: Gap[];
	voice: VoiceOverVoice;
};

async function uploadAudio(
	supabase: SupabaseClient,
	brandId: string,
	wav: Buffer,
	label: string
): Promise<string> {
	const path = `${brandId}/voiceover/${crypto.randomUUID()}-${label}.wav`;
	const { error } = await supabase.storage.from('media').upload(path, wav, {
		contentType: 'audio/wav',
		upsert: false
	});
	if (error) throw new Error(`Audio upload failed: ${error.message}`);
	return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

/**
 * UNA generazione, poi il taglio. Ogni pezzo porta la sua durata REALE: un beat si allunga per far
 * stare la sua riga, non si spera che ci stia.
 */
export async function generateVoiceOver(opts: {
	supabase: SupabaseClient;
	brandId: string;
	userId?: string;
	lines: string[];
	voice?: VoiceOverVoice;
	style?: string | null;
	languageCode?: string | null;
	abortSignal?: AbortSignal;
}): Promise<VoiceOverResult> {
	const lines = opts.lines.map((l) => String(l ?? '').trim()).filter(Boolean);
	if (!lines.length) throw new Error('No lines to read.');
	const voice = opts.voice && isVoiceOverVoice(opts.voice) ? opts.voice : DEFAULT_VOICE;
	/**
	 * La voce passa da kie: il centralino non fa TTS. Un endpoint diverso si ferma qui, senza
	 * cadere sullo SDK Google.
	 */
	const useKie = route('tts').endpoint === 'kie';
	const model = useKie ? kieTtsModel() : ttsModel();
	let credits: number | undefined;
	const t0 = Date.now();

	/**
	 * Il caricamento sta DENTRO il try apposta: fuori, uno storage che rifiuta il file lancia senza
	 * lasciare niente nel registro — né `ok:true` né `ok:false` — e la generazione risulta non
	 * essere mai avvenuta.
	 */
	let samples: Int16Array;
	let fullUrl: string;
	try {
		if (useKie) {
			const spoken = await generateSpeechOnKie({
				lines,
				// L'istruzione di recitazione NON può stare nel testo: verrebbe letta ad alta voce. Su
				// kie il campo libero è `sample_context`; `style` è un enum di sei valori, il resto è 422.
				direction: voiceOverDirection(opts.style),
				voiceName: voiceName(voice),
				languageCode: opts.languageCode,
				signal: opts.abortSignal
			});
			if (!spoken) throw new Error('kie returned no audio.');
			credits = spoken.credits;
			// Il taglio a valle assume L16 24 kHz mono e lo assume in SILENZIO: un WAV a 48 kHz
			// stereo non fallisce, produce pezzi lunghi la metà e una voce al doppio della velocità.
			const decoded = pcmFromWav(spoken.wav);
			if (
				decoded.sampleRate !== TTS_PCM.sampleRate ||
				decoded.channels !== TTS_PCM.channels ||
				decoded.bitsPerSample !== TTS_PCM.bitsPerSample
			) {
				throw new Error(
					`${model} returned ${decoded.sampleRate} Hz ${decoded.channels}-channel ${decoded.bitsPerSample}-bit audio; the cutter needs ${TTS_PCM.sampleRate} Hz mono ${TTS_PCM.bitsPerSample}-bit.`
				);
			}
			samples = decoded.samples;
			// Il WAV di kie è già valido e il suo URL vive 24h: si carica subito.
			fullUrl = await uploadAudio(opts.supabase, opts.brandId, spoken.wav, 'full');
		} else {
			throw new Error('TTS is kie-only. Google speech is not on the gateway.');
		}
	} catch (e) {
		logAiCall({
			label: 'voiceover',
			provider: useKie ? 'kie' : 'gemini',
			model,
			ms: Date.now() - t0,
			ok: false,
			brandId: opts.brandId,
			userId: opts.userId,
			error: e instanceof Error ? e.message : String(e)
		});
		throw e;
	}

	const fullDurationSeconds = samples.length / TTS_PCM.sampleRate;

	// Si MISURANO le pause e basta: quale sia un confine di riga lo sa chi ha il copione.
	const gaps = findGaps(samples);

	logAiCall({
		label: 'voiceover',
		provider: useKie ? 'kie' : 'gemini',
		model,
		ms: Date.now() - t0,
		ok: true,
		brandId: opts.brandId,
		userId: opts.userId,
		// Dai crediti che kie ha DAVVERO addebitato, mai da una tariffa nostra: a listino Google
		// sbaglierebbe di 16× senza fare rumore. Senza crediti il costo resta null — un buco
		// visibile batte un numero plausibile e sbagliato.
		providerCredits: credits,
		flatCostUsd: kieFlatCostUsd(credits),
		context: `voiceover:lines${lines.length}:gaps${gaps.length}`
	});

	return { fullUrl, fullDurationSeconds, gaps, voice };
}

export type VoiceOverCutResult = {
	pieces: VoiceOverPiece[];
	/** I tagli che non sono diventati un pezzo, e perché. Vuoto è la condizione normale. */
	dropped: DroppedCut[];
	/** Quante righe sono state passate come etichette: 0 quando il taglio è su un file altrui. */
	lineCount: number;
	/** Vero solo se c'erano etichette ED erano esattamente quante i pezzi. */
	matched: boolean;
};

/**
 * Taglia la registrazione dove dice l'agente. Rilegge il WAV dallo storage: le due chiamate sono
 * due turni di tool distinti, e riscaricarlo costa meno che portarselo dietro.
 *
 * Le etichette si attaccano SOLO se i pezzi sono esattamente quanti le righe: basta un taglio
 * scartato perché il pezzo `i` porti il nome della riga `i` senza esserlo, e da lì ogni riga
 * finisce su un beat che non è il suo. Un `piece 3` onesto costa un controllo; un'etichetta
 * sbagliata costa un video con una riga muta.
 */
export async function cutVoiceOver(opts: {
	supabase: SupabaseClient;
	brandId: string;
	userId?: string;
	url: string;
	atSeconds: number[];
	labels?: string[];
}): Promise<VoiceOverCutResult> {
	// L'url arriva da un tool, cioè da un modello, cioè da un testo che l'utente o una pagina letta
	// può influenzare: una fetch server-side su un indirizzo arbitrario parte da dentro la nostra
	// rete. Si accetta solo ciò che abbiamo caricato noi.
	const base = opts.supabase.storage.from('media').getPublicUrl('').data.publicUrl;
	if (!opts.url.startsWith(base.split('/media/')[0] + '/media/')) {
		throw new Error('That is not a recording from this workspace.');
	}
	const res = await fetch(opts.url, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new Error(`Could not read the recording back (${res.status}).`);
	const { samples, sampleRate, channels, bitsPerSample } = pcmFromWav(
		new Uint8Array(await res.arrayBuffer())
	);
	// Il controllo sopra guarda solo il bucket, e un letto musicale (48 kHz stereo) letto come mono
	// dà durata doppia, tagli spostati e pezzi a velocità dimezzata. Meglio un rifiuto leggibile.
	if (channels !== 1 || bitsPerSample !== 16) {
		throw new Error(
			`That file is ${channels}-channel ${bitsPerSample}-bit audio. This only cuts a mono 16-bit voice-over take — cut the take from generate_voiceover, not a music bed.`
		);
	}
	const { dropped } = planCuts(opts.atSeconds, samples.length, sampleRate);
	const segments = cutAtSeconds(samples, opts.atSeconds, sampleRate);
	const format = { sampleRate, channels, bitsPerSample };
	const labels = opts.labels?.filter((l) => String(l ?? '').trim()) ?? [];
	const matched = labels.length > 0 && labels.length === segments.length;
	const pieces = await Promise.all(
		segments.map(async (seg, i) => ({
			line: matched ? labels[i] : `piece ${i + 1}`,
			url: await uploadAudio(
				opts.supabase,
				opts.brandId,
				sliceToWav(samples, seg, format),
				`p${i + 1}`
			),
			durationSeconds: seg.durationSeconds,
			startSeconds: seg.startSeconds
		}))
	);
	return { pieces, dropped, lineCount: labels.length, matched };
}

/**
 * Il letto musicale da Lyria 3: un POST, e la risposta porta la clip MP3 in base64.
 *
 * La clip è SEMPRE ~30 secondi qualunque cosa si chieda — `seconds` resta come tetto e come
 * contesto nel registro, ma la durata la decide il modello. Un video più lungo non richiede una
 * clip più lunga: Remotion sa ripetere (`<Audio loop>`).
 */
export const MAX_MUSIC_SECONDS = 90;
/** Clip Lyria: 30s fisse. Pro: durata reale del file (o i secondi chiesti se non si legge). */
export const MUSIC_CLIP_SECONDS = LYRIA_CLIP_SECONDS;

/** Durata reale di un MP3, se ffmpeg è in PATH. Nessun helper dedicato esiste altrove. */
function probeMp3Duration(mp3: Uint8Array): number | null {
	let dir: string | undefined;
	try {
		dir = mkdtempSync(join(tmpdir(), 'lyria-'));
		const file = join(dir, 'a.mp3');
		writeFileSync(file, mp3);
		const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file], { encoding: 'utf8' });
		const m = `${r.stderr ?? ''}${r.stdout ?? ''}`.match(/Duration: (\d+):(\d+):([0-9.]+)/);
		return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
	} catch {
		return null;
	} finally {
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
}

export function musicFromInteraction(body: unknown): Uint8Array {
	return musicBytesFromChatCompletion(body);
}

/** Come il `transient` del voice-over: un tentativo in più solo su ciò che si dichiara passeggero. */
const transientMusicError = (e: unknown): boolean =>
	/\b(429|500|502|503|504)\b|INTERNAL|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(errorMessage(e));

export async function generateMusicBed(opts: {
	supabase: SupabaseClient;
	brandId: string;
	userId?: string;
	prompt: string;
	seconds: number;
	tier?: MusicTier;
	abortSignal?: AbortSignal;
}): Promise<{ url: string; durationSeconds: number }> {
	const seconds = Math.max(2, Math.min(MAX_MUSIC_SECONDS, Math.round(opts.seconds)));
	const tier: MusicTier = opts.tier === 'pro' ? 'pro' : 'clip';
	const model = lyriaModel(tier);
	const t0 = Date.now();

	const logFailure = (e: unknown) => {
		logAiCall({
			label: 'music',
			provider: 'llm',
			model,
			ms: Date.now() - t0,
			ok: false,
			brandId: opts.brandId,
			userId: opts.userId,
			error: errorMessage(e).slice(0, 800),
			context: `music:${tier}:${seconds}s`
		});
	};

	let mp3: Uint8Array;
	try {
		const body = await withRetry(
			() =>
				llmChatCompletions({
					model,
					prompt: opts.prompt,
					timeoutMs: tier === 'pro' ? 180_000 : 120_000,
					abortSignal: opts.abortSignal
				}),
			transientMusicError
		);
		mp3 = musicBytesFromChatCompletion(body);
	} catch (e) {
		logFailure(e);
		throw e;
	}

	const path = `${opts.brandId}/music/${crypto.randomUUID()}.mp3`;
	const { error } = await opts.supabase.storage
		.from('media')
		.upload(path, Buffer.from(mp3), { contentType: 'audio/mpeg', upsert: false });
	if (error) {
		const e = new Error(`Music upload failed: ${error.message}`);
		logFailure(e);
		throw e;
	}

	logAiCall({
		label: 'music',
		provider: 'llm',
		model,
		ms: Date.now() - t0,
		ok: true,
		brandId: opts.brandId,
		userId: opts.userId,
		flatCostUsd: LYRIA_COST_USD[model],
		context: `music:${tier}:${seconds}s`
	});

	return {
		url: opts.supabase.storage.from('media').getPublicUrl(path).data.publicUrl,
		durationSeconds: tier === 'clip' ? MUSIC_CLIP_SECONDS : probeMp3Duration(mp3) ?? seconds
	};
}
