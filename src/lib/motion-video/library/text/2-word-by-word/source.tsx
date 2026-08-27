// wow: STAGGER_REVEAL — una parola alla volta, e ogni parola ATTERRA su una molla.
//
// È il movimento del keynote: la frase si costruisce davanti a chi guarda, ogni parola arriva
// e RESTA. Chi è già entrato non si parcheggia — la deriva del blocco copre la battuta fino
// all'ultimo fotogramma.
//
// LE MOLLE SONO IL CONTENUTO, NON UN DETTAGLIO. Una parola che atterra è esattamente il lavoro
// per cui la molla esiste: sfonda di poco il valore finale e rientra in due o tre fotogrammi.
// Rifarlo con `interpolate` più un easing di overshoot è più codice, meno vivo, e sui numeri
// misurati è il predittore della qualità che si perde.
//
// UNA MOLLA NON HA IL CAMPO `easing` PERCHÉ' NON LE SERVE: la fisica È l'easing. Il controllo
// sul movimento lineare (`findLinearMotion`) guarda le `interpolate` senza easing e non si
// applica a `spring`. Non avvolgere una molla dentro una interpolate per attaccarle un easing,
// e non togliere le molle per far sembrare tutto uniforme.
//
// TRE COSE CHE QUESTA VOCE DEVE MOSTRARE, perché è fra le più copiate e un difetto qui si
// moltiplica:
//  1. LA TIPOGRAFIA RIEMPIE LA TELA. Sette righe a 190 px occupano 1330 dei 1920 px di altezza,
//     cioè il 69%. Un blocco piccolo in mezzo a una distesa di fondo non è minimalismo, è una
//     tela sprecata — ma una riga tagliata dal bordo è peggio: vedi LA MISURA qui sotto.
//  2. NIENTE DIDASCALIE DEL TEMPLATE. Nessuna etichetta che descrive il meccanismo, nessuna barra
//     di avanzamento: chi copia la voce si porterebbe dietro anche quelle. Una voce, un movimento.
//  3. SI VA A CAPO DOVE L'INTERRUZIONE PORTA UN SIGNIFICATO, mai per pareggiare le righe: qui ogni
//     riga si chiude su una virgola o sul punto, e la ripetizione di «già» È il contenuto.
import React from 'react';
import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Lime acido su carbone, non il blu di default di un framework. 16:1 sul fondo: molto oltre il
// 4,5:1 del corpo e il 3:1 del display, quindi regge anche rimpicciolito nel feed.
const GROUND = '#0E0E11';
const INK = '#FFFFFF';
const ACCENT = '#C8FF3D';

const STEP = 0.12;   // s fra una parola e la successiva
const BEAT = 5.2;
const LINE_H = 190;

export const durationInFrames = Math.round(BEAT * fps);

// Ogni riga si chiude dove l'interruzione significa qualcosa. L'ultima riga è quella accentata:
// è il punto in cui la frase smette di descrivere e conclude.
const LINES: readonly (readonly string[])[] = [
	['Una', 'settimana'],
	['di', 'contenuti.'],
	['Scritta.'],
	['Approvata.'],
	['Programmata.'],
	['In', 'coda.'],
	['Lunedì,', 'ore', '7.']
];
const ACCENT_LINE = 6;

const Line: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// LA VITA DELLA BATTUTA: una deriva lentissima dal primo all'ultimo fotogramma. Senza questa,
	// quando l'ultima parola si è posata la scena è un fermo immagine — il difetto che
	// `findStaticTails` rifiuta.
	const drift = interpolate(frame, [0, BEAT * fps], [30, -30], { easing: EXPO, ...CLAMP });
	const bleed = interpolate(frame, [0, BEAT * fps], [-260, 180], { easing: EXPO, ...CLAMP });

	let n = -1;
	return (
		<AbsoluteFill
			style={{
				backgroundColor: GROUND,
				justifyContent: 'center',
				alignItems: 'flex-start',
				padding: '0 86px',
				fontFamily: 'Inter, Arial, sans-serif',
				overflow: 'hidden'
			}}
		>
			{/* L'unica cosa oltre al testo: una barra d'accento che attraversa la tela per tutta la
			    battuta. Non descrive niente — è la seconda linea di vita della scena. */}
			<div
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					width: 14,
					height: 1920,
					backgroundColor: ACCENT,
					transform: 'translateY(' + bleed + 'px)'
				}}
			/>
			<div style={{ transform: 'translateY(' + drift * 0.3 + 'px)' }}>
				{LINES.map((words, li) => (
					<div key={li} style={{ display: 'flex', gap: 28, height: LINE_H, alignItems: 'center' }}>
						{words.map((w) => {
							n += 1;
							const delay = Math.round(n * STEP * fps);
							// L'ATTERRAGGIO, tre molle sullo stesso istante con tre uscite diverse.
							// `damping` basso = la parola respira; `mass` sotto 1 = arriva svelta.
							const rise = spring({ frame, fps, delay, from: 150, to: 0, config: { damping: 12, stiffness: 150, mass: 0.7 } });
							const pop = spring({ frame, fps, delay, from: 0.86, to: 1, config: { damping: 10, stiffness: 170, mass: 0.6 } });
							const ink = spring({ frame, fps, delay, from: 0, to: 1, config: { damping: 200, stiffness: 120, mass: 0.5 } });
							return (
								<span
									key={w + n}
									style={{
										display: 'inline-block',
										color: li === ACCENT_LINE ? ACCENT : INK,
										opacity: ink,
										fontSize: 140,
										lineHeight: 1,
										fontWeight: 800,
										letterSpacing: -6,
										transform: 'translateY(' + (rise + drift * 0.1 * (li + 1)) + 'px) scale(' + pop + ')',
										transformOrigin: '0% 70%'
									}}
								>
									{w}
								</span>
							);
						})}
					</div>
				))}
			</div>
		</AbsoluteFill>
	);
};

export default function WordByWordDemo() {
	const { fps } = useVideoConfig();
	// UNA <Series.Sequence> ANCHE CON UNA BATTUTA SOLA, ed è deliberato: dentro una Sequence
	// `useCurrentFrame()` riparte da 0, quindi il codice della battuta è scritto in tempo locale
	// ed è giusto per costruzione. È la forma in cui aggiungere la seconda battuta non rompe la
	// prima.
	return (
		<AbsoluteFill style={{ backgroundColor: GROUND }}>
			<Series>
				<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
					<Line />
				</Series.Sequence>
			</Series>
		</AbsoluteFill>
	);
}
