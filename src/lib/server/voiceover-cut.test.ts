import { describe, expect, it, vi } from 'vitest';

// Il modulo che genera tocca rete, chiave e registro: qui si sostituiscono i tre, così anche la
// parte non pura di `gemini-audio` si prova senza uscire dal processo.
vi.mock('$env/dynamic/private', () => ({ env: { GEMINI_API_KEY: 'test-key', LLM_API_KEY: 'test-key', KIE_API_KEY: 'test-key' } }));
const logged = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('$lib/server/ai-log', () => ({
	logAiCall: (row: Record<string, unknown>) => {
		logged.push(row);
	}
}));
const kieJobs = vi.hoisted(() => ({
	generateSpeechOnKie: vi.fn(),
	kieFlatCostUsd: (c?: number) => (typeof c === 'number' ? 0.001 * c : null),
	kieTtsModel: () => 'gemini-3.5-pro-preview-tts'
}));
vi.mock('$lib/server/kie-jobs', () => kieJobs);
import {
	TTS_SAMPLE_RATE,
	cutAtSeconds,
	findGaps,
	planCuts,
	pcmFromWav,
	samplesFromPcm,
	sliceToWav,
	wavFromPcm
} from './voiceover-cut';
import { buildVoiceOverPrompt } from './gemini-audio';

/** Un tono, cioè "qui si parla". L'ampiezza sta ben sopra la soglia di silenzio. */
function tone(ms: number, amplitude = 12000): Int16Array {
	const n = Math.round((ms * TTS_SAMPLE_RATE) / 1000);
	const out = new Int16Array(n);
	for (let i = 0; i < n; i++) out[i] = Math.round(Math.sin(i / 12) * amplitude);
	return out;
}

/** Silenzio col fruscio che il TTS lascia davvero: non zero, o il test proverebbe il caso facile. */
function hush(ms: number, floor = 200): Int16Array {
	const n = Math.round((ms * TTS_SAMPLE_RATE) / 1000);
	const out = new Int16Array(n);
	for (let i = 0; i < n; i++) out[i] = (i % 7) - 3 > 0 ? floor : -floor;
	return out;
}

