/**
 * IL RICETTARIO DELLE TRANSIZIONI — codice, non aggettivi.
 *
 * La lezione che ha generato questo file: le regole di craft scritte in prosa non cambiano il
 * comportamento del modello; quelle con il CODICE dentro sì (vedi `craft.ts`, che cita
 * `<TransitionSeries.Sequence durationInFrames={3*fps}>` ed è l'unica sezione che ha spostato
 * l'output). Quindi il "wow" che il proprietario chiede — scale dell'intera pagina, match-cut in
 * cui una scena collassa in un punto che diventa il puntino della "i" del titolo dopo — vive qui
 * in due forme che si tengono a vicenda:
 *
 *  1. Snippet COMPLETI e COMPILANTI (il test li passa in `compileMotionSource`): l'agente copia
 *     e adatta, non re-inventa.
 *  2. La regola con un numero in `MOTION_CRAFT_SPECS` (craft.ts) che li nomina.
 *
 * Ogni snippet porta un commento marcatore `// wow: NOME` sul meccanismo.
 *
 * `detectWowMechanisms` era la terza forma: l'euristica che il giudice di craft leggeva per
 * rifiutare una composizione a 4+ beat senza nessun meccanismo. Il giudice è stato tolto il
 * 29/8/2026 e l'euristica è rimasta senza chiamanti di produzione — la esercitano solo i test.
 * Niente rifiuta più una composizione su questa base.
 *
 * Puro, client-safe (niente $lib/server): lo legge il prompt dell'agente.
 */
import {
	MOTION_EXPO_IN_OUT,
	MOTION_OVERSHOOT_OUT,
	collectConsts,
	resolveNumber,
	stripNonCode
} from './easing';

export type TransitionsCookbookEntry = {
	name: string;
	/** Una riga: quando usarla. Finisce nel prompt sopra il codice. */
	when: string;
	/** Modulo Remotion completo: compila da solo (il test lo garantisce). */
	code: string;
	/**
	 * L'ultima COTTURA IN VM, non la compilazione: `npm run bake:motion-library -- --cookbook`
	 * renderizza ogni voce con lo stesso percorso del render di produzione e riempie questo campo.
	 *
	 * PERCHE' E' UN CAMPO E NON UNA SPERANZA. Il test del ricettario passa ogni voce per
	 * `compileMotionSource`, che esegue SOLO il corpo del modulo: una voce può superarlo e morire
	 * al render — è esattamente come sono esplosi due render in produzione. Una voce con
	 * `renders: false` resta nel codice con la sua ragione, ma non finisce nell'indice
	 * dell'agente: una ricetta che non renderizza insegna un video rotto.
	 */
	renders: boolean;
	/** Solo quando `renders` è false: l'errore che il render ha restituito, per non riprovarci al buio. */
	renderError?: string;
};

/* ------------------------------------------------------------------------------------------------
 * Gli snippet. Convenzioni interne (le stesse delle craft specs):
 * - easing expo in-out su ogni percorrenza, overshoot solo sull'ultima posa;
 * - ogni interpolate con clamp;
 * - durate in secondi * fps;
 * - stringhe concatenate ('scale(' + zoom + ')') e mai template literal, così il codice vive
 *   dentro un template literal TS senza escape.
 * ---------------------------------------------------------------------------------------------- */

const FULL_CANVAS_SCALE_CODE = `// wow: FULL_CANVAS_SCALE — la scena uscente scala OLTRE la camera e rivela quella nuova già sotto.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const SETTLE = ${MOTION_OVERSHOOT_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const CUT = 3;   // secondo in cui la scena B monta sotto
const OV = 0.6;  // durata della scalata oltre camera (l'overlap E' la transizione)

export const durationInFrames = Math.round((CUT + 3.6) * fps);

const SceneA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// WHY: l'origin NON e' il centro geometrico ma l'elemento che motiva il taglio (qui il badge
	// in alto a destra) — la camera "entra" dentro di lui, e il taglio ha un perche'.
	const zoom = interpolate(frame, [CUT * fps, (CUT + OV) * fps], [1, 8], { easing: EXPO, ...CLAMP });
	const fade = interpolate(frame, [(CUT + OV * 0.55) * fps, (CUT + OV) * fps], [1, 0], { easing: EXPO, ...CLAMP });
	const enter = interpolate(frame, [0, 0.8 * fps], [40, 0], { easing: SETTLE, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014', justifyContent: 'center', alignItems: 'center', transform: 'scale(' + zoom + ')', transformOrigin: '62% 34%', opacity: fade }}>
			<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 120, fontWeight: 800, transform: 'translateY(' + enter + 'px)' }}>Beat A</div>
		</AbsoluteFill>
	);
};

const SceneB: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// Variante inversa nello stesso pattern: B arriva ENORME (2.4x) e si posa a 1.
	const settle = interpolate(frame, [0, 0.7 * fps], [2.4, 1], { easing: EXPO, ...CLAMP });
	// La scena non si ferma MAI: una deriva lenta copre il beat fino all'ultimo frame.
	const drift = interpolate(frame, [0, 3.6 * fps], [0, -22], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB', justifyContent: 'center', alignItems: 'center', transform: 'scale(' + settle + ')', transformOrigin: '50% 45%' }}>
			<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 120, fontWeight: 800, transform: 'translateY(' + drift + 'px)' }}>Beat B</div>
		</AbsoluteFill>
	);
};

export default function FullCanvasScaleDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB' }}>
			{/* B sotto, montato al taglio: A gli scala SOPRA e lo rivela. L'ordine JSX decide chi sta sopra. */}
			<Sequence from={Math.round(CUT * fps)} durationInFrames={Math.round(3.6 * fps)}>
				<SceneB />
			</Sequence>
			<Sequence durationInFrames={Math.round((CUT + OV) * fps)}>
				<SceneA />
			</Sequence>
		</AbsoluteFill>
	);
}`;

