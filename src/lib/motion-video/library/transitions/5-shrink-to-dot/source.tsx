// wow: SCENE_SHRINK_TO_DOT — la scena BIANCA si contrae fino a un puntino su fondo NERO, e quel
// puntino non muore: resta in scena e atterra come il punto fermo della riga successiva.
//
// COME SI OTTIENE UN PUNTO E NON UN FRANCOBOLLO. Due cose insieme, entrambe con la stessa curva:
//   - la scena scala 1 -> 0.02 attorno al punto di fuga;
//   - una maschera circolare, in coordinate di scena, si stringe da 1400 a 700 px.
// Il raggio che si VEDE è il prodotto dei due: 1400 x 1 = 1400 px all'inizio (più grande del
// canvas, quindi la maschera non si nota) e 700 x 0.02 = 14 px alla fine. Senza la maschera il
// collasso finirebbe in un rettangolo 9:16 minuscolo, che non è un puntino.
//
// Il nero non "entra": è il fondo della radice, e il bianco che si ritira lo scopre. La scena B
// si monta esattamente quando il collasso è finito, sul nero pieno — nessun fotogramma di scambio.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const SETTLE = Easing.bezier(0.16, 1.18, 0.28, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const CUT = 2;        // s: il collasso è finito
const SHRINK = 0.6;   // s: durata del collasso
const FLIGHT = 0.55;  // s: il volo del punto fino alla sua posa in B
const TAIL = 1.8;     // s: quanto vive la scena B dopo l'atterraggio

export const durationInFrames = Math.round((CUT + FLIGHT + TAIL) * fps);

// Punto di fuga del collasso, in pixel: è anche il centro della maschera, o il puntino
// scivolerebbe mentre la scena si stringe.
const VX = 540;
const VY = 880;
const DOT_R = 14;    // raggio del puntino appena nato (700 x 0.02)
const PERIOD_R = 20; // raggio del punto fermo, dove atterra
// Dove atterra: il punto fermo dopo la parola. Il testo è allineato a DESTRA e finisce 40 px
// prima del punto, così la spaziatura è esatta senza sapere quanto è larga la parola.
const P_X = 690;
const P_BASE = 1010; // baseline della riga in B
const P_SIZE = 200;

const SceneA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// LA MASCHERA DEVE FINIRE DENTRO LA SCENA, o non è un punto. Il primo giro chiudeva a 700 px
	// in coordinate di scena — cioè più della metà larghezza (540) — quindi il cerchio non
	// tagliava mai i fianchi del rettangolo e sui fotogrammi il collasso finiva in una PASTIGLIA
	// bianca con dentro la parola ancora leggibile. Sotto 540 la maschera è interamente dentro la
	// scena e la forma è un disco vero: 400 x 0.035 = 14 px sullo schermo.
	const shrink = interpolate(frame, [(CUT - SHRINK) * fps, CUT * fps], [1, 0.035], { easing: EXPO, ...CLAMP });
	const clip = interpolate(frame, [(CUT - SHRINK) * fps, CUT * fps], [1400, 400], { easing: EXPO, ...CLAMP });
	// I FIANCHI DELLA SCENA SONO DRITTI, il buco della maschera è tondo: finché il cerchio è più
	// largo della scena, l'intersezione ha due lati piatti e la forma sembra una pastiglia. Il
	// raggio dei bordi che cresce fino al 50% arrotonda anche i fianchi, e l'intersezione resta
	// una forma curva per tutto il collasso. (Serve `overflow: hidden`, o il raggio taglia lo
	// sfondo e la parola dentro no.)
	const round = interpolate(frame, [(CUT - SHRINK) * fps, (CUT - SHRINK * 0.45) * fps], [0, 50], { easing: EXPO, ...CLAMP });
	const rise = spring({ frame, fps, from: 150, to: 0, config: { damping: 11, stiffness: 130, mass: 0.6 } });
	// Viva fino all'ultimo fotogramma prima del collasso: la riga deriva per tutta l'attesa.
	const drift = interpolate(frame, [0, CUT * fps], [16, -16], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#FFFFFF',
				fontFamily: 'Inter, Arial, sans-serif',
				justifyContent: 'center',
				alignItems: 'center',
				transform: 'scale(' + shrink + ')',
				transformOrigin: VX + 'px ' + VY + 'px',
				borderRadius: round + '%',
				overflow: 'hidden',
				clipPath: 'circle(' + clip + 'px at ' + VX + 'px ' + VY + 'px)'
			}}
		>
			<div style={{ color: '#0B0B0F', fontSize: 210, fontWeight: 900, letterSpacing: -8, transform: 'translateY(' + (rise + drift - 80) + 'px)' }}>UNO</div>
			<div style={{ position: 'absolute', bottom: 300, color: '#6B7280', fontSize: 34, letterSpacing: 6, textTransform: 'uppercase', transform: 'translateY(' + drift * 0.5 + 'px)' }}>
				shrink to dot
			</div>
		</AbsoluteFill>
	);
};