function concat(...parts: Int16Array[]): Int16Array {
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Int16Array(total);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

/** Rimonta un WAV con un chunk in più fra `fmt ` e `data`: perfettamente valido, e mai testato. */
function withChunk(wav: Buffer, id: string, body: Buffer): Buffer {
	const head = wav.subarray(0, 36);
	const data = wav.subarray(36);
	const chunk = Buffer.alloc(8 + body.length + (body.length % 2));
	chunk.write(id, 0, 'ascii');
	chunk.writeUInt32LE(body.length, 4);
	body.copy(chunk, 8);
	const out = Buffer.concat([head, chunk, data]);
	out.writeUInt32LE(out.length - 8, 4);
	return out;
}

describe('wavFromPcm', () => {
	it('scrive un header che dice davvero come riprodurre i campioni', () => {
		// Un PCM salvato come .wav senza header è un file che esiste e non suona da nessuna parte.
		const pcm = new Uint8Array(1000);
		const wav = wavFromPcm(pcm);
		expect(wav.length).toBe(44 + 1000);
		expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
		expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
		expect(wav.toString('ascii', 36, 40)).toBe('data');
		expect(wav.readUInt32LE(40)).toBe(1000);
		expect(wav.readUInt32LE(4)).toBe(36 + 1000);
	});

	it('dichiara frequenza, canali e byte rate coerenti fra loro', () => {
		const wav = wavFromPcm(new Uint8Array(8));
		expect(wav.readUInt16LE(20)).toBe(1); // PCM non compresso
		expect(wav.readUInt16LE(22)).toBe(1); // mono
		expect(wav.readUInt32LE(24)).toBe(TTS_SAMPLE_RATE);
		const blockAlign = wav.readUInt16LE(32);
		expect(blockAlign).toBe(2);
		// Il byte rate incoerente è l'errore che fa suonare tutto a velocità sbagliata.
		expect(wav.readUInt32LE(28)).toBe(TTS_SAMPLE_RATE * blockAlign);
	});
});

describe('samplesFromPcm', () => {
	it('legge little-endian, compreso il negativo', () => {
		// 0x0100 = 1 ; 0xFFFF = -1 : se il segno si perde, il silenzio diventa fortissimo.
		const s = samplesFromPcm(new Uint8Array([0x00, 0x01, 0xff, 0xff]));
		expect(Array.from(s)).toEqual([256, -1]);
	});

	it('ignora un byte spaiato invece di produrre un campione inventato', () => {
		expect(samplesFromPcm(new Uint8Array([0x00, 0x01, 0x7f]).slice()).length).toBe(1);
	});
});

describe('sliceToWav', () => {
	it('estrae il pezzo con la lunghezza giusta e un header valido', () => {
		const audio = concat(tone(500), hush(500), tone(500));
		const [seg] = cutAtSeconds(audio, [0.7]);
		const wav = sliceToWav(audio, seg);
		expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
		expect(wav.readUInt32LE(40)).toBe((seg.end - seg.start) * 2);
	});

	it('il pezzo estratto contiene gli stessi campioni dell’originale', () => {
		// È la garanzia che tiene la voce uguale: i pezzi non sono rigenerati, sono ritagliati.
		const audio = concat(tone(400), hush(500), tone(400));
		const [seg] = cutAtSeconds(audio, [0.6]);
		const wav = sliceToWav(audio, seg);
		const back = samplesFromPcm(new Uint8Array(wav.subarray(44)));
		expect(back[0]).toBe(audio[seg.start]);
		expect(back[back.length - 1]).toBe(audio[seg.end - 1]);
	});
});

/**
 * Il prompt del voice-over: puro, quindi testabile senza chiave. La forma conta — la prima
 * versione numerava le righe e chiedeva al modello di non leggere i numeri, e chiedere a un
 * modello che parla di ignorare parte di ciò che gli dai è un modo affidabile di sentirtelo
 * leggere.
 */
describe('buildVoiceOverPrompt', () => {
	it('non numera le righe', () => {
		const p = buildVoiceOverPrompt(['prima riga', 'seconda riga']);
		expect(p).not.toMatch(/^\s*1\./m);
		expect(p).not.toMatch(/never read the numbers/i);
	});

	it('separa le righe con una riga vuota, che è già una pausa', () => {
		// Ed è esattamente il silenzio che `findGaps` misura e su cui l'agente poi sceglie di tagliare.
		expect(buildVoiceOverPrompt(['a', 'b'])).toContain('a\n\nb');
	});

	it('chiede la pausa esplicitamente: il taglio dipende da quella', () => {
		expect(buildVoiceOverPrompt(['a', 'b'])).toMatch(/full beat between paragraphs/i);
	});

	it('lo stile è una riga sola, non un blocco di istruzioni', () => {
		const p = buildVoiceOverPrompt(['a'], 'stanca e sarcastica');
		expect(p).toContain('stanca e sarcastica');
		expect(p.split('\n')[0]).toMatch(/^Read this aloud/);
	});

	it('scarta le righe vuote invece di produrre pause finte', () => {
		expect(buildVoiceOverPrompt(['a', '   ', 'b'])).toContain('a\n\nb');
	});
});

/**
 * MISURARE, NON DECIDERE.
 *
 * La prima versione tagliava da sola cercando una soglia di silenzio, e in produzione sbagliava
 * quasi sempre: quattro righe → sette pezzi, cinque → dieci. Il parlato respira dentro le frasi, e
 * nessuna ampiezza distingue un respiro da una fine riga. Adesso queste funzioni raccolgono i
 * candidati e tagliano dove dice l'agente, che il copione ce l'ha.
 */
describe('findGaps', () => {
	it('elenca le pause con inizio, fine e punto di taglio', () => {
		const audio = concat(tone(500), hush(400), tone(500));
		const [gap] = findGaps(audio);
		expect(gap.startSeconds).toBeGreaterThan(0.4);
		expect(gap.endSeconds).toBeGreaterThan(gap.startSeconds);
		// Il punto proposto è il centro della pausa: il posto più sicuro dove tagliare.
		expect(gap.atSeconds).toBeCloseTo((gap.startSeconds + gap.endSeconds) / 2, 5);
	});

	it('raccoglie anche le pause brevi: scegliere non è compito suo', () => {
		// Una micro-pausa in meno nell'elenco è un taglio che l'agente non può più fare.
		const audio = concat(tone(400), hush(200), tone(400), hush(600), tone(400));
		expect(findGaps(audio).length).toBe(2);
	});

	it('non conta il silenzio iniziale come una pausa fra due righe', () => {
		const audio = concat(hush(800), tone(500));
		expect(findGaps(audio)).toEqual([]);
	});

	it('silenzio puro non ha pause fra righe che non esistono', () => {
		expect(findGaps(hush(2000))).toEqual([]);
	});

	it('la coda di silenzio non è una pausa: dopo non c’è nessuna riga', () => {
		// Proporla come taglio darebbe all'agente un pezzo finale fatto di solo silenzio.
		expect(findGaps(concat(tone(500), hush(800)))).toEqual([]);
	});

	it('nessun campione, nessuna pausa — e nessun errore', () => {
		expect(findGaps(new Int16Array(0))).toEqual([]);
	});

	it('ogni punto proposto cade DENTRO la clip', () => {
		// Un `atSeconds` fuori dalla clip verrebbe scartato da `cutAtSeconds` e sfaserebbe le righe.
		const audio = concat(tone(500), hush(400), tone(500), hush(400), tone(500));
		const duration = audio.length / TTS_SAMPLE_RATE;
		const gaps = findGaps(audio);
		expect(gaps.length).toBeGreaterThan(0);
		for (const g of gaps) {
			expect(g.atSeconds).toBeGreaterThan(0);
			expect(g.atSeconds).toBeLessThan(duration);
		}
	});
});

describe('cutAtSeconds', () => {
	const audio = concat(tone(1000), hush(400), tone(1000), hush(400), tone(1000));

	it('n tagli danno n+1 pezzi, e coprono tutta la registrazione', () => {
		const segs = cutAtSeconds(audio, [1.2, 2.6]);
		expect(segs).toHaveLength(3);
		expect(segs[0].start).toBe(0);
		expect(segs[segs.length - 1].end).toBe(audio.length);
	});

	it('i pezzi si toccano senza sovrapporsi: nessun secondo va perso', () => {
		const segs = cutAtSeconds(audio, [1.2, 2.6]);
		for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end);
	});

	it('ordina e deduplica i tagli invece di produrre pezzi vuoti', () => {
		expect(cutAtSeconds(audio, [2.6, 1.2, 1.2])).toHaveLength(3);
	});

	it('scarta i tagli fuori dalla clip', () => {
		// Un taglio a 99s su una clip da 3 non è un pezzo in più: è un pezzo vuoto.
		expect(cutAtSeconds(audio, [99, 1.2])).toHaveLength(2);
		expect(cutAtSeconds(audio, [0])).toHaveLength(1);
	});

	it('nessun taglio: un pezzo solo, la registrazione intera', () => {
		const [only] = cutAtSeconds(audio, []);
		expect(only.start).toBe(0);
		expect(only.end).toBe(audio.length);
	});

	it('NaN e Infinity non diventano un pezzo', () => {
		// Arrivano da un modello: `at_seconds` è un numero solo perché lo schema lo chiede.
		expect(cutAtSeconds(audio, [NaN, Infinity, -Infinity, 1.2])).toHaveLength(2);
	});

	it('senza campioni non c’è nessun pezzo, nemmeno vuoto', () => {
		// Zero pezzi e non uno: un pezzo lungo zero sarebbe un WAV senza audio caricato sullo
		// storage e appoggiato su un beat, cioè un difetto travestito da risultato.
		expect(cutAtSeconds(new Int16Array(0), [])).toEqual([]);
		expect(cutAtSeconds(new Int16Array(0), [1])).toEqual([]);
	});
});