const MATCH_CUT_DOT_CODE = `// wow: MATCH_CUT_DOT — la scena collassa in un disco, e quel disco ATTERRA come puntino della "i" del titolo dopo.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const SETTLE = ${MOTION_OVERSHOOT_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// --- Costanti di layout: il puntino e' CALCOLABILE perche' il titolo e' piazzato con numeri noti. ---
// Il trucco: il titolo scrive la sua i SENZA puntino (la dotless "\\u0131") e come PRIMO glifo,
// allineato a sinistra — cosi' la x del puntino non dipende dalla larghezza delle lettere prima.
const TITLE_LEFT = 120;
const TITLE_TOP = 900;
const TITLE_SIZE = 150;
// Approssimazione DICHIARATA (vale per un sans tipo Inter): centro-x della dotless-i ~ left + 0.14em,
// centro-y del puntino ~ top + 0.10em. Verifica con render_stills e correggi QUESTE due costanti,
// non l'animazione.
const DOT_X = TITLE_LEFT + 0.14 * TITLE_SIZE;
const DOT_Y = TITLE_TOP + 0.10 * TITLE_SIZE;
const DOT_R = 0.075 * TITLE_SIZE;

const CUT = 3;        // s: la scena A ha finito di collassare
const COLLAPSE = 0.7; // s: collasso della scena nel disco
const FLIGHT = 0.6;   // s: volo del disco fino al puntino
// Dove collassa la scena A: il punto di fuga e' l'elemento che motiva il taglio, non il centro.
const SRC_X = 540;
const SRC_Y = 820;

const SceneA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// L'intera scena dentro una maschera circolare che si stringe fino al raggio del puntino.
	const r = interpolate(frame, [(CUT - COLLAPSE) * fps, CUT * fps], [1500, DOT_R], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014', justifyContent: 'center', alignItems: 'center', clipPath: 'circle(' + r + 'px at ' + SRC_X + 'px ' + SRC_Y + 'px)' }}>
			<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 96, fontWeight: 800 }}>Scena che collassa</div>
		</AbsoluteFill>
	);
};

const SharedDot: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// LO STESSO disco, sopra entrambe le scene: vola da dove la scena e' collassata al puntino.
	const x = interpolate(frame, [0, FLIGHT * fps], [SRC_X, DOT_X], { easing: EXPO, ...CLAMP });
	const y = interpolate(frame, [0, FLIGHT * fps], [SRC_Y, DOT_Y], { easing: EXPO, ...CLAMP });
	const pop = interpolate(frame, [FLIGHT * 0.6 * fps, FLIGHT * fps], [1.35, 1], { easing: SETTLE, ...CLAMP });
	return (
		<div style={{ position: 'absolute', left: (x - DOT_R) + 'px', top: (y - DOT_R) + 'px', width: DOT_R * 2, height: DOT_R * 2, borderRadius: '50%', backgroundColor: '#fff', transform: 'scale(' + pop + ')' }} />
	);
};

const SceneB: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// Il titolo si posa NELLO stesso istante in cui il disco atterra: quello e' il match cut.
	const rise = interpolate(frame, [0, FLIGHT * fps], [60, 0], { easing: SETTLE, ...CLAMP });
	const show = interpolate(frame, [0, 0.3 * fps], [0, 1], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB' }}>
			<div style={{ position: 'absolute', left: TITLE_LEFT, top: TITLE_TOP, fontFamily: 'Inter, sans-serif', fontSize: TITLE_SIZE, fontWeight: 800, color: '#fff', lineHeight: 1, opacity: show, transform: 'translateY(' + rise + 'px)' }}>
				{'\\u0131nsight'}
			</div>
		</AbsoluteFill>
	);
};

export const durationInFrames = Math.round(6.5 * fps);

export default function MatchCutDotDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB' }}>
			{/* Sfondo radice = sfondo di B: durante il collasso, fuori dal cerchio si vede gia' B. */}
			<Sequence from={Math.round(CUT * fps)}>
				<SceneB />
			</Sequence>
			<Sequence durationInFrames={Math.round(CUT * fps)}>
				<SceneA />
			</Sequence>
			{/* L'elemento CONDIVISO, sopra entrambe: resta fino alla fine — E' il puntino del titolo. */}
			<Sequence from={Math.round(CUT * fps)}>
				<SharedDot />
			</Sequence>
		</AbsoluteFill>
	);
}`;

const ELEMENT_CARRYOVER_CODE = `// wow: ELEMENT_CARRYOVER — un elemento sopravvive al taglio e si ricontestualizza (il prezzo di A diventa il titolo di B).
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const SETTLE = ${MOTION_OVERSHOOT_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const CUT = 3;    // s: fine della scena A
const OV = 0.6;   // s: finestra del volo, a cavallo del taglio
const LAND = 0.3; // s: assestamento del volo dentro B

// Posa dell'elemento in A e in B: costanti note, cosi' il volo e' aritmetica e non stima.
const A_X = 340; const A_Y = 1200; const A_SIZE = 72;
const B_X = 120; const B_Y = 320; const B_SIZE = 160;

export const durationInFrames = Math.round(6.5 * fps);

const SceneA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// La copia inline sparisce ESATTAMENTE quando l'overlay parte: mai due copie visibili insieme.
	const own = interpolate(frame, [(CUT - OV) * fps - 1, (CUT - OV) * fps], [1, 0], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014' }}>
			<div style={{ position: 'absolute', left: A_X, top: A_Y, fontFamily: 'Inter, sans-serif', fontSize: A_SIZE, fontWeight: 800, color: '#fff', opacity: own }}>29€</div>
			<div style={{ position: 'absolute', left: 120, top: 1000, fontFamily: 'Inter, sans-serif', fontSize: 54, color: '#9CA3AF' }}>Il piano completo</div>
		</AbsoluteFill>
	);
};

const CarriedElement: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// L'UNICA copia visibile durante il volo: posizione e corpo interpolati dalla posa A alla posa B.
	const ex = interpolate(frame, [0, OV * fps], [A_X, B_X], { easing: EXPO, ...CLAMP });
	const ey = interpolate(frame, [0, OV * fps], [A_Y, B_Y], { easing: EXPO, ...CLAMP });
	const size = interpolate(frame, [0, OV * fps], [A_SIZE, B_SIZE], { easing: EXPO, ...CLAMP });
	const land = interpolate(frame, [OV * fps, (OV + LAND) * fps], [1.06, 1], { easing: SETTLE, ...CLAMP });
	return (
		<div style={{ position: 'absolute', left: ex + 'px', top: ey + 'px', fontFamily: 'Inter, sans-serif', fontSize: size, fontWeight: 800, color: '#fff', transform: 'scale(' + land + ')', transformOrigin: '0% 50%' }}>29€</div>
	);
};

const SceneB: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// La copia inline di B appare solo quando l'overlay ha finito di atterrare.
	const own = interpolate(frame, [(OV + LAND) * fps - 1, (OV + LAND) * fps], [0, 1], { easing: EXPO, ...CLAMP });
	const sub = interpolate(frame, [(OV + LAND) * fps, (OV + LAND + 0.5) * fps], [30, 0], { easing: SETTLE, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB' }}>
			<div style={{ position: 'absolute', left: B_X, top: B_Y, fontFamily: 'Inter, sans-serif', fontSize: B_SIZE, fontWeight: 800, color: '#fff', opacity: own }}>29€</div>
			<div style={{ position: 'absolute', left: B_X, top: B_Y + B_SIZE + 24, fontFamily: 'Inter, sans-serif', fontSize: 56, color: '#DCE4FF', transform: 'translateY(' + sub + 'px)' }}>al mese. Tutto incluso.</div>
		</AbsoluteFill>
	);
};

export default function ElementCarryoverDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB' }}>
			<Sequence from={Math.round(CUT * fps)}>
				<SceneB />
			</Sequence>
			<Sequence durationInFrames={Math.round(CUT * fps)}>
				<SceneA />
			</Sequence>
			{/* Il volo parte DENTRO A e finisce DENTRO B: e' l'elemento sopra entrambe che fa il match cut. */}
			<Sequence from={Math.round((CUT - OV) * fps)} durationInFrames={Math.round((OV + LAND) * fps)}>
				<CarriedElement />
			</Sequence>
		</AbsoluteFill>
	);
}`;

