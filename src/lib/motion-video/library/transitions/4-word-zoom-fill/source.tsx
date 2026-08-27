// wow: WORD_ZOOM_CUT — la parola scala finché l'INTERNO di una sua lettera È il fondo della
// scena dopo. Non è una dissolvenza e non è un fade to color: sotto la parola c'è già la
// scena B, dipinta dello stesso blu dell'inchiostro, e la lettera cresce finché lo schermo è
// tutto dentro l'asta della "I". Quando la scena A si smonta, il fotogramma è identico prima e
// dopo — per questo il taglio non si vede.
//
// PERCHÉ' LA "I" È UN <rect> E NON UN GLIFO. Il pezzo delicato è uno solo: il punto attorno a
// cui si scala deve stare DENTRO l'inchiostro, e restarci fino alla fine. Con un glifo vero
// quel punto è una stima su metriche di font che nella VM di render non sappiamo quale sia
// (Inter non c'è, si ripiega su un sans di sistema). Una "I" di un sans bold, però, È un
// rettangolo: quindi la disegno io, con centro e larghezza noti al pixel, e la geometria diventa
// aritmetica invece che scommessa. V e A restano tipografia vera: non devono garantire niente.
//
// L'ARITMETICA DELLA COPERTURA, dichiarata: scalando attorno al centro d'inchiostro della I,
// lo schermo è interamente dentro l'asta quando (I_W / 2) * zoom > 540 (metà larghezza del
// canvas) e (CAP / 2) * zoom > 960. Con I_W 61 px e CAP 245 px servono zoom > 17,6 e > 7,8.
//
// E QUI C'È LA TARATURA CHE SI VEDE SOLO RENDERIZZANDO. Il primo giro aveva BLOW 0,55 s e
// BLOW_SCALE 44 — cioè due volte e mezzo il minimo — e sui fotogrammi la crescita durava TRE
// frame: l'expo in-out è quasi piatta all'inizio, poi verticale, quindi con una corsa lunga il
// doppio del necessario la copertura arriva a metà curva e il resto è blu pieno. Una transizione
// che non si legge non è una transizione. Adesso la corsa è più lunga (0,8 s) e più corta di
// strada (22, cioè il minimo più un quarto): la parte ripida della curva cade DENTRO la finestra
// visibile e la lettera cresce per una decina di fotogrammi. La curva è la stessa, estrema; è
// il rapporto fra corsa e durata che era sbagliato.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const ACCENT = '#0E4DFB';
const PAPER = '#FFFFFF';

const CUT = 2;      // s: la parola parte verso la camera
const BLOW = 0.8;   // s: la finestra della corsa — l'overlap È la transizione
// s dopo CUT in cui l'inchiostro ha coperto tutto: misurato sui fotogrammi, non stimato.
// (A 0,7 della finestra l'expo in-out vale ~0,93 di progresso, cioè zoom ~20,5 > 17,6.)
// La scena A si smonta QUI e non alla fine della corsa: così la coda non è mezzo secondo di
// blu pieno con la curva che continua a correre fuori campo.
const FILL = 0.56;
const TAIL = 1.9;   // s: quanto vive la scena B

export const durationInFrames = Math.round((CUT + FILL + TAIL) * fps);

// --- Geometria della parola: tutta in costanti, niente stime sul font. ---
const SIZE = 340;              // corpo
const ADV = 0.62 * SIZE;       // passo fra i centri delle lettere: lo decido io
const BASE = 1060;             // baseline
const CAP = 0.72 * SIZE;       // altezza maiuscola (media dei sans: 0,70-0,73 em)
const I_W = 0.18 * SIZE;       // larghezza dell'asta della I — un display bold generoso
const I_X = 540;               // la I è la lettera centrale e sta al centro del canvas
const I_CY = BASE - CAP / 2;   // centro d'inchiostro della I: qui si punta la camera
const BLOW_SCALE = 22;
const STAG = 0.16;             // s fra una lettera e la successiva (sfalsamento, mai tutte insieme)