describe('planCuts', () => {
	it('dice quali tagli sono caduti e perché', () => {
		const { cuts, dropped } = planCuts([1.2, 99, NaN, 1.2], 24_000 * 3, TTS_SAMPLE_RATE);
		expect(cuts).toEqual([Math.round(1.2 * TTS_SAMPLE_RATE)]);
		expect(dropped).toEqual([
			{ atSeconds: 99, reason: 'outside the clip' },
			{ atSeconds: NaN, reason: 'not a finite number' },
			{ atSeconds: 1.2, reason: 'duplicate after rounding' }
		]);
	});

	it('niente da riferire quando i tagli sono tutti buoni', () => {
		expect(planCuts([1, 2], 24_000 * 3).dropped).toEqual([]);
	});
});

describe('pcmFromWav', () => {
	it('rilegge quello che wavFromPcm ha scritto', () => {
		const original = tone(300);
		const wav = wavFromPcm(new Uint8Array(sliceToWav(original, { start: 0, end: original.length, startSeconds: 0, endSeconds: 0, durationSeconds: 0 }).subarray(44)));
		const back = pcmFromWav(new Uint8Array(wav));
		expect(back.sampleRate).toBe(TTS_SAMPLE_RATE);
		expect(back.samples.length).toBe(original.length);
		expect(back.samples[10]).toBe(original[10]);
	});

	it('salta l’header invece di leggerlo come audio', () => {
		// Assumere l'offset 44 su un WAV con un chunk in più darebbe un ventesimo di secondo di
		// rumore in testa a ogni primo pezzo.
		const wav = wavFromPcm(new Uint8Array(200));
		expect(pcmFromWav(new Uint8Array(wav)).samples.length).toBe(100);
	});

	it('salta DAVVERO un chunk in più prima di `data`', () => {
		// Il test qui sopra costruisce un file da 44 byte, dove `data` sta all'offset 44 comunque:
		// il ciclo che scorre i chunk non era provato da niente. Questo lo prova.
		const wav = withChunk(wavFromPcm(new Uint8Array(200)), 'LIST', Buffer.alloc(8, 0x41));
		expect(pcmFromWav(new Uint8Array(wav)).samples.length).toBe(100);
	});

	it('un chunk di dimensione dispari porta un byte di riempimento, e va scavalcato', () => {
		// Senza il `+ size % 2` la lettura si disallinea di un byte e da lì in poi legge spazzatura.
		const wav = withChunk(wavFromPcm(new Uint8Array(200)), 'LIST', Buffer.alloc(7, 0x41));
		expect(pcmFromWav(new Uint8Array(wav)).samples.length).toBe(100);
	});

	it('una dimensione dichiarata più grande del file non fa leggere oltre la fine', () => {
		const wav = Buffer.from(wavFromPcm(new Uint8Array(200)));
		wav.writeUInt32LE(999_999, 40);
		expect(pcmFromWav(new Uint8Array(wav)).samples.length).toBe(100);
	});

	it('legge frequenza, canali e bit dal chunk `fmt `, non dai valori del TTS', () => {
		// Prima leggeva solo la frequenza e chi chiamava dava mono 16 bit per scontato: un letto
		// musicale stereo a 48 kHz si dichiarava lungo il doppio e si tagliava a metà strada.
		const wav = wavFromPcm(new Uint8Array(400), { sampleRate: 48_000, channels: 2, bitsPerSample: 16 });
		const back = pcmFromWav(new Uint8Array(wav));
		expect(back.sampleRate).toBe(48_000);
		expect(back.channels).toBe(2);
		expect(back.bitsPerSample).toBe(16);
	});

	it('una frequenza diversa da 24 kHz torna com’è scritta', () => {
		const wav = wavFromPcm(new Uint8Array(100), { sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
		expect(pcmFromWav(new Uint8Array(wav)).sampleRate).toBe(16_000);
	});

	it('rifiuta ciò che non è un WAV, invece di restituire rumore', () => {
		expect(() => pcmFromWav(new Uint8Array(10))).toThrow(/too short/);
		expect(() => pcmFromWav(new Uint8Array(60))).toThrow(/RIFF/);
	});
});

/**
 * PROBE (pre-fix): la mappatura etichetta→pezzo e il formato del WAV riletto.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { cutVoiceOver, generateMusicBed, generateVoiceOver, musicFromInteraction } from './gemini-audio';

const BASE = 'https://x.supabase.co/storage/v1/object/public/media/';

function wavOf(samples: Int16Array, format = { sampleRate: TTS_SAMPLE_RATE, channels: 1, bitsPerSample: 16 }) {
	return sliceToWav(
		samples,
		{ start: 0, end: samples.length, startSeconds: 0, endSeconds: 0, durationSeconds: 0 },
		format
	);
}

function fakeSupabase(uploadError?: string): SupabaseClient {
	return {
		storage: {
			from: () => ({
				upload: async () => ({ error: uploadError ? { message: uploadError } : null }),
				getPublicUrl: (p: string) => ({ data: { publicUrl: BASE + p } })
			})
		}
	} as unknown as SupabaseClient;
}

async function cut(wav: Buffer, atSeconds: number[], labels?: string[]) {
	const original = globalThis.fetch;
	globalThis.fetch = (async () => new Response(wav)) as typeof fetch;
	try {
		return await cutVoiceOver({
			supabase: fakeSupabase(),
			brandId: 'b',
			url: BASE + 'take.wav',
			atSeconds,
			labels
		});
	} finally {
		globalThis.fetch = original;
	}
}

describe('cutVoiceOver: le etichette', () => {
	const take = concat(tone(1000), hush(400), tone(1000), hush(400), tone(1000));

	it('un taglio scartato non sposta le etichette sul pezzo sbagliato', async () => {
		const res = await cut(wavOf(take), [1.2, 2.6, 99], ['uno', 'due', 'tre', 'quattro']);
		expect(res.dropped).toEqual([{ atSeconds: 99, reason: 'outside the clip' }]);
		expect(res.pieces).toHaveLength(3);
		expect(res.matched).toBe(false);
		expect(res.pieces.map((p) => p.line)).toEqual(['piece 1', 'piece 2', 'piece 3']);
	});

	it('quando i pezzi sono quanti le righe, le etichette sono le righe', async () => {
		const res = await cut(wavOf(take), [1.2, 2.6], ['uno', 'due', 'tre']);
		expect(res.matched).toBe(true);
		expect(res.dropped).toEqual([]);
		expect(res.pieces.map((p) => p.line)).toEqual(['uno', 'due', 'tre']);
	});

	it('un duplicato dopo l’arrotondamento è un taglio scartato, non un pezzo in meno', async () => {
		const res = await cut(wavOf(take), [1.2, 1.20001], ['uno', 'due', 'tre']);
		expect(res.dropped).toEqual([{ atSeconds: 1.20001, reason: 'duplicate after rounding' }]);
		expect(res.matched).toBe(false);
	});

	it('rifiuta un file che non è mono 16 bit invece di tagliarlo a metà velocità', async () => {
		const stereo = new Int16Array(2 * 48_000 * 2);
		for (let i = 0; i < stereo.length; i++) stereo[i] = 3000;
		const wav = wavOf(stereo, { sampleRate: 48_000, channels: 2, bitsPerSample: 16 });
		await expect(cut(wav, [1.0])).rejects.toThrow(/mono/i);
	});
});

/**
 * LA MUSICA E IL REGISTRO.
 *
 * Lyria 3 è richiesta-risposta: un POST alla Interactions API, un MP3 in base64 dentro `steps`.
 * Qui si prova il parser sulla forma REALE della risposta (rilevata con un probe il 2026-08-21) e
 * la simmetria del registro: generazione fallita, una riga; caricamento fallito, una riga.
 */
const MP3_BYTES = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(500, 7)]);