const MASK_REVEAL_TYPE_CODE = `// wow: MASK_REVEAL_TYPE — la scena dopo si vede SOLO attraverso il display type, che poi scala oltre la camera.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const CUT = 2.5;  // s: quando appare il layer mascherato
const HOLD = 1.2; // s: la parola-finestra respira
const BLOW = 0.8; // s: la maschera esplode oltre la camera -> B completamente rivelata

export const durationInFrames = Math.round(7 * fps);

// La maschera e' un SVG data-URI: testo bianco = visibile, resto = trasparente.
// WHY inline: nessun asset esterno, la parola e' parte del codice come tutto il resto del type.
const maskSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><text x="540" y="1010" font-family="Inter, Arial, sans-serif" font-size="330" font-weight="800" fill="#fff" text-anchor="middle">WOW</text></svg>');
const maskUrl = 'url("data:image/svg+xml,' + maskSvg + '")';

const MaskedNext: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// Tre pose: respiro (100 -> 118) e poi il salto oltre la camera (118 -> 3600). Una sola interpolate.
	const size = interpolate(
		frame,
		[0, HOLD * fps, (HOLD + BLOW) * fps],
		[100, 118, 3600],
		{ easing: EXPO, ...CLAMP }
	);
	return (
		<AbsoluteFill
			style={{
				WebkitMaskImage: maskUrl,
				maskImage: maskUrl,
				WebkitMaskRepeat: 'no-repeat',
				maskRepeat: 'no-repeat',
				WebkitMaskPosition: 'center',
				maskPosition: 'center',
				WebkitMaskSize: size + '%',
				maskSize: size + '%'
			}}
		>
			{/* La scena B vera e propria: visibile prima solo dentro le lettere, poi tutta. */}
			<AbsoluteFill style={{ backgroundColor: '#0E4DFB', justifyContent: 'center', alignItems: 'center' }}>
				<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 110, fontWeight: 800 }}>La scena rivelata</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const SceneA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const enter = interpolate(frame, [0, 0.8 * fps], [40, 0], { easing: EXPO, ...CLAMP });
	// Viva fino alla chiusura: un respiro di scala accompagna la scena per TUTTA la durata.
	const breathe = interpolate(frame, [0, (CUT + HOLD + BLOW) * fps], [1, 1.05], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014', justifyContent: 'center', alignItems: 'center', transform: 'scale(' + breathe + ')' }}>
			<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 96, fontWeight: 800, transform: 'translateY(' + enter + 'px)' }}>Prima</div>
		</AbsoluteFill>
	);
};

export default function MaskRevealTypeDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014' }}>
			<Sequence durationInFrames={Math.round((CUT + HOLD + BLOW) * fps)}>
				<SceneA />
			</Sequence>
			<Sequence from={Math.round(CUT * fps)}>
				<MaskedNext />
			</Sequence>
		</AbsoluteFill>
	);
}`;

const PUSH_ZOOM_PARALLAX_CODE = `// wow: PUSH_ZOOM_PARALLAX — push laterale con due layer a velocita' diverse: il taglio ha profondita'.
import React from 'react';
import { AbsoluteFill, Easing, Series, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const BEAT = 3;  // s per beat
const OV = 0.6;  // s di overlap (offset negativo): la finestra in cui entrambe si muovono

export const durationInFrames = Math.round((BEAT * 2 - OV) * fps);

// WHY due layer: il fg viaggia a piena larghezza, il bg a meno della meta' e scala leggermente —
// e' la differenza di velocita' che si legge come profondita', non la distanza percorsa.
const PushScene: React.FC<{ bg: string; label: string; enters: boolean; exitAt: number | null }> = ({ bg, label, enters, exitAt }) => {
	const frame = useCurrentFrame();
	const { fps, width } = useVideoConfig();
	const enterP = enters ? interpolate(frame, [0, OV * fps], [1, 0], { easing: EXPO, ...CLAMP }) : 0;
	const exitP = exitAt === null ? 0 : interpolate(frame, [exitAt * fps, (exitAt + OV) * fps], [0, 1], { easing: EXPO, ...CLAMP });
	const fgX = enterP * width - exitP * width;
	const bgX = enterP * width * 0.45 - exitP * width * 0.45;
	const push = 1 + exitP * 0.08; // il bg "spinge" leggermente verso la camera mentre esce
	return (
		<AbsoluteFill>
			<AbsoluteFill style={{ backgroundColor: bg, transform: 'translateX(' + bgX + 'px) scale(' + push + ')' }} />
			<AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', transform: 'translateX(' + fgX + 'px)' }}>
				<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 110, fontWeight: 800 }}>{label}</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

export default function PushZoomParallaxDemo() {
	const { fps } = useVideoConfig();
	return (
		<Series>
			<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
				<PushScene bg="#101014" label="Beat A" enters={false} exitAt={BEAT - OV} />
			</Series.Sequence>
			{/* L'offset negativo E' la transizione: la scena entrante scivola SOPRA quella che ancora si muove. */}
			<Series.Sequence offset={-Math.round(OV * fps)} durationInFrames={Math.round(BEAT * fps)}>
				<PushScene bg="#0E4DFB" label="Beat B" enters={true} exitAt={null} />
			</Series.Sequence>
		</Series>
	);
}`;