const SharedDot: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// LO STESSO punto, sopra entrambe le scene: prende il posto della scena collassata e vola
	// alla sua posa in B. È l'elemento condiviso che rende il taglio un match cut e non un taglio.
	const x = interpolate(frame, [0, FLIGHT * fps], [VX, P_X], { easing: EXPO, ...CLAMP });
	const y = interpolate(frame, [0, FLIGHT * fps], [VY, P_BASE - PERIOD_R], { easing: EXPO, ...CLAMP });
	const r = interpolate(frame, [0, FLIGHT * fps], [DOT_R, PERIOD_R], { easing: EXPO, ...CLAMP });
	// Il punto NASCE della misura esatta in cui la scena si è chiusa (scala 1, 14 px): si gonfia
	// durante il volo e rientra sulla posa. Tre pose in una sola interpolate, perché partire già
	// gonfio romperebbe l'aggancio con il fotogramma prima — e con il clamp è esattamente ciò
	// che succede se il range comincia dopo il frame 0.
	const pop = interpolate(frame, [0, FLIGHT * fps, (FLIGHT + 0.25) * fps], [1, 1.55, 1], { easing: SETTLE, ...CLAMP });
	// Dopo la posa il punto respira: la coda della scena non è mai ferma.
	const breathe = interpolate(frame, [(FLIGHT + 0.22) * fps, (FLIGHT + TAIL) * fps], [1, 1.12], { easing: EXPO, ...CLAMP });
	return (
		<div style={{ position: 'absolute', left: x - r + 'px', top: y - r + 'px', width: r * 2, height: r * 2, borderRadius: '50%', backgroundColor: '#FFFFFF', transform: 'scale(' + pop * breathe + ')' }} />
	);
};

const SceneB: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// La parola si posa NELLO stesso istante in cui il punto atterra: quello è il match cut.
	const rise = spring({ frame, fps, delay: Math.round(FLIGHT * 0.55 * fps), from: 90, to: 0, config: { damping: 12, stiffness: 140, mass: 0.6 } });
	const show = interpolate(frame, [FLIGHT * 0.55 * fps, (FLIGHT * 0.55 + 0.3) * fps], [0, 1], { easing: EXPO, ...CLAMP });
	const drift = interpolate(frame, [0, (FLIGHT + TAIL) * fps], [12, -18], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#000000', fontFamily: 'Inter, Arial, sans-serif' }}>
			{/* Allineato a destra, e il punto fermo lo mette il SharedDot: la spaziatura è
			    aritmetica, non una stima sulla larghezza del glifo. */}
			<svg width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} style={{ opacity: show, transform: 'translateY(' + (rise + drift) + 'px)' }}>
				<text x={P_X - 40} y={P_BASE} textAnchor="end" fontFamily="Inter, Arial, sans-serif" fontSize={P_SIZE} fontWeight={900} fill="#FFFFFF">DUE</text>
			</svg>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: 300, textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 34, letterSpacing: 6, textTransform: 'uppercase', opacity: show, transform: 'translateY(' + drift * 0.6 + 'px)' }}>
				il puntino diventa il punto fermo
			</div>
		</AbsoluteFill>
	);
};

export default function ShrinkToDotDemo() {
	const { fps } = useVideoConfig();
	return (
		// Il fondo della radice È la scena B: il bianco che si ritira scopre il nero, non lo copre.
		<AbsoluteFill style={{ backgroundColor: '#000000' }}>
			<Sequence from={Math.round(CUT * fps)} durationInFrames={Math.round((FLIGHT + TAIL) * fps)}>
				<SceneB />
			</Sequence>
			<Sequence durationInFrames={Math.round(CUT * fps)}>
				<SceneA />
			</Sequence>
			<Sequence from={Math.round(CUT * fps)} durationInFrames={Math.round((FLIGHT + TAIL) * fps)}>
				<SharedDot />
			</Sequence>
		</AbsoluteFill>
	);
}