/** La risposta come la manda davvero l'API: un blocco di testo prima, l'audio dopo. */
function interactionFixture(data = MP3_BYTES.toString('base64')) {
	return {
		id: 'v1_x',
		status: 'completed',
		object: 'interaction',
		model: 'lyria-3-clip-preview',
		steps: [
			{ type: 'model_output', content: [{ type: 'text', text: '<instrumental>' }] },
			{ type: 'model_output', content: [{ type: 'audio', data, mime_type: 'audio/mpeg' }] }
		]
	};
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
	const original = globalThis.fetch;
	globalThis.fetch = impl;
	try {
		return await fn();
	} finally {
		globalThis.fetch = original;
	}
}

describe('musicFromInteraction', () => {
	it('estrae i byte MP3 dalla forma reale della risposta', () => {
		const bytes = musicFromInteraction(interactionFixture());
		expect(Buffer.from(bytes.subarray(0, 3)).toString('latin1')).toBe('ID3');
		expect(bytes.length).toBe(MP3_BYTES.length);
	});

	it('accetta un MP3 senza tag ID3 (frame sync in testa)', () => {
		const raw = Buffer.concat([Buffer.from([0xff, 0xfb]), Buffer.alloc(100)]);
		expect(musicFromInteraction(interactionFixture(raw.toString('base64'))).length).toBe(102);
	});

	it('byte che non sono MP3 si fermano qui, non in un video muto', () => {
		const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(100)]);
		expect(() => musicFromInteraction(interactionFixture(wav.toString('base64')))).toThrow(/not MP3/);
	});

	it('nessun audio nella risposta nomina la variabile da toccare', () => {
		expect(() => musicFromInteraction({ steps: [] })).toThrow(/no audio/);
	});
});