const WORD_SCROLL_TICKER_CODE = `// wow: WORD_SCROLL_TICKER — un nastro verticale di parole scorre dietro una riga fissa e si ferma su quella che conta. La scena non e' MAI ferma: il nastro respira anche dopo l'aggancio.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;
export const durationInFrames = Math.round(4.5 * fps);

const EXPO = ${MOTION_EXPO_IN_OUT};
const SETTLE = ${MOTION_OVERSHOOT_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// L'ultima parola e' quella vera: il nastro decelera ESATTAMENTE su di lei.
const WORDS = ['briefs', 'handoffs', 'approvals', 'meetings', 'agents'];
const ROW = 190; // altezza riga: la corsa del nastro e' aritmetica, non stima

export default function WordScrollTickerDemo() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// Corsa lunga con expo: parte piano, sfreccia, decelera sull'ultima riga.
	const travel = interpolate(frame, [0.2 * fps, 2.2 * fps], [0, -(WORDS.length - 1) * ROW], { easing: EXPO, ...CLAMP });
	// Dopo l'aggancio il nastro NON muore: micro-deriva + la parola agganciata si assesta.
	const drift = interpolate(frame, [2.2 * fps, 4.5 * fps], [0, -14], { easing: EXPO, ...CLAMP });
	const lock = interpolate(frame, [2.2 * fps, 2.5 * fps], [1.08, 1], { easing: SETTLE, ...CLAMP });
	const fixedRise = interpolate(frame, [0, 0.7 * fps], [40, 0], { easing: SETTLE, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014', fontFamily: 'Inter, sans-serif' }}>
			<div style={{ position: 'absolute', left: 100, top: 760, fontSize: 92, fontWeight: 800, color: '#9CA3AF', transform: 'translateY(' + fixedRise + 'px)' }}>No more</div>
			{/* La finestra del nastro: overflow hidden, una riga visibile, il resto scorre dietro. */}
			<div style={{ position: 'absolute', left: 100, top: 880, height: ROW, overflow: 'hidden' }}>
				<div style={{ transform: 'translateY(' + (travel + drift) + 'px)' }}>
					{WORDS.map((w, i) => (
						<div key={w} style={{ height: ROW, fontSize: 130, fontWeight: 800, color: i === WORDS.length - 1 ? '#0E4DFB' : '#fff', lineHeight: ROW + 'px', transform: i === WORDS.length - 1 ? 'scale(' + lock + ')' : undefined, transformOrigin: '0% 50%' }}>{w}</div>
					))}
				</div>
			</div>
		</AbsoluteFill>
	);
}`;

const WORD_ZOOM_CUT_CODE = `// wow: WORD_ZOOM_CUT — UNA parola del titolo zooma oltre la camera e la scena dopo e' gia' li' sotto: la parola E' la transizione.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const SETTLE = ${MOTION_OVERSHOOT_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const CUT = 2.6;  // s: quando la parola parte verso la camera
const BLOW = 0.7; // s: la corsa oltre la camera — l'overlap E' la transizione

export const durationInFrames = Math.round((CUT + BLOW + 2.7) * fps);

const SceneA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// WHY origin sulla parola: la camera entra DENTRO "fast", non nel centro geometrico della pagina.
	const zoom = interpolate(frame, [CUT * fps, (CUT + BLOW) * fps], [1, 16], { easing: EXPO, ...CLAMP });
	const fade = interpolate(frame, [(CUT + BLOW * 0.6) * fps, (CUT + BLOW) * fps], [1, 0], { easing: EXPO, ...CLAMP });
	const rise = interpolate(frame, [0, 0.8 * fps], [50, 0], { easing: SETTLE, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014', justifyContent: 'center', transform: 'scale(' + zoom + ')', transformOrigin: '31% 52%', opacity: fade }}>
			<div style={{ marginLeft: 110, fontFamily: 'Inter, sans-serif', fontWeight: 800, color: '#fff', fontSize: 110, lineHeight: 1.05, transform: 'translateY(' + rise + 'px)' }}>
				Ship <span style={{ color: '#0E4DFB' }}>fast</span>,<br />fix nothing.
			</div>
		</AbsoluteFill>
	);
};

const SceneB: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// B arriva gia' in movimento: si posa da 1.3 mentre A sta ancora esplodendo sopra di lei.
	const settle = interpolate(frame, [0, 0.8 * fps], [1.3, 1], { easing: EXPO, ...CLAMP });
	const rise = interpolate(frame, [0.3 * fps, 1.0 * fps], [60, 0], { easing: SETTLE, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB', justifyContent: 'center', alignItems: 'center', transform: 'scale(' + settle + ')', transformOrigin: '50% 48%' }}>
			<div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, color: '#fff', fontSize: 120, transform: 'translateY(' + rise + 'px)' }}>Fast, done right.</div>
		</AbsoluteFill>
	);
};

export default function WordZoomCutDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB' }}>
			{/* B monta SOTTO prima del taglio: quando la parola sfonda, la scena nuova e' gia' viva. */}
			<Sequence from={Math.round(CUT * fps)}>
				<SceneB />
			</Sequence>
			<Sequence durationInFrames={Math.round((CUT + BLOW) * fps)}>
				<SceneA />
			</Sequence>
		</AbsoluteFill>
	);
}`;

const SCENE_SHRINK_TO_DOT_CODE = `// wow: SCENE_SHRINK_TO_DOT — l'intera scena si rimpicciolisce fino a diventare un punto, e quel punto ATTERRA come elemento della scena dopo (il bullet della lista, il pallino del logo).
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const SETTLE = ${MOTION_OVERSHOOT_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const CUT = 2.8;     // s: fine del collasso di A
const SHRINK = 0.7;  // s: la scena si stringe a punto
const FLIGHT = 0.5;  // s: il punto vola alla sua posa in B
// Dove atterra il punto in B: il bullet della prima riga. Costanti note = volo aritmetico.
const DOT_X = 140;
const DOT_Y = 980;
const DOT_R = 14;

export const durationInFrames = Math.round((CUT + FLIGHT + 2.5) * fps);

const SceneA: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// L'intera pagina scala 1 -> 0.02 verso il punto di fuga: e' il contrario di FULL_CANVAS_SCALE.
	const shrink = interpolate(frame, [(CUT - SHRINK) * fps, CUT * fps], [1, 0.02], { easing: EXPO, ...CLAMP });
	const rise = interpolate(frame, [0, 0.8 * fps], [46, 0], { easing: SETTLE, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014', justifyContent: 'center', alignItems: 'center', transform: 'scale(' + shrink + ')', transformOrigin: '50% 46%', borderRadius: shrink < 0.9 ? 60 : 0, overflow: 'hidden' }}>
			<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 104, fontWeight: 800, transform: 'translateY(' + rise + 'px)' }}>Tutto questo</div>
		</AbsoluteFill>
	);
};

const SharedDot: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// LO STESSO punto, sopra entrambe le scene: prende il posto della scena collassata e vola alla posa in B.
	const x = interpolate(frame, [0, FLIGHT * fps], [width * 0.5, DOT_X], { easing: EXPO, ...CLAMP });
	const y = interpolate(frame, [0, FLIGHT * fps], [height * 0.46, DOT_Y], { easing: EXPO, ...CLAMP });
	const pop = interpolate(frame, [FLIGHT * 0.6 * fps, FLIGHT * fps], [1.5, 1], { easing: SETTLE, ...CLAMP });
	return (
		<div style={{ position: 'absolute', left: (x - DOT_R) + 'px', top: (y - DOT_R) + 'px', width: DOT_R * 2, height: DOT_R * 2, borderRadius: '50%', backgroundColor: '#fff', transform: 'scale(' + pop + ')' }} />
	);
};

const SceneB: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const show = interpolate(frame, [FLIGHT * fps, (FLIGHT + 0.5) * fps], [0, 1], { easing: EXPO, ...CLAMP });
	const slide = interpolate(frame, [FLIGHT * fps, (FLIGHT + 0.5) * fps], [40, 0], { easing: SETTLE, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB' }}>
			{/* Il testo si posa ACCANTO al punto atterrato: il bullet vero e' il SharedDot. */}
			<div style={{ position: 'absolute', left: DOT_X + DOT_R * 2 + 26, top: DOT_Y - 34, fontFamily: 'Inter, sans-serif', fontSize: 58, fontWeight: 700, color: '#fff', opacity: show, transform: 'translateX(' + slide + 'px)' }}>in un solo agente.</div>
		</AbsoluteFill>
	);
};

export default function SceneShrinkToDotDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#0E4DFB' }}>
			<Sequence from={Math.round(CUT * fps)}>
				<SceneB />
			</Sequence>
			<Sequence durationInFrames={Math.round(CUT * fps)}>
				<SceneA />
			</Sequence>
			<Sequence from={Math.round(CUT * fps)}>
				<SharedDot />
			</Sequence>
		</AbsoluteFill>
	);
}`;

