import { describe, expect, it } from 'vitest';
import {
	MAX_STORYBOARD_FRAMES,
	MAX_STORYBOARD_REFUSALS,
	createStoryboardGate,
	motionSourceFindings,
	storyboardFrames
} from './storyboard';
import { compileMotionSource } from '$lib/motion-video/compile';

/** Sei battute, con le tre forme che i check sul sorgente cercano. Compila (vedi in fondo). */
const SIX_BEATS = `import React from 'react';
import { AbsoluteFill, Easing, Series, interpolate, useCurrentFrame } from 'remotion';

export const fps = 30;
export const durationInFrames = 360;
export const width = 1080;
export const height = 1080;

const Beat = ({ n }: { n: number }) => {
  const frame = useCurrentFrame();
  const drive = interpolate(frame, [0, 60], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1)
  });
  return <AbsoluteFill style={{ opacity: drive }}>{n}</AbsoluteFill>;
};

export default function MotionVideo() {
  return (
    <Series>
      <Series.Sequence durationInFrames={60}><Beat n={1} /></Series.Sequence>
      <Series.Sequence durationInFrames={60}><Beat n={2} /></Series.Sequence>
      <Series.Sequence durationInFrames={60}><Beat n={3} /></Series.Sequence>
      <Series.Sequence durationInFrames={60}><Beat n={4} /></Series.Sequence>
      <Series.Sequence durationInFrames={60}><Beat n={5} /></Series.Sequence>
      <Series.Sequence durationInFrames={60}><Beat n={6} /></Series.Sequence>
    </Series>
  );
}`;

describe('storyboardFrames — un fotogramma per scena', () => {
	it('sei battute, sei fotogrammi, uno dentro ciascuna', () => {
		const frames = storyboardFrames(SIX_BEATS, 360);
		expect(frames).toHaveLength(6);
		frames.forEach((f, i) => {
			expect(f).toBeGreaterThanOrEqual(i * 60);
			expect(f).toBeLessThan((i + 1) * 60);
		});
	});

	it('senza scene dichiarate ripiega sullo spargimento regolare invece di inventarle', () => {
		const frames = storyboardFrames('export default function V() { return null; }', 300);
		expect(frames.length).toBeGreaterThan(0);
		expect(frames.every((f) => f > 0 && f < 300)).toBe(true);
	});

	it('più scene del tetto: si campiona da capo a fondo, mai le prime otto', () => {
		const many = `<Series>${Array.from(
			{ length: 20 },
			() => '<Series.Sequence durationInFrames={30}><A /></Series.Sequence>'
		).join('')}</Series>`;
		const frames = storyboardFrames(many, 600);
		expect(frames.length).toBeLessThanOrEqual(MAX_STORYBOARD_FRAMES);
		// L'ultima scena (frame 570-599) deve essere guardata: è la chiusura del video.
		expect(Math.max(...frames)).toBeGreaterThan(560);
	});
});