const SceneA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// La corsa oltre la camera: expo in-out, quasi ferma ai due estremi e verticale in mezzo.
	const zoom = interpolate(frame, [CUT * fps, (CUT + BLOW) * fps], [1, BLOW_SCALE], { easing: EXPO, ...CLAMP });
	// La scena non è MAI ferma fra l'entrata e il taglio: il tracking si stringe per tutta l'attesa.
	const track = interpolate(frame, [0.5 * fps, CUT * fps], [1.08, 1], { easing: EXPO, ...CLAMP });
	const capDrift = interpolate(frame, [0, CUT * fps], [14, -14], { easing: EXPO, ...CLAMP });
	// Entrata sfalsata: una lettera ogni 0,16 s, ognuna su una molla che sfonda e rientra.
	const riseOf = (i: number) =>
		spring({ frame, fps, delay: Math.round(i * STAG * fps), from: 190, to: 0, config: { damping: 12, stiffness: 130, mass: 0.6 } });
	const rV = riseOf(0);
	const rI = riseOf(1);
	const rA = riseOf(2);
	return (
		<AbsoluteFill style={{ backgroundColor: PAPER, fontFamily: 'Inter, Arial, sans-serif' }}>
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: 240, textAlign: 'center', color: '#6B7280', fontSize: 34, letterSpacing: 6, textTransform: 'uppercase', transform: 'translateY(' + capDrift + 'px)' }}>
				word zoom · expo in-out
			</div>
			{/* Il wrapper scala attorno al centro d'inchiostro della I: da lì in poi lo schermo
			    entra DENTRO la lettera, e ciò che si vede è il colore della scritta. */}
			<div style={{ position: 'absolute', left: 0, top: 0, width: width, height: height, transform: 'scale(' + zoom + ')', transformOrigin: I_X + 'px ' + I_CY + 'px' }}>
				<svg width={width} height={height} viewBox={'0 0 ' + width + ' ' + height}>
					<text x={I_X - ADV * track} y={BASE + rV} textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize={SIZE} fontWeight={900} fill={ACCENT}>V</text>
					<rect x={I_X - I_W / 2} y={BASE - CAP + rI} width={I_W} height={CAP} fill={ACCENT} />
					<text x={I_X + ADV * track} y={BASE + rA} textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize={SIZE} fontWeight={900} fill={ACCENT}>A</text>
				</svg>
			</div>
		</AbsoluteFill>
	);
};

const SceneB: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// B non nasce ferma: eredita il movimento della lettera che l'ha rivelata e si posa.
	const settle = interpolate(frame, [0, 0.6 * fps], [1.06, 1], { easing: EXPO, ...CLAMP });
	const rise = spring({ frame, fps, delay: Math.round(0.1 * fps), from: 120, to: 0, config: { damping: 11, stiffness: 140, mass: 0.6 } });
	// La coda del beat resta viva fino all'ultimo fotogramma.
	const drift = interpolate(frame, [0, TAIL * fps], [10, -22], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: ACCENT, justifyContent: 'center', alignItems: 'center', fontFamily: 'Inter, Arial, sans-serif', transform: 'scale(' + settle + ')' }}>
			<div style={{ color: '#fff', fontSize: 200, fontWeight: 900, letterSpacing: -8, transform: 'translateY(' + (rise + drift) + 'px)' }}>ORA</div>
			<div style={{ position: 'absolute', bottom: 240, color: 'rgba(255,255,255,0.7)', fontSize: 34, letterSpacing: 6, textTransform: 'uppercase', transform: 'translateY(' + drift * 0.5 + 'px)' }}>
				il colore della scritta è il fondo
			</div>
		</AbsoluteFill>
	);
};

export default function WordZoomFillDemo() {
	const { fps } = useVideoConfig();
	return (
		// Il fondo della radice È il fondo di B: durante la corsa, sotto l'inchiostro non c'è
		// niente da rivelare che non sia già dello stesso colore.
		<AbsoluteFill style={{ backgroundColor: ACCENT }}>
			<Sequence from={Math.round((CUT + FILL) * fps)} durationInFrames={Math.round(TAIL * fps)}>
				<SceneB />
			</Sequence>
			{/* A si smonta DUE fotogrammi dopo la copertura totale: sul fotogramma dello scambio i
			    due strati sono lo stesso blu pieno, quindi lo scambio non ha nessun frame visibile. */}
			<Sequence durationInFrames={Math.round((CUT + FILL) * fps) + 2}>
				<SceneA />
			</Sequence>
		</AbsoluteFill>
	);
}