const SLIDE_INERTIA_CODE = `// wow: SLIDE_INERTIA — slide laterale o verticale CON INERZIA: chi entra sfonda di qualche px e rientra, chi esce continua a muoversi per tutto l'overlap. Mai uno slide piatto.
import React from 'react';
import { AbsoluteFill, Easing, Series, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const SETTLE = ${MOTION_OVERSHOOT_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const BEAT = 2.6; // s per beat
const OV = 0.5;   // s di overlap: la finestra in cui ENTRAMBE le scene si muovono

export const durationInFrames = Math.round((BEAT * 2 - OV) * fps);

// axis 'x' = slide laterale, 'y' = verticale: stessa inerzia, altro asse.
const InertiaScene: React.FC<{ bg: string; label: string; axis: 'x' | 'y'; enters: boolean; exitAt: number | null }> = ({ bg, label, axis, enters, exitAt }) => {
	const frame = useCurrentFrame();
	const { fps, width, height } = useVideoConfig();
	const span = axis === 'x' ? width : height;
	// Entrata in due tempi: la corsa expo SFONDA di 26px oltre lo zero, il settle li restituisce.
	// e' l'inerzia — il pannello pesa, non si incolla.
	const travel = enters ? interpolate(frame, [0, OV * fps], [span, -26], { easing: EXPO, ...CLAMP }) : 0;
	const back = enters ? interpolate(frame, [OV * fps, (OV + 0.3) * fps], [0, 26], { easing: SETTLE, ...CLAMP }) : 0;
	// L'uscita NON si ferma mai: continua a scivolare via per tutto l'overlap, con una spinta di scala.
	const exitP = exitAt === null ? 0 : interpolate(frame, [exitAt * fps, (exitAt + OV) * fps], [0, 1], { easing: EXPO, ...CLAMP });
	const pos = travel + back - exitP * span * 0.35;
	const push = 1 + exitP * 0.06;
	const t = axis === 'x' ? 'translateX(' + pos + 'px)' : 'translateY(' + pos + 'px)';
	return (
		<AbsoluteFill style={{ backgroundColor: bg, justifyContent: 'center', alignItems: 'center', transform: t + ' scale(' + push + ')' }}>
			<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 108, fontWeight: 800 }}>{label}</div>
		</AbsoluteFill>
	);
};

export default function SlideInertiaDemo() {
	const { fps } = useVideoConfig();
	return (
		<Series>
			<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
				<InertiaScene bg="#101014" label="Beat A" axis="x" enters={false} exitAt={BEAT - OV} />
			</Series.Sequence>
			{/* L'offset negativo E' la transizione: B entra con l'inerzia SOPRA una A che ancora scivola. */}
			<Series.Sequence offset={-Math.round(OV * fps)} durationInFrames={Math.round(BEAT * fps)}>
				<InertiaScene bg="#0E4DFB" label="Beat B" axis="x" enters={true} exitAt={null} />
			</Series.Sequence>
		</Series>
	);
}`;

const SCRIM_PLATE_CODE = `// wow: SCRIM_PLATE — testo sopra una foto o un frame video: MAI nudo. Lo scrim entra CON il testo.
import React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;
export const durationInFrames = Math.round(4 * fps);

const EXPO = ${MOTION_EXPO_IN_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const PhotoBeat: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// Testo e scrim condividono la STESSA finestra e la stessa curva: un piatto che appare dopo
	// la sua riga e' due difetti, non uno.
	const show = interpolate(frame, [0.4 * fps, 1.0 * fps], [0, 1], { easing: EXPO, ...CLAMP });
	const rise = interpolate(frame, [0.4 * fps, 1.0 * fps], [36, 0], { easing: EXPO, ...CLAMP });
	// Ken Burns lento per TUTTO il beat: una foto ferma sotto testo fermo e' una slide, non un video.
	const kenburns = interpolate(frame, [0, 4 * fps], [1.06, 1.13], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill>
			{/* URL reale da read_media / generate_image — mai inventato. */}
			{/* SOSTITUISCI questa URL con quella che ti torna da read_media o generate_image. E' un'immagine
			    vera e non un segnaposto finto di proposito: fino al 22/8/2026 qui c'era
			    'https://example.com/replace-with-read_media-url.jpg', e questa era l'UNICA voce del
			    ricettario che non renderizzava — moriva con "Error loading image with src". Una ricetta
			    che non si puo' cuocere non si puo' verificare, e chi la copiava senza cambiare la riga
			    spediva un render fallito. */}
			<Img src="https://picsum.photos/id/1015/1080/1920" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(' + kenburns + ')' }} />
			{/* Variante 1 — BANDA GRADIENTE: ancora il testo al bordo basso, dove lo scrim e' pieno. */}
			<div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%', opacity: show, background: 'linear-gradient(180deg, rgba(8,8,12,0) 0%, rgba(8,8,12,0.72) 45%, rgba(8,8,12,0.9) 100%)' }} />
			<div style={{ position: 'absolute', left: 72, right: 72, bottom: 120, opacity: show, transform: 'translateY(' + rise + 'px)' }}>
				<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>Titolo leggibile</div>
				<div style={{ color: '#E5E7EB', fontFamily: 'Inter, sans-serif', fontSize: 40, marginTop: 16 }}>Sempre, su qualunque foto.</div>
			</div>
			{/* Variante 2 — PIATTO: per una label corta in un'area viva dell'immagine. Raggio fisso, non pill. */}
			<div style={{ position: 'absolute', left: 72, top: 160, padding: '14px 22px', borderRadius: 12, backgroundColor: 'rgba(10,10,14,0.78)', opacity: show }}>
				<div style={{ color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 34, fontWeight: 600 }}>Label sul piatto</div>
			</div>
		</AbsoluteFill>
	);
};

export default function ScrimPlateDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014' }}>
			{/* premountFor: l'immagine remota carica PRIMA del primo frame del beat. */}
			<Sequence premountFor={Math.round(0.5 * fps)} durationInFrames={Math.round(4 * fps)}>
				<PhotoBeat />
			</Sequence>
		</AbsoluteFill>
	);
}`;

