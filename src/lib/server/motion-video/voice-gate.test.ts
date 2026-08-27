/**
 * IL CASO GUIDA, RIPRODOTTO E BOCCIATO. Anomalia, 21/8/2026 21:23: script di 6 battute, take con
 * 3 pause, 4 pezzi tagliati indovinando — qui il take è sintetico (Int16, 24 kHz, gli stessi
 * numeri) e il gate deve rifiutare il render PRIMA della VM. Nessuna generazione, nessuna rete
 * vera: i WAV escono da `wavFromPcm` e la fetch è finta.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wavFromPcm } from '$lib/server/voiceover-cut';
import { MotionVoiceGateError, assertMotionVoiceGate, isVoiceoverTakeUrl } from './voice-gate';

const SR = 24_000;
const ORIGIN = 'https://fake.supabase.co';
const BASE = `${ORIGIN}/storage/v1/object/public/media/b1/voiceover`;

function pcmBytes(samples: Int16Array): Uint8Array {
	const out = new Uint8Array(samples.length * 2);
	for (let i = 0; i < samples.length; i++) {
		out[i * 2] = samples[i] & 0xff;
		out[i * 2 + 1] = (samples[i] >> 8) & 0xff;
	}
	return out;
}

/** Come nel test puro: voce (8000) e silenzio (0) alternati, voce per prima. */
function wav(pattern: number[]): Buffer {
	const total = Math.round(pattern.reduce((a, b) => a + b, 0) * SR);
	const samples = new Int16Array(total);
	let at = 0;
	pattern.forEach((seconds, i) => {
		const n = Math.round(seconds * SR);
		if (i % 2 === 0) samples.fill(8000, at, at + n);
		at += n;
	});
	return wavFromPcm(pcmBytes(samples));
}

function fakeSupabase(takeName: string | null) {
	return {
		storage: {
			from: () => ({
				list: async () => ({
					data: takeName ? [{ name: takeName }] : [],
					error: null
				}),
				getPublicUrl: (path: string) => ({
					data: { publicUrl: `${ORIGIN}/storage/v1/object/public/media/${path}` }
				})
			})
		}
	} as never;
}

function serveWavs(files: Record<string, Buffer>) {
	const calls: string[] = [];
	vi.stubGlobal('fetch', async (url: string | URL) => {
		const u = String(url);
		calls.push(u);
		const body = files[u];
		if (!body) return new Response('not found', { status: 404 });
		return new Response(new Uint8Array(body), { status: 200 });
	});
	return calls;
}

afterEach(() => vi.unstubAllGlobals());

const GUIDE_SOURCE = `
export const fps = 30;
export const durationInFrames = 675;

const Hook = () => (<AbsoluteFill><Audio src="${BASE}/t-p1.wav" /></AbsoluteFill>);
const Promessa = () => (<AbsoluteFill><Audio src="${BASE}/t-p2.wav" /></AbsoluteFill>);
const Demo = () => (<AbsoluteFill><Audio src="${BASE}/t-p3.wav" /></AbsoluteFill>);
const Prova = () => <AbsoluteFill />;
const Sociale = () => <AbsoluteFill />;
const Chiusura = () => <AbsoluteFill />;

export default function Video() {
	return (
		<TransitionSeries>
			<TransitionSeries.Sequence durationInFrames={120}><Hook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={110}><Promessa /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={110}><Demo /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={110}><Prova /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={110}><Sociale /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={115}><Chiusura /></TransitionSeries.Sequence>
		</TransitionSeries>
	);
}
`;

