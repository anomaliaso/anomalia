/**
 * IL VOICE-OVER SI GENERA UNA VOLTA E SI TAGLIA, mai il contrario.
 *
 * Generare una clip per beat sembra più semplice ed è sbagliato per un motivo che non si legge nel
 * codice, si sente nel video: **due generazioni TTS separate non danno la stessa voce**. Stesso
 * `voiceName`, stesso modello, e timbro e intonazione si spostano comunque — su sei beat sono sei
 * persone leggermente diverse che leggono lo stesso copione.
 *
 * E si taglia invece di appoggiare l'audio intero perché un beat dura quanto serve a MOSTRARE una
 * cosa, non quanto serve a dirla: con l'audio intero o si allunga la lettura o si accorcia l'azione.
 *
 * I punti di taglio si trovano sui SILENZI e non su timestamp dell'API: i modelli TTS non
 * garantiscono marcature per frase, e un allineamento che dipende da un campo opzionale è un
 * allineamento che un giorno sparisce.
 *
 * Tutto qui dentro è puro — niente rete, niente chiavi — ed è il motivo per cui è un file separato.
 */

/** PCM che i modelli TTS di Gemini restituiscono: L16, 24 kHz, mono. */
export const TTS_SAMPLE_RATE = 24_000;
export const TTS_CHANNELS = 1;
export const TTS_BITS_PER_SAMPLE = 16;

export type PcmFormat = {
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
};

export const TTS_PCM: PcmFormat = {
	sampleRate: TTS_SAMPLE_RATE,
	channels: TTS_CHANNELS,
	bitsPerSample: TTS_BITS_PER_SAMPLE
};

/**
 * PCM grezzo → WAV. Dal modello tornano campioni e basta: senza i 44 byte di intestazione che
 * dicono a che frequenza riprodurli, un `.wav` esiste e non suona da nessuna parte.
 */
export function wavFromPcm(pcm: Uint8Array, format: PcmFormat = TTS_PCM): Buffer {
	const { sampleRate, channels, bitsPerSample } = format;
	const blockAlign = (channels * bitsPerSample) / 8;
	const byteRate = sampleRate * blockAlign;
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.byteLength, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16); // dimensione del blocco fmt
	header.writeUInt16LE(1, 20); // 1 = PCM non compresso
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcm.byteLength, 40);
	return Buffer.concat([header, Buffer.from(pcm)]);
}

/** Campioni Int16 da un buffer PCM little-endian, senza copiare più del necessario. */
export function samplesFromPcm(pcm: Uint8Array): Int16Array {
	const usable = pcm.byteLength - (pcm.byteLength % 2);
	const out = new Int16Array(usable / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = (pcm[i * 2] | (pcm[i * 2 + 1] << 8)) << 16 >> 16;
	}
	return out;
}

export type Segment = {
	/** Indice del campione in cui il pezzo comincia (incluso). */
	start: number;
	/** Indice del campione in cui finisce (escluso). */
	end: number;
	startSeconds: number;
	endSeconds: number;
	durationSeconds: number;
};

/** Le manopole di `findGaps`. Poche, perché qui si misura e basta: la scelta è dell'agente. */
export type SplitOptions = {
	sampleRate?: number;
	/** Sotto i ~250 ms si taglia sulle micro-pause fra le parole: venti pezzi invece di sei. */
	minSilenceMs?: number;
	/** Non zero: il TTS lascia un fruscio bassissimo, e a zero non si trova mai una pausa. */
	threshold?: number;
};

const DEFAULT_THRESHOLD = 0.02;

/** Un pezzo come WAV a sé — stessa voce dell'originale, perché è lo stesso file. */
export function sliceToWav(samples: Int16Array, seg: Segment, format: PcmFormat = TTS_PCM): Buffer {
	const view = samples.subarray(seg.start, seg.end);
	const bytes = new Uint8Array(view.length * 2);
	for (let i = 0; i < view.length; i++) {
		bytes[i * 2] = view[i] & 0xff;
		bytes[i * 2 + 1] = (view[i] >> 8) & 0xff;
	}
	return wavFromPcm(bytes, format);
}

/**
 * I SILENZI COME CANDIDATI, non come decisione: nessuna soglia distingue un respiro da una fine
 * riga guardando solo l'ampiezza (quattro righe davano sette pezzi, cinque ne davano dieci). Qui
 * si misura soltanto; quale pausa sia un confine lo dice l'agente, che ha il copione.
 */
export type Gap = {
	startSeconds: number;
	endSeconds: number;
	durationSeconds: number;
	/** Il centro della pausa: il punto di taglio naturale, e quello che l'agente riceve. */
	atSeconds: number;
};