const STAGGER_REVEAL_CODE = `// wow: STAGGER_REVEAL — N elementi entrano SFALSATI nel tempo, uno ogni STAG secondi; e chi e' gia' entrato NON si parcheggia: la deriva del gruppo copre il beat fino all'ultimo frame.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = ${MOTION_EXPO_IN_OUT};
const SETTLE = ${MOTION_OVERSHOOT_OUT};
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// La TECNICA viene dalla doc ufficiale Remotion (skills/remotion-best-practices: sequencing.md
// ritarda gli elementi, timing.md da' le curve): un'entrata ritardata si scrive spostando il clock.
// Qui il clock spostato — interpolate(frame - delay, ...) — e NON una <Sequence from> per elemento:
// l'elemento resta montato dal frame 0, quindi la deriva del gruppo lo muove anche prima e dopo la
// SUA entrata, e il beat non ha mai una coda ferma.
// I TEMPI invece sono i NOSTRI: i preset da UI (60fps.design e simili) stanno sotto i 700ms perche'
// descrivono la risposta al dito; un beat nostro dura 2.5-4s (craft specs) e la cascata si calibra
// su quella scala, non su quella di un tap.
const ITEMS = ['Scrive', 'Programma', 'Pubblica', 'Impara'];
const N = 4;      // tienilo = ITEMS.length: letterale perche' i gate risolvono numeri, non espressioni
const BEAT = 3.5; // s: durata del beat (dentro il range 2.5-4 delle craft specs)
const IN = 0.6;   // s: corsa d'entrata di UN elemento — si legge a scala beat, non a scala tap
// Lo sfalsamento fra un elemento e il successivo, IN FUNZIONE di N e della durata del beat:
// la cascata intera (ultima entrata conclusa) chiude entro meta' beat, l'altra meta' e' lettura
// -> (BEAT/2 - IN) / (N - 1). Cap 0.35s: oltre, il buco fra due entrate si legge come lag.
// Floor 0.15s: sotto (4-5 frame a 30fps) le entrate si fondono e lo sfalsamento sparisce —
// ed e' la stessa soglia sotto cui la QC non lo conta come meccanismo.
const STAG = Math.min(0.35, Math.max(0.15, (BEAT * 0.5 - IN) / (N - 1)));
const STAG_F = Math.round(STAG * fps);

export const durationInFrames = Math.round(BEAT * fps);

const Item: React.FC<{ label: string; index: number }> = ({ label, index }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const delay = index * STAG_F;
	// Le curve sono le NOSTRE: percorrenza expo in-out, overshoot SOLO sull'ultima posa (settle).
	const rise = interpolate(frame - delay, [0, IN * fps], [90, 0], { easing: EXPO, ...CLAMP });
	const show = interpolate(frame - delay, [0, IN * 0.6 * fps], [0, 1], { easing: EXPO, ...CLAMP });
	const settle = interpolate(frame - delay, [IN * fps, (IN + 0.25) * fps], [1.05, 1], { easing: SETTLE, ...CLAMP });
	return (
		<div style={{ opacity: show, transform: 'translateY(' + rise + 'px) scale(' + settle + ')', transformOrigin: '0% 50%', color: '#fff', fontFamily: 'Inter, sans-serif', fontSize: 96, fontWeight: 800, lineHeight: 1.35 }}>{label}</div>
	);
};

const StaggerBeat: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// La vita della coda: il GRUPPO deriva per TUTTO il beat, cosi' gli elementi gia' entrati non
	// restano immobili mentre gli altri arrivano — e' esattamente cio' che il rilevatore di stasi
	// legge negli input range. Togli questa riga e la coda del beat e' ferma: finish rifiutato.
	const drift = interpolate(frame, [0, BEAT * fps], [16, -16], { easing: EXPO, ...CLAMP });
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014', justifyContent: 'center', paddingLeft: 120 }}>
			<div style={{ transform: 'translateY(' + drift + 'px)' }}>
				{ITEMS.map((label, i) => (
					<Item key={label} label={label} index={i} />
				))}
			</div>
		</AbsoluteFill>
	);
};

export default function StaggerRevealDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: '#101014' }}>
			<Sequence durationInFrames={Math.round(BEAT * fps)}>
				<StaggerBeat />
			</Sequence>
		</AbsoluteFill>
	);
}`;