describe('motionSourceFindings — quello che un fotogramma non può mostrare', () => {
	/** Tre battute: sotto la soglia dei meccanismi, quindi qui parla solo l'easing. */
	const THREE_BEATS = SIX_BEATS.replace(
		/\s*<Series\.Sequence durationInFrames=\{60\}><Beat n=\{[456]\} \/><\/Series\.Sequence>/g,
		''
	).replace('durationInFrames = 360', 'durationInFrames = 180');

	it('tace su un sorgente pulito: un check che parla sempre è un check che nessuno legge', () => {
		// Con la voce dentro: un video senza `<Audio>` è muto, e quello è un rilievo vero.
		const voiced = THREE_BEATS.replace(
			'<Series>',
			'<Audio src="https://x.supabase.co/storage/v1/object/public/voiceover/take.wav" /><Series>'
		);
		expect(motionSourceFindings(voiced, 30)).toEqual([]);
	});

	it('nomina il movimento lineare, che nessuno still rivela', () => {
		const linear = THREE_BEATS.replace(
			`{
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1)
  }`,
			`{ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }`
		);
		expect(motionSourceFindings(linear, 30).join(' ')).toContain('LINEARE');
	});

	it('su 4+ battute chiede i meccanismi che la QC pretende, e dice DOVE sta il codice', () => {
		// Il difetto che questo progetto ha trovato: il gate bocciava una composizione senza
		// match-cut e senza scala piena, e la ricetta di quelle forme non era in nessun posto che
		// l'agente di chat leggesse. Ora il finding rimanda al ricettario, che è nel suo prompt.
		const found = motionSourceFindings(SIX_BEATS, 30).join(' ');
		expect(found).toContain('TRANSITIONS COOKBOOK');
		expect(found).toContain('MATCH_CUT_DOT');
		expect(found).toContain('FULL_CANVAS_SCALE');
	});

	it('conta le battute anche senza <Sequence> — il gate era spento sui video veri', () => {
		// Trailer in produzione, 22/8: zero tag, sei battute fatte di condizioni sul frame, cinque
		// marcatori `// wow:` e nessuno che li verificasse, perché detectWowMechanisms contava 0.
		const gated = `
export const durationInFrames = 540;
export default function V() {
	const frame = useCurrentFrame();
	const s2 = frame >= 82 && frame < 172;
	const s3 = frame >= 162 && frame < 270;
	const s4 = frame >= 256 && frame < 364;
	const s5 = frame >= 350 && frame < 450;
	return (
		<AbsoluteFill>
			{s2 && <A />}
			{s3 && <B />}
			{s4 && <C />}
			{s5 && <D />}
		</AbsoluteFill>
	);
}`;
		expect(motionSourceFindings(gated, 30).join(' ')).toContain('TRANSITIONS COOKBOOK');
	});
});

describe('il freno: un giudice che boccia sempre deve FERMARSI, non girare', () => {
	it('si rifiuta al massimo MAX_STORYBOARD_REFUSALS volte, poi il render passa comunque', () => {
		const gate = createStoryboardGate();
		let storyboards = 0;
		// Il caso peggiore: l'agente patcha ogni volta (sorgente sempre nuovo, hash sempre diverso)
		// e non è mai contento. Senza tetto questo ciclo non finirebbe.
		for (let attempt = 0; attempt < 50; attempt++) {
			const source = `${SIX_BEATS}\n// patch ${attempt}`;
			if (gate.shouldStoryboard(source)) {
				gate.record(source);
				storyboards += 1;
				continue;
			}
			// Qui il render parte davvero: il ciclo è finito.
			expect(storyboards).toBe(MAX_STORYBOARD_REFUSALS);
			expect(attempt).toBe(MAX_STORYBOARD_REFUSALS);
			return;
		}
		throw new Error('il giro di ritocco non si è mai fermato');
	});

	it('la stessa versione del sorgente si guarda UNA volta sola', () => {
		const gate = createStoryboardGate();
		expect(gate.shouldStoryboard(SIX_BEATS)).toBe(true);
		gate.record(SIX_BEATS);
		// Secondo render_motion_video senza aver toccato niente: l'MP4 esce, non un altro storyboard.
		expect(gate.shouldStoryboard(SIX_BEATS)).toBe(false);
		expect(gate.refusals).toBe(1);
	});

	it('record dice quanti storyboard restano, così l’hint non mente all’agente', () => {
		const gate = createStoryboardGate();
		expect(gate.record('a').left).toBe(MAX_STORYBOARD_REFUSALS - 1);
		expect(gate.record('b').left).toBe(0);
	});
});

describe('la scena di prova compila davvero', () => {
	it('SIX_BEATS è Remotion valido — un test che insegna codice rotto è peggio di nessun test', () => {
		expect(() => compileMotionSource(SIX_BEATS)).not.toThrow();
	});
});
