import { describe, expect, it } from 'vitest';
import {
	VOICE_TAIL_THRESHOLD,
	beatsWithoutVoice,
	checkVoicePlacement,
	findVoiceAudioRefs,
	tailIsTruncated
} from './voice-gate';

const SR = 24_000;
const BASE = 'https://fake.supabase.co/storage/v1/object/public/media/b1/voiceover';

/** Campioni: `pattern` in secondi, alternando voce (ampiezza 8000) e silenzio (0), voce per prima. */
function synth(pattern: number[]): Int16Array {
	const total = Math.round(pattern.reduce((a, b) => a + b, 0) * SR);
	const out = new Int16Array(total);
	let at = 0;
	pattern.forEach((seconds, i) => {
		const n = Math.round(seconds * SR);
		if (i % 2 === 0) out.fill(8000, at, at + n);
		at += n;
	});
	return out;
}

describe('tailIsTruncated — la coda di un taglio giusto è silenziosa', () => {
	it('un pezzo tagliato su una pausa vera (coda muta) passa', () => {
		expect(tailIsTruncated(synth([1.8, 0.2]), SR)).toBe(false);
	});
	it('il pezzo 3 del caso guida — voce fino all\'ultimo campione — è troncato', () => {
		expect(tailIsTruncated(synth([2.28]), SR)).toBe(true);
	});
	it('il fruscio sotto soglia non è voce', () => {
		const s = synth([1.0, 0.5]);
		const cutoff = Math.round(VOICE_TAIL_THRESHOLD * 32768);
		for (let i = s.length - Math.round(0.5 * SR); i < s.length; i++) s[i] = cutoff - 1;
		expect(tailIsTruncated(s, SR)).toBe(false);
	});
});

describe('findVoiceAudioRefs — solo la voce, mai la musica', () => {
	it('trova gli url sotto /voiceover/ e ignora /music/', () => {
		const src = `
			<Audio src="${BASE}/t-p1.wav" />
			<Audio src="https://fake.supabase.co/storage/v1/object/public/media/b1/music/bed.mp3" loop />
		`;
		const refs = findVoiceAudioRefs(src);
		expect(refs).toHaveLength(1);
		expect(refs[0].url).toBe(`${BASE}/t-p1.wav`);
	});
});

/**
 * IL CASO GUIDA (anomalia, 21/8/2026 21:23): 6 beat, voce solo nei primi 3, video da 675 frame
 * (22,5s a 30fps). La violazione di piazzamento qui è il pezzo che eccede il suo beat; i beat muti
 * li nomina beatsWithoutVoice.
 */
const GUIDE_SOURCE = `
export const fps = 30;
export const durationInFrames = 675;

const Hook = () => (
	<AbsoluteFill>
		<Audio src="${BASE}/t-p1.wav" />
	</AbsoluteFill>
);
const Promessa = () => (
	<AbsoluteFill>
		<Audio src="${BASE}/t-p2.wav" />
	</AbsoluteFill>
);
const Demo = () => (
	<AbsoluteFill>
		<Audio src="${BASE}/t-p3.wav" />
	</AbsoluteFill>
);
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

describe('checkVoicePlacement — aritmetica sui frame, come i gate wow e stasi', () => {
	const meta = { fps: 30, durationInFrames: 675 };

	it('un pezzo che ECCEDE il suo beat viene nominato (la battuta verrebbe mozzata)', () => {
		const v = checkVoicePlacement(
			GUIDE_SOURCE,
			[
				{ url: `${BASE}/t-p1.wav`, seconds: 2.0 },
				{ url: `${BASE}/t-p2.wav`, seconds: 2.0 },
				// 5s in un beat da 110 frame (3,67s): 150 > 110.
				{ url: `${BASE}/t-p3.wav`, seconds: 5.0 }
			],
			meta
		);
		expect(v).toHaveLength(1);
		expect(v[0]).toMatchObject({ rule: 'piece_exceeds_beat', component: 'Demo', beatFrames: 110 });
	});

	it('pezzi che ci stanno nei loro beat passano', () => {
		const v = checkVoicePlacement(
			GUIDE_SOURCE,
			[
				{ url: `${BASE}/t-p1.wav`, seconds: 2.0 },
				{ url: `${BASE}/t-p2.wav`, seconds: 2.0 },
				{ url: `${BASE}/t-p3.wav`, seconds: 2.28 }
			],
			meta
		);
		expect(v).toEqual([]);
	});

	it('la voce che suona oltre la fine del video — meno il margine di mezzo secondo — viene bocciata', () => {
		const src = `
export const fps = 30;
export const durationInFrames = 675;
export default function Video() {
	return (
		<AbsoluteFill>
			<Sequence from={600} durationInFrames={75}>
				<Audio src="${BASE}/t-p6.wav" />
			</Sequence>
		</AbsoluteFill>
	);
}
`;
		// 3s = 90 frame da 600: finisce a 690, oltre 675 — e comunque oltre 675-15=660.
		const v = checkVoicePlacement(src, [{ url: `${BASE}/t-p6.wav`, seconds: 3.0 }], meta);
		const rules = v.map((x) => x.rule);
		expect(rules).toContain('voice_past_end');
		expect(rules).toContain('piece_exceeds_beat');
	});

	it('la stessa voce con il beat allungato — il rimedio scritto in craft.ts — passa', () => {
		const src = `
export const fps = 30;
export const durationInFrames = 675;
export default function Video() {
	return (
		<AbsoluteFill>
			<Sequence from={500} durationInFrames={160}>
				<Audio src="${BASE}/t-p6.wav" />
			</Sequence>
		</AbsoluteFill>
	);
}
`;
		expect(checkVoicePlacement(src, [{ url: `${BASE}/t-p6.wav`, seconds: 3.0 }], meta)).toEqual([]);
	});

	it('un Audio con trim non è giudicabile con questa aritmetica: si salta (conservativo)', () => {
		const src = `
export const fps = 30;
export const durationInFrames = 675;
export default function Video() {
	return (
		<Sequence from={600} durationInFrames={75}>
			<Audio src="${BASE}/t-p6.wav" startFrom={30} />
		</Sequence>
	);
}
`;
		expect(checkVoicePlacement(src, [{ url: `${BASE}/t-p6.wav`, seconds: 3.0 }], meta)).toEqual([]);
	});
});

describe('beatsWithoutVoice — i nomi delle battute mute del caso guida', () => {
	it('nomina i beat 4, 5 e 6, non i primi tre', () => {
		expect(beatsWithoutVoice(GUIDE_SOURCE)).toEqual(['Prova', 'Sociale', 'Chiusura']);
	});
	it('un beat la cui voce sta in un figlio diretto non è muto', () => {
		const src = `
const Voce = () => <Audio src="${BASE}/t-p1.wav" />;
const Beat = () => (<AbsoluteFill><Voce /></AbsoluteFill>);
export default function Video() {
	return (
		<TransitionSeries>
			<TransitionSeries.Sequence durationInFrames={120}><Beat /></TransitionSeries.Sequence>
		</TransitionSeries>
	);
}
`;
		expect(beatsWithoutVoice(src)).toEqual([]);
	});
});