describe('assertMotionVoiceGate — il caso guida viene bocciato', () => {
	it('6 battute, 3 pause, 4 pezzi: pezzo troncato + metà take mai piazzato → il render è RIFIUTATO', async () => {
		serveWavs({
			// Il take intero: ~16s con le sue pause, coda naturale silenziosa.
			[`${BASE}/t-full.wav`]: wav([2.5, 0.4, 2.5, 0.4, 2.3, 0.4, 2.5, 0.3, 2.4, 0.3, 1.5, 0.5]),
			// I pezzi piazzati: 2s + 2s puliti, e il pezzo 3 TRONCATO (voce fino all'ultimo campione).
			[`${BASE}/t-p1.wav`]: wav([1.8, 0.2]),
			[`${BASE}/t-p2.wav`]: wav([1.8, 0.2]),
			[`${BASE}/t-p3.wav`]: wav([2.28])
		});
		const err = await assertMotionVoiceGate({
			supabase: fakeSupabase('t-full.wav'),
			brandId: 'b1',
			source: GUIDE_SOURCE,
			fps: 30,
			durationInFrames: 675,
			supabaseUrl: ORIGIN
		}).then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(MotionVoiceGateError);
		const text = (err as MotionVoiceGateError).violations.join('\n');
		// Il pezzo 3 troncato a metà parola.
		expect(text).toContain('t-p3.wav');
		expect(text).toContain('TRONCATO');
		// 6,28s piazzati su ~16 di take: le battute buttate, con i beat muti nominati.
		expect(text).toMatch(/ne suonano solo 6\.[0-9]/);
		expect(text).toContain('Prova');
		// Il rimedio è la regola di craft.ts diventata codice: allungare, mai tagliare.
		expect((err as MotionVoiceGateError).remedy).toContain('si allunga il video');
	});

	it('lo stesso video con TUTTE le battute piazzate e tagli puliti passa', async () => {
		const source = GUIDE_SOURCE.replace(
			'const Prova = () => <AbsoluteFill />;',
			`const Prova = () => (<AbsoluteFill><Audio src="${BASE}/t-p4.wav" /></AbsoluteFill>);`
		)
			.replace(
				'const Sociale = () => <AbsoluteFill />;',
				`const Sociale = () => (<AbsoluteFill><Audio src="${BASE}/t-p5.wav" /></AbsoluteFill>);`
			)
			.replace(
				'const Chiusura = () => <AbsoluteFill />;',
				`const Chiusura = () => (<AbsoluteFill><Audio src="${BASE}/t-p6.wav" /></AbsoluteFill>);`
			);
		const clean = wav([2.2, 0.3]);
		serveWavs({
			[`${BASE}/t-full.wav`]: wav([2.5, 0.4, 2.5, 0.4, 2.3, 0.4, 2.5, 0.3, 2.4, 0.3, 1.5, 0.5]),
			[`${BASE}/t-p1.wav`]: clean,
			[`${BASE}/t-p2.wav`]: clean,
			[`${BASE}/t-p3.wav`]: clean,
			[`${BASE}/t-p4.wav`]: clean,
			[`${BASE}/t-p5.wav`]: clean,
			[`${BASE}/t-p6.wav`]: clean
		});
		await expect(
			assertMotionVoiceGate({
				supabase: fakeSupabase('t-full.wav'),
				brandId: 'b1',
				source,
				fps: 30,
				durationInFrames: 675,
				supabaseUrl: ORIGIN
			})
		).resolves.toMatchObject({ voiced: true, checkedClips: 6 });
	});

	it('un video senza voce non controlla niente e non fetcha niente', async () => {
		const calls = serveWavs({});
		await expect(
			assertMotionVoiceGate({
				supabase: fakeSupabase(null),
				brandId: 'b1',
				source: 'export default function V() { return <AbsoluteFill />; }',
				fps: 30,
				durationInFrames: 300,
				supabaseUrl: ORIGIN
			})
		).resolves.toMatchObject({ voiced: false });
		expect(calls).toEqual([]);
	});

	it('un url di voce che non si legge è un beat muto nel file finale: si boccia', async () => {
		serveWavs({}); // tutto 404
		const err = await assertMotionVoiceGate({
			supabase: fakeSupabase(null),
			brandId: 'b1',
			source: `export const fps = 30;\nexport const durationInFrames = 300;\nexport default function V() { return <Audio src="${BASE}/gone.wav" />; }`,
			fps: 30,
			durationInFrames: 300,
			supabaseUrl: ORIGIN
		}).then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(MotionVoiceGateError);
		expect((err as MotionVoiceGateError).violations.join(' ')).toContain('MUTO');
	});

	it('un url ricostruito a memoria (fuori dal nostro storage) non va nemmeno tentato', async () => {
		const calls = serveWavs({});
		const err = await assertMotionVoiceGate({
			supabase: fakeSupabase(null),
			brandId: 'b1',
			source:
				'export default function V() { return <Audio src="https://evil.example/storage/v1/object/public/media/b1/voiceover/x.wav" />; }',
			fps: 30,
			durationInFrames: 300,
			supabaseUrl: ORIGIN
		}).then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(MotionVoiceGateError);
		expect(calls).toEqual([]);
	});
});

describe('isVoiceoverTakeUrl (spostata qui da output-tools, contratto invariato)', () => {
	it('accetta solo il nostro storage sotto /voiceover/', () => {
		expect(isVoiceoverTakeUrl(`${BASE}/t-full.wav`, ORIGIN)).toBe(true);
		expect(
			isVoiceoverTakeUrl(`${ORIGIN}/storage/v1/object/public/media/b1/music/bed.mp3`, ORIGIN)
		).toBe(false);
		expect(
			isVoiceoverTakeUrl('https://evil.example/storage/v1/object/public/media/b1/voiceover/x.wav', ORIGIN)
		).toBe(false);
	});
});
