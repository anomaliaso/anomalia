// wow: STAGGER_REVEAL — il testo si scrive da solo, e ogni carattere ha il suo istante.
//
// LA TRAPPOLA DEL TYPING È IL METRONOMO. Un carattere ogni N fotogrammi è la cosa più morta
// che esista: si riconosce a occhio in mezzo secondo, perché nessuno scrive a velocità
// costante. Qui ogni carattere ha il SUO costo — lo spazio metà, la punteggiatura una pausa
// vera, gli altri con un jitter deterministico (`random(seed)`, stesso risultato a ogni render).
// Non è decorazione: è la differenza fra "sta scrivendo" e "un contatore avanza".
//
// IL CURSORE NON LAMPEGGIA MENTRE SI SCRIVE. Un blink a tempo fisso sotto un testo che arriva a
// ritmo variabile è l'unica cosa nella scena che batte il tempo, e stona con tutto il resto.
// Solido durante la digitazione, lampeggia solo quando la frase è finita — che è anche quello
// che fa un cursore vero.
//
// NIENTE MISURE DI TESTO. Il cursore è il fratello inline del testo digitato dentro lo stesso
// flex: si posiziona da solo, al pixel, senza sapere quanto è larga una lettera. Nella VM di
// render il font non è quello del browser, quindi qualunque calcolo di larghezza sarebbe una
// scommessa persa.
//
// UNA MOLLA NON HA IL CAMPO `easing` PERCHÉ' NON LE SERVE: la fisica È l'easing. Il controllo
// del movimento lineare guarda le `interpolate` senza easing e non si applica a `spring`.
import React from 'react';
import { AbsoluteFill, Easing, Series, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const GROUND = '#0B0B0F';
const PLATE = '#16161C';
const INK = '#FFFFFF';
const ACCENT = '#0E4DFB';

const TEXT = 'Scrivi il piano di questa settimana.';
const CPS = 17;            // caratteri al secondo, di media
const TYPE_START = 0.5;    // s prima che il primo carattere arrivi

// IL RITMO, calcolato una volta sola: il fotogramma in cui ogni carattere entra.
const STARTS: number[] = [];
let cursorAt = TYPE_START * fps;
for (let i = 0; i < TEXT.length; i++) {
	STARTS.push(cursorAt);
	const ch = TEXT[i];
	const base = fps / CPS;
	const cost =
		ch === ' '
			? base * 0.5
			: '.,;:!?'.indexOf(ch) >= 0
				? base * 5
				: base * (0.7 + random('type-' + i) * 0.8);
	cursorAt += cost;
}
const TYPED_AT = Math.ceil(cursorAt);          // il fotogramma in cui l'ultimo carattere è lì
const SENT_AT = TYPED_AT + Math.round(0.45 * fps);
const BEAT = (SENT_AT + Math.round(1.7 * fps)) / fps;

export const durationInFrames = Math.round(BEAT * fps);

const Cursor: React.FC<{ frame: number; typing: boolean }> = ({ frame, typing }) => {
	// Solido mentre si scrive, lampeggio da 0,54 s solo quando la frase è finita.
	const on = typing || Math.floor((frame - TYPED_AT) / Math.round(0.27 * fps)) % 2 === 0;
	return (
		<span
			style={{
				display: 'inline-block',
				width: 6,
				height: 62,
				marginLeft: 4,
				marginBottom: -8,
				backgroundColor: ACCENT,
				opacity: on ? 1 : 0
			}}
		/>
	);
};

const Prompt: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// Il pannello entra su una molla, non su una interpolate: è un atterraggio.
	const plate = spring({ frame, fps, from: 90, to: 0, config: { damping: 13, stiffness: 140, mass: 0.7 } });
	const plateIn = spring({ frame, fps, from: 0, to: 1, config: { damping: 200, stiffness: 130, mass: 0.5 } });
	// Il bottone si preme quando la frase è finita: la molla lo affonda e lo fa risalire.
	const press = spring({ frame, fps, delay: SENT_AT, from: 1, to: 0.94, config: { damping: 8, stiffness: 260, mass: 0.4 } });
	// La risposta arriva dopo, e arriva atterrando.
	const answer = spring({ frame, fps, delay: SENT_AT + Math.round(0.3 * fps), from: 70, to: 0, config: { damping: 12, stiffness: 150, mass: 0.7 } });
	const answerIn = spring({ frame, fps, delay: SENT_AT + Math.round(0.3 * fps), from: 0, to: 1, config: { damping: 200, stiffness: 130, mass: 0.5 } });

	// LA VITA DEL BEAT: due movimenti lentissimi che partono al primo fotogramma e finiscono
	// all'ultimo, così nessun fotogramma è fermo nemmeno dopo che la risposta si è posata.
	const drift = interpolate(frame, [0, BEAT * fps], [16, -16], { easing: EXPO, ...CLAMP });
	const glow = interpolate(frame, [0, BEAT * fps], [0.06, 0.2], { easing: EXPO, ...CLAMP });

	const typing = frame < TYPED_AT;
	const shown = STARTS.filter((s) => frame >= s).length;

	return (
		<AbsoluteFill
			style={{
				backgroundColor: GROUND,
				justifyContent: 'center',
				alignItems: 'center',
				fontFamily: 'Inter, Arial, sans-serif'
			}}
		>
			<div
				style={{
					position: 'absolute',
					top: 500,
					width: 760,
					height: 760,
					borderRadius: '50%',
					backgroundColor: ACCENT,
					opacity: glow,
					filter: 'blur(120px)',
					transform: 'translateY(' + drift * 2 + 'px)'
				}}
			/>
			<div
				style={{
					width: 900,
					backgroundColor: PLATE,
					borderRadius: 24,
					padding: '44px 44px 36px',
					opacity: plateIn,
					transform: 'translateY(' + (plate + drift * 0.4) + 'px)'
				}}
			>
				<div style={{ color: 'rgba(255,255,255,0.66)', fontSize: 30, letterSpacing: 5, textTransform: 'uppercase', marginBottom: 26 }}>
					chiedi
				</div>
				<div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', color: INK, fontSize: 56, fontWeight: 600, lineHeight: 1.25 }}>
					{TEXT.split('').map((ch, i) => {
						// UNA MOLLA PER CARATTERE: il "tap" che manca al typing lineare. `from` sotto 1
						// e damping basso = il carattere entra sfondando di poco e rientra.
						const pop = spring({ frame, fps, delay: Math.round(STARTS[i]), from: 0.55, to: 1, config: { damping: 11, stiffness: 320, mass: 0.4 } });
						if (i >= shown) return null;
						return (
							<span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', transform: 'scale(' + pop + ')', transformOrigin: '50% 100%' }}>
								{ch}
							</span>
						);
					})}
					<Cursor frame={frame} typing={typing} />
				</div>
				<div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 34 }}>
					<div
						style={{
							backgroundColor: ACCENT,
							color: '#FFFFFF',
							fontSize: 32,
							fontWeight: 700,
							padding: '18px 34px',
							borderRadius: 12,
							transform: 'scale(' + press + ')'
						}}
					>
						Invia
					</div>
				</div>
			</div>
			<div
				style={{
					width: 900,
					marginTop: 28,
					color: INK,
					fontSize: 40,
					fontWeight: 700,
					opacity: answerIn,
					transform: 'translateY(' + (answer + drift * 0.25) + 'px)'
				}}
			>
				<span style={{ color: ACCENT }}>7 post</span> pronti, uno al giorno.
			</div>
		</AbsoluteFill>
	);
};

export default function TypingDemo() {
	const { fps } = useVideoConfig();
	// Dentro una <Series.Sequence> `useCurrentFrame()` riparte da 0: il beat è scritto in tempo
	// locale ed è giusto per costruzione, invece che per fortuna.
	return (
		<AbsoluteFill style={{ backgroundColor: GROUND }}>
			<Series>
				<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
					<Prompt />
				</Series.Sequence>
			</Series>
		</AbsoluteFill>
	);
}