export const TRANSITIONS_COOKBOOK: readonly TransitionsCookbookEntry[] = [
	{
		name: 'FULL_CANVAS_SCALE',
		when: 'Quando il taglio deve avere impatto fisico: l\'intera pagina scala oltre la camera (o arriva enorme e si posa) e la scena nuova è già lì sotto.',
		code: FULL_CANVAS_SCALE_CODE,
		renders: true
	},
	{
		name: 'MATCH_CUT_DOT',
		when: 'Quando una scena può chiudersi in un punto e quel punto ha un posto tipografico nella scena dopo (il puntino di una i, un bullet, il pallino del logo).',
		code: MATCH_CUT_DOT_CODE,
		renders: true
	},
	{
		name: 'ELEMENT_CARRYOVER',
		when: 'Quando un numero, una parola o un\'immagine di una scena è il protagonista della successiva: sopravvive al taglio e si ricontestualizza.',
		code: ELEMENT_CARRYOVER_CODE,
		renders: true
	},
	{
		name: 'MASK_REVEAL_TYPE',
		when: 'Quando una parola sola merita di essere la porta della scena dopo: display type gigante come maschera, poi la maschera scala oltre la camera.',
		code: MASK_REVEAL_TYPE_CODE,
		renders: true
	},
	{
		name: 'PUSH_ZOOM_PARALLAX',
		when: 'Quando serve un cambio scena laterale che non sembri uno slide piatto: due layer a velocità diverse durante l\'overlap, e il taglio prende profondità.',
		code: PUSH_ZOOM_PARALLAX_CODE,
		renders: true
	},
	{
		name: 'WORD_SCROLL_TICKER',
		when: 'Quando una lista di parole È il contenuto del beat: un nastro verticale scorre dietro una riga fissa e decelera sulla parola che conta — la scena resta viva anche dopo l\'aggancio.',
		code: WORD_SCROLL_TICKER_CODE,
		renders: true
	},
	{
		name: 'WORD_ZOOM_CUT',
		when: 'Quando una parola del titolo merita di diventare la scena dopo: zooma oltre la camera (origin SULLA parola) e la scena nuova è già lì sotto.',
		code: WORD_ZOOM_CUT_CODE,
		renders: true
	},
	{
		name: 'SCENE_SHRINK_TO_DOT',
		when: 'Quando la scena può chiudersi rimpicciolendosi fino a un punto, e quel punto ha un posto nella scena dopo (un bullet, il pallino del logo, l\'inizio di una riga).',
		code: SCENE_SHRINK_TO_DOT_CODE,
		renders: true
	},
	{
		name: 'SLIDE_INERTIA',
		when: 'Ogni volta che il taglio resta uno slide laterale o verticale: l\'entrante sfonda di qualche px e rientra (inerzia), l\'uscente continua a muoversi per tutto l\'overlap. Mai slide() piatto.',
		code: SLIDE_INERTIA_CODE,
		renders: true
	},
	{
		name: 'STAGGER_REVEAL',
		when: 'Ogni volta che un GRUPPO di elementi (righe di una lista, card, badge) entra in un beat: mai tutti sullo stesso frame — uno ogni 0,15-0,35s (calcolato da quanti sono e da quanto dura il beat), e chi è già entrato continua a derivare fino alla fine.',
		code: STAGGER_REVEAL_CODE,
		renders: true
	},
	{
		name: 'SCRIM_PLATE',
		when: 'Ogni volta che del testo sta sopra una foto, un frame video o una texture viva: banda gradiente o piatto traslucido DIETRO il testo, animati insieme.',
		code: SCRIM_PLATE_CODE,
		// Misurato il 22/8/2026: era l'unica voce delle undici che NON renderizzava — il segnaposto
		// `https://example.com/replace-with-read_media-url.jpg` uccideva il render con «Error
		// loading image with src». Una ricetta che non si può cuocere è una ricetta che nessuno
		// può verificare, e che copiata alla lettera spedisce un render fallito. Sostituito con
		// un'immagine vera più il commento che dice di cambiarla: da lì 11/11 cuociono.
		renders: true
	}
];

/** Il blocco per il prompt dell'agente: nome, quando, e il codice intero da copiare e adattare. */
export const MOTION_TRANSITIONS_COOKBOOK_PROMPT = [
	`TRANSITIONS COOKBOOK — complete, compiling Remotion patterns (every one passes the compiler as-is). Copy the closest entry and adapt copy, palette and coordinates; keep its \`// wow:\` marker comment on the mechanism — QC reads the source and looks for the code shape behind it.`,
	...TRANSITIONS_COOKBOOK.map((e) => `### ${e.name} — ${e.when}\n\`\`\`tsx\n${e.code}\n\`\`\``)
].join('\n\n');

/* ------------------------------------------------------------------------------------------------
 * L'euristica per la QC: cosa c'è nel sorgente.
 * ---------------------------------------------------------------------------------------------- */

export type WowMechanisms = {
	/** Numero di beat: Series/TransitionSeries.Sequence, o <Sequence> se non ci sono serie. */
	beats: number;
	/** Una scala full-canvas (interpolate ≥2.5x dentro scale(), o una mask-size che esplode ≥1000%). */
	fullCanvasScale: boolean;
	/** Un match-cut / elemento condiviso (clip circle animato, o marker + volo left/top interpolato). */
	sharedElement: boolean;
	/** Uno sfalsamento VERO: marker + delay per-indice ≥ 0.15s che sposta il clock di una interpolate. */
	stagger: boolean;
};

type Traced = { name: string; outMax: number; outMin: number };

/** Le `const X = interpolate(...)` con il massimo (in modulo) del range di output. */
function tracedInterpolations(code: string): Traced[] {
	const out: Traced[] = [];
	for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*interpolate\s*\(/g)) {
		const open = m.index! + m[0].length - 1;
		let depth = 0;
		let close = -1;
		for (let i = open; i < code.length; i++) {
			if (code[i] === '(') depth++;
			else if (code[i] === ')') {
				depth--;
				if (depth === 0) {
					close = i;
					break;
				}
			}
		}
		if (close === -1) continue;
		const arrays = [...code.slice(open + 1, close).matchAll(/\[([^\][]*)\]/g)];
		if (arrays.length < 2) continue;
		// Il secondo array è l'output range. Solo i numeri letterali contano per l'ampiezza; un
		// output fatto di costanti resta tracciato (outMax 0) — serve al check posizionale.
		const nums = arrays[1][1]
			.split(',')
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isFinite(n));
		out.push({
			name: m[1],
			outMax: nums.length ? Math.max(...nums.map(Math.abs)) : 0,
			// Il minimo NON in modulo: serve al collasso-a-punto (scale 1 -> 0.02), dove conta
			// proprio "quanto vicino a zero arriva".
			outMin: nums.length ? Math.min(...nums) : 0
		});
	}
	return out;
}

/** `fn('NAME…` o `fn(${NAME…`: la variabile finisce dentro quella funzione CSS. */
function usedInCssFn(code: string, fn: string, name: string): boolean {
	return new RegExp(fn + String.raw`\((?:['"]\s*\+\s*|\$\{\s*)` + name + '\\b').test(code);
}

/**
 * Cosa il sorgente contiene dei meccanismi wow. Regex sul sorgente grezzo, non un AST —
 * ponytail: euristica dichiarata; i falsi qui non decidono da soli, il giudice vede anche gli
 * still e questa analisi gli arriva come indizio, non come verdetto. Se un giorno serve
 * precisione, il passo dopo è tracciare gli usi su sorgente senza stringhe/commenti.
 */