describe('generateMusicBed', () => {
	it('carica un .mp3, dichiara la durata della clip e registra il costo di listino', async () => {
		const res = await withFetch(
			(async () => new Response(JSON.stringify(interactionFixture()))) as typeof fetch,
			() => generateMusicBed({ supabase: fakeSupabase(), brandId: 'b', prompt: 'warm lo-fi', seconds: 60 })
		);
		expect(res.url).toMatch(/\/music\/[0-9a-f-]+\.mp3$/);
		expect(res.durationSeconds).toBe(30);
		expect(logged.at(-1)).toMatchObject({
			label: 'music',
			ok: true,
			provider: 'llm',
			model: 'google/lyria-3-clip-preview',
			flatCostUsd: 0.04
		});
	});

	it('un errore HTTP lascia una riga nel registro, non il silenzio', async () => {
		const calls = vi.fn(async () => new Response('Not Found', { status: 404 }));
		await expect(
			withFetch(calls as unknown as typeof fetch, () =>
				generateMusicBed({ supabase: fakeSupabase(), brandId: 'b', prompt: 'x', seconds: 10 })
			)
		).rejects.toThrow(/404/);
		// Un 404 non è transitorio: una chiamata sola, non un ritentativo che ritarda l'errore vero.
		expect(calls).toHaveBeenCalledTimes(1);
		expect(logged.at(-1)).toMatchObject({ label: 'music', ok: false });
	});

	it('un caricamento fallito lascia una riga nel registro, non il silenzio', async () => {
		await expect(
			withFetch(
				(async () => new Response(JSON.stringify(interactionFixture()))) as typeof fetch,
				() => generateMusicBed({ supabase: fakeSupabase('disk on fire'), brandId: 'b', prompt: 'x', seconds: 10 })
			)
		).rejects.toThrow(/Music upload failed/);
		expect(logged.at(-1)).toMatchObject({ label: 'music', ok: false });
	});
});

describe('generateVoiceOver', () => {
	it('un caricamento fallito lascia una riga nel registro, non il silenzio', async () => {
		kieJobs.generateSpeechOnKie.mockResolvedValue({
			wav: wavFromPcm(new Uint8Array(TTS_SAMPLE_RATE * 2)),
			credits: 1,
			model: 'gemini-3.5-pro-preview-tts'
		});
		await expect(
			generateVoiceOver({
				supabase: fakeSupabase('disk on fire'),
				brandId: 'b',
				lines: ['una riga']
			})
		).rejects.toThrow(/Audio upload failed/);
		expect(logged.at(-1)).toMatchObject({ label: 'voiceover', ok: false });
	});
});