export function findGaps(samples: Int16Array, opts: SplitOptions = {}): Gap[] {
	const sampleRate = opts.sampleRate ?? TTS_SAMPLE_RATE;
	// Volutamente basso: qui si RACCOGLIE. Una pausa di troppo costa una riga da leggere; una
	// mancante toglie all'agente un taglio possibile.
	const minSilence = Math.max(
		1,
		Math.round(((opts.minSilenceMs ?? 180) * sampleRate) / 1000)
	);
	const cutoff = Math.max(1, Math.round((opts.threshold ?? DEFAULT_THRESHOLD) * 32768));

	const gaps: Gap[] = [];
	let run = 0;
	let sawVoice = false;
	for (let i = 0; i <= samples.length; i++) {
		const quiet = i === samples.length || Math.abs(samples[i]) < cutoff;
		if (quiet) {
			run++;
			continue;
		}
		if (run >= minSilence && sawVoice) {
			const start = (i - run) / sampleRate;
			const end = i / sampleRate;
			gaps.push({
				startSeconds: start,
				endSeconds: end,
				durationSeconds: end - start,
				atSeconds: (start + end) / 2
			});
		}
		sawVoice = true;
		run = 0;
	}
	return gaps;
}

/**
 * UN TAGLIO SCARTATO VA DETTO. Scartarlo in silenzio è peggio del pezzo vuoto che evita: chi chiama
 * conta `n+1` pezzi per `n` tagli e attacca le etichette per posizione, quindi un solo taglio
 * caduto sposta OGNI riga successiva sul pezzo sbagliato. Una mappatura sfasata di uno è peggio di
 * nessuna mappatura, perché sembra intenzionale.
 */
export type DroppedCut = {
	atSeconds: number;
	reason: 'not a finite number' | 'outside the clip' | 'duplicate after rounding';
};

export function planCuts(
	atSeconds: number[],
	totalSamples: number,
	sampleRate: number = TTS_SAMPLE_RATE
): { cuts: number[]; dropped: DroppedCut[] } {
	const cuts: number[] = [];
	const dropped: DroppedCut[] = [];
	const seen = new Set<number>();
	for (const s of atSeconds) {
		if (!Number.isFinite(s)) {
			dropped.push({ atSeconds: s, reason: 'not a finite number' });
			continue;
		}
		const n = Math.round(s * sampleRate);
		if (n <= 0 || n >= totalSamples) {
			dropped.push({ atSeconds: s, reason: 'outside the clip' });
			continue;
		}
		if (seen.has(n)) {
			// Due tagli a un campione di distanza sono lo stesso taglio.
			dropped.push({ atSeconds: s, reason: 'duplicate after rounding' });
			continue;
		}
		seen.add(n);
		cuts.push(n);
	}
	return { cuts: cuts.sort((a, b) => a - b), dropped };
}

/**
 * Taglia dove dice l'agente, senza euristiche. Il risultato copre SEMPRE tutta la registrazione —
 * dal principio al primo taglio e dall'ultimo alla fine — così `n` tagli VALIDI danno `n+1` pezzi
 * e nessun secondo di parlato resta orfano.
 */
export function cutAtSeconds(
	samples: Int16Array,
	atSeconds: number[],
	sampleRate: number = TTS_SAMPLE_RATE
): Segment[] {
	const total = samples.length;
	const { cuts } = planCuts(atSeconds, total, sampleRate);

	const bounds = [0, ...cuts, total];
	const out: Segment[] = [];
	for (let i = 0; i < bounds.length - 1; i++) {
		const start = bounds[i];
		const end = bounds[i + 1];
		if (end <= start) continue;
		out.push({
			start,
			end,
			startSeconds: start / sampleRate,
			endSeconds: end / sampleRate,
			durationSeconds: (end - start) / sampleRate
		});
	}
	return out;
}

/**
 * PCM da un WAV già nello storage: il taglio è una chiamata SEPARATA dalla generazione, quindi il
 * file va riletto — saltando l'header, o i 44 byte iniziali diventano un ventesimo di secondo di
 * rumore in testa al primo pezzo.
 *
 * Torna il formato INTERO e non solo la frequenza: dare per scontato "mono 16 bit" su un file 48
 * kHz stereo dichiara una durata doppia, sposta i tagli e dimezza la velocità. Canali e bit per
 * campione o si leggono o si rifiutano.
 */
export function pcmFromWav(wav: Uint8Array): { samples: Int16Array } & PcmFormat {
	const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
	if (wav.byteLength < 44) throw new Error('Not a WAV file: too short');
	const riff = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
	if (riff !== 'RIFF') throw new Error('Not a WAV file: missing RIFF');
	let sampleRate = TTS_SAMPLE_RATE;
	let channels = TTS_CHANNELS;
	let bitsPerSample = TTS_BITS_PER_SAMPLE;
	// I chunk si scorrono invece di assumere l'offset 44: un WAV con un `LIST` prima di `data` è
	// valido, e assumendo la posizione si leggerebbe l'header come audio.
	let at = 12;
	while (at + 8 <= wav.byteLength) {
		const id = String.fromCharCode(wav[at], wav[at + 1], wav[at + 2], wav[at + 3]);
		const size = dv.getUint32(at + 4, true);
		const body = at + 8;
		if (id === 'fmt ') {
			channels = dv.getUint16(body + 2, true);
			sampleRate = dv.getUint32(body + 4, true);
			bitsPerSample = dv.getUint16(body + 14, true);
		}
		if (id === 'data') {
			const end = Math.min(wav.byteLength, body + size);
			return { samples: samplesFromPcm(wav.subarray(body, end)), sampleRate, channels, bitsPerSample };
		}
		at = body + size + (size % 2);
	}
	throw new Error('Not a WAV file: no data chunk');
}