export function detectWowMechanisms(source: string): WowMechanisms {
	const count = (re: RegExp) => (source.match(re) ?? []).length;
	const seriesBeats = count(/<TransitionSeries\.Sequence\b/g) + count(/<Series\.Sequence\b/g);
	/**
	 * IL CONTEGGIO CHE SPEGNEVA IL CANCELLO.
	 *
	 * Sonda del 22/8/2026 sul trailer `c1b4fe72`: sei battute, e questo contatore ne vedeva ZERO —
	 * perché quel sorgente non usa `<Sequence>` di nessun tipo, ma guardie nominate sul frame
	 * (`const s2Active = frame >= 82 && frame < 172`). Il ricettario insegna le sequenze; il
	 * modello, quando scrive davvero, scrive i confronti. Risultato: la soglia «4+ battute» del
	 * giudice non si accendeva mai, e il sorgente portava cinque marcatori `// wow:` che nessuno
	 * verificava. Si contano quindi anche le guardie a due lati — la stessa forma che leggono
	 * `motionBeats` e `findStaticTails`.
	 */
	const gatedBeats = new Set(
		[...source.matchAll(
			/frame\s*(?:>=|>)\s*([\w$.]+)\s*&&\s*frame\s*(?:<=|<)\s*([\w$.]+)/g
		)].map((m) => `${m[1]}:${m[2]}`)
	).size;
	const beats = seriesBeats || count(/<Sequence\b/g) || gatedBeats;

	const traced = tracedInterpolations(source);
	const maskSize = (name: string) =>
		new RegExp(String.raw`MaskSize['"]?\s*:\s*[^,}\n]*\b` + name + '\\b').test(source) ||
		new RegExp(String.raw`maskSize['"]?\s*:\s*[^,}\n]*\b` + name + '\\b').test(source);
	const fullCanvasScale = traced.some(
		(t) =>
			(t.outMax >= 2.5 && usedInCssFn(source, 'scale', t.name)) ||
			// Il collasso-a-punto (SCENE_SHRINK_TO_DOT): la pagina intera scala da ~1 fino a quasi
			// zero. outMax >= 0.9 esclude un badge che pulsa 0.05 -> 0.08; e una scala "annacquata"
			// 1 -> 0.94 non passa da nessuna delle due porte.
			(t.outMin <= 0.08 && t.outMax >= 0.9 && usedInCssFn(source, 'scale', t.name)) ||
			(t.outMax >= 1000 && maskSize(t.name))
	);

	const circleCollapse = traced.some((t) => usedInCssFn(source, 'circle', t.name));
	// Il volo left/top da solo sarebbe indistinguibile da un cursore dentro un mockup: conta solo
	// insieme al marker del ricettario, che le craft specs impongono di conservare. E le variabili
	// con nome da cursore sono escluse comunque: il primo turno live ha marcato ELEMENT_CARRYOVER
	// su un beat il cui unico volo era cursorX/cursorY — il marker senza il meccanismo è esattamente
	// ciò che questo check esiste per rifiutare.
	const carryMarker = /wow:\s*(?:MATCH_CUT_DOT|ELEMENT_CARRYOVER|SCENE_SHRINK_TO_DOT)/.test(source);
	const positional = traced.some(
		(t) =>
			!/cursor|pointer|mouse|tap|click/i.test(t.name) &&
			new RegExp(String.raw`\b(?:left|top)\s*:\s*[^,}\n]*\b` + t.name + '\\b').test(source)
	);
	const sharedElement = circleCollapse || (carryMarker && positional);

	// STAGGER_REVEAL: il marker DA SOLO non vale niente (stessa regola del carry) — serve il codice
	// dietro: un ritardo per-indice (delay = index * STEP) che sposta il clock di una interpolate
	// (interpolate(frame - delay, ...)), con uno STEP risolvibile e ≥ 0.15s. Sotto quella soglia le
	// entrate si fondono in un blocco, e uno step 0 — tutti insieme — è esattamente l'imitazione
	// annacquata che questo check esiste per rifiutare.
	let stagger = false;
	if (/wow:\s*STAGGER_REVEAL/.test(source)) {
		const stripped = stripNonCode(source);
		const consts = collectConsts(stripped);
		const fps = consts.get('fps') ?? 30;
		const minStep = Math.round(0.15 * fps);
		for (const m of stripped.matchAll(
			/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:index|idx|i)\b\s*\*\s*([A-Za-z_$][\w$]*|[\d.]+)/g
		)) {
			const step = resolveNumber(m[2], consts);
			if (
				step != null &&
				step >= minStep &&
				new RegExp(String.raw`\binterpolate\s*\(\s*frame\s*-\s*` + m[1] + '\\b').test(stripped)
			) {
				stagger = true;
				break;
			}
		}
	}

	return { beats, fullCanvasScale, sharedElement, stagger };
}

/**
 * Mappa la descrizione libera di un meccanismo di transizione (dallo studio di una reference)
 * sul nome della voce del ricettario più vicina. Null quando nessuna calza — meglio niente che
 * un nome sbagliato che l'agente poi costruisce.
 */
export function cookbookNameForMechanism(desc: string): string | null {
	const d = desc.toLowerCase();
	// Il rimpicciolimento a scala viene PRIMA del match-cut a maschera: "shrink/rimpicciolisce"
	// è la ricetta a scala; "collapses into the dot/logo" resta il collasso a maschera circolare.
	if (/rimpicciol|shrink/.test(d)) return 'SCENE_SHRINK_TO_DOT';
	if (/ticker|nastro|scroll(?:ing|s)? (?:of )?(?:words?|parole|text)|parole che scorrono|word[- ]?roll/.test(d))
		return 'WORD_SCROLL_TICKER';
	if (/(?:parola|word)[^.]{0,40}(?:zoom|ingrandis|scala|diventa la scena|becomes the (?:next )?scene)|zooms? (?:in)?to (?:become|the next)/.test(d))
		return 'WORD_ZOOM_CUT';
	if (/inerzia|inertia|slide (?:con|with) (?:molla|spring|bounce|overshoot)/.test(d))
		return 'SLIDE_INERTIA';
	if (/stagger|sfalsat|cascata|cascad(?:e|ing)|one (?:after|by) (?:the )?(?:other|one)|uno dopo l'altro|uno alla volta|a catena/.test(d))
		return 'STAGGER_REVEAL';
	if (/collass|collaps|si chiude|diventa un punto|into a dot|into the logo|nel logo|puntino/.test(d))
		return 'MATCH_CUT_DOT';
	if (/morph|carr(?:y|ies|ied)|shared element|elemento condiviso|stesso elemento|sopravvive|becomes the (?:headline|title)|diventa il titolo/.test(d))
		return 'ELEMENT_CARRYOVER';
	if (/mask|maschera|through (?:the )?(?:type|text|letters?)|attraverso (?:il testo|le lettere)|knockout/.test(d))
		return 'MASK_REVEAL_TYPE';
	if (/parallax|profondit|depth|layers? at different|velocit[aà] divers/.test(d)) return 'PUSH_ZOOM_PARALLAX';
	if (/zoom|scal[ae]|push|oltre la camera|past the camera|ingrandis/.test(d)) return 'FULL_CANVAS_SCALE';
	return null;
}
