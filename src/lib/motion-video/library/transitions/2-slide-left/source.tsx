// wow: SLIDE_INERTIA — slide da SINISTRA. La presentazione `slide` di Remotion muove entrambe le
// scene (l'uscente continua a scorrere mentre l'entrante arriva): l'overlap È la transizione.
// La curva della corsa è expo in-out, passata a `linearTiming({easing})` — quasi ferma ai due
// estremi, brutale in mezzo. L'atterraggio non è la stessa curva: la riga della scena B entra
// su una MOLLA, in ritardo sul pannello, così niente si posa contro un muro.
//
// IMPORT: `slide` viene da '@remotion/transitions/slide', mai dalla radice del pacchetto.
// Dalla radice compila e poi muore al render con "(0, esm_namespaceObject.slide) is not a function".
import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const BEAT = 2.1; // s per beat
const OV = 0.55;  // s di transizione: questi frame appartengono a ENTRAMBE le scene

// In una TransitionSeries la durata totale è la somma dei beat MENO le transizioni.
export const durationInFrames = Math.round((BEAT * 2 - OV) * fps);

const Panel: React.FC<{ bg: string; word: string; caption: string; delay: number }> = ({
	bg,
	word,
	caption,
	delay
}) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// L'atterraggio, e basta: la molla sfonda e rientra da sola — nessun interpolate da incartare
	// con un easing finto. `delay` fa arrivare la parola DOPO il pannello: è l'inerzia.
	const rise = spring({ frame, fps, delay, from: 150, to: 0, config: { damping: 11, stiffness: 130, mass: 0.6 } });
	const settle = spring({ frame, fps, delay, from: 1.09, to: 1, config: { damping: 9, stiffness: 150, mass: 0.5 } });
	// Niente si ferma mai: la deriva del gruppo copre il beat fino all'ultimo frame della
	// transizione che lo chiude.
	const drift = interpolate(frame, [0, BEAT * fps], [18, -18], { easing: EXPO, ...CLAMP });
	// La barra d'accento attraversa la scena per tutta la sua durata: seconda linea di vita.
	const bar = interpolate(frame, [0, BEAT * fps], [-420, 420], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter, Arial, sans-serif' }}>
			<div style={{ position: 'absolute', top: 900, left: 0, right: 0, height: 6, overflow: 'hidden' }}>
				<div style={{ width: 260, height: 6, backgroundColor: 'rgba(255,255,255,0.55)', transform: 'translateX(' + (540 + bar) + 'px)' }} />
			</div>
			<div style={{ transform: 'translateY(' + (rise + drift) + 'px) scale(' + settle + ')', color: '#fff', fontSize: 190, fontWeight: 900, letterSpacing: -6 }}>{word}</div>
			<div style={{ position: 'absolute', bottom: 220, color: 'rgba(255,255,255,0.62)', fontSize: 34, letterSpacing: 6, textTransform: 'uppercase', transform: 'translateY(' + drift * 0.4 + 'px)' }}>{caption}</div>
		</AbsoluteFill>
	);
};

export default function SlideLeftDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#0B0B0F' }}>
			<TransitionSeries>
				<TransitionSeries.Sequence durationInFrames={Math.round(BEAT * fps)}>
					<Panel bg="#0B0B0F" word="PRIMA" caption="slide · from-left" delay={0} />
				</TransitionSeries.Sequence>
				<TransitionSeries.Transition
					presentation={slide({ direction: 'from-left' })}
					timing={linearTiming({ durationInFrames: Math.round(OV * fps), easing: EXPO })}
				/>
				<TransitionSeries.Sequence durationInFrames={Math.round(BEAT * fps)}>
					{/* delay = un terzo della transizione: la parola arriva DOPO il pannello, non con lui. */}
					<Panel bg="#0E4DFB" word="DOPO" caption="expo in-out · 0,55 s" delay={Math.round(OV * fps * 0.34)} />
				</TransitionSeries.Sequence>
			</TransitionSeries>
		</AbsoluteFill>
	);
}
