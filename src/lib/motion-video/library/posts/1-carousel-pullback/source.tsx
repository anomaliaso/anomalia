// wow: FULL_CANVAS_SCALE — la slide indietreggia finché si vedono le vicine, scorre, e TORNA a
// riempire la viewport atterrando su una molla.
//
// A COSA SERVE DAVVERO. È il template che prende un CAROSELLO GIÀ' APPROVATO e lo fa muovere:
// stesse immagini, stesse didascalie, un video. È l'unica voce della libreria che parte da
// contenuto che qualcuno ha già deciso di spedire.
//
// IL LETTERBOX È IL DIFETTO DI QUESTA VOCE, e va guardato prima del resto. Le immagini di un
// carosello sono 4:5 o 1:1; la tela è 9:16. Chi le infila con `objectFit: 'contain'` ottiene le
// bande — ed è esattamente il difetto che i giudizi nominano ("card letterboxed") sul video
// peggiore mai valutato. La regola qui è una sola e non ha eccezioni: la CARD ha il rapporto
// della tela e l'immagine la RIEMPIE con `objectFit: 'cover'`. Si perde un pezzo di foto: è il
// prezzo giusto, la foto non è il soggetto, il post lo è.
//
// IL RAGGIO È IN PIXEL, FISSO. 28 su una card di questa taglia — la specifica dice 16-24 sulle
// card e questa è larga quanto la tela, quindi sta in cima alla banda. MAI una percentuale: su
// un box che non è quadrato una percentuale disegna un'ellisse, non un angolo arrotondato. E mai
// 999: una card non è una pillola.
//
// UNA VOCE, UN MOVIMENTO. Dentro le card non c'è nessun testo, e non è una dimenticanza: la
// prima versione aveva scrim, numero di slide e headline dentro ogni card, cioè un trattamento
// del testo appiccicato a un movimento di carosello. Chi copiava il carosello si prendeva anche
// quello. L'unica sovrimpressione rimasta è l'indicatore delle slide in alto, che non è testo
// del post: è la UI del carosello, cioè parte del meccanismo. Le didascalie si prendono da
// `text/` e si montano sopra.
//
// LA MOLLA STA SUL RITORNO A PIENO SCHERMO, ed è lì che il movimento si sente. La corsa
// (indietreggiare, scorrere) è `interpolate` con expo in-out: è percorrenza. L'atterraggio è
// `spring`: sfonda l'1,5% e rientra. Una molla non ha il campo `easing` perché non le serve —
// la fisica È l'easing, e il controllo del movimento lineare non si applica a lei.
import React from 'react';
import { AbsoluteFill, Easing, Img, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const GROUND = '#0B0B0F';
const ACCENT = '#C8FF3D';

const CARD_W = 1080;
const CARD_H = 1920;
const GAP = 48;
const PULL = 0.68;   // quanto indietreggia: sotto 0,72 le vicine si vedono per davvero
const RADIUS = 28;   // px, fisso

const BEAT = 2.9;
const STEPS = 2;     // quante volte scorre

export const durationInFrames = Math.round(BEAT * fps) * STEPS;

// Le immagini sono REMOTE, come lo sono nei post veri. Una voce che funziona con un segnaposto
// locale e muore su un URL vero non è una voce: il render gira con la rete aperta apposta.
const SLIDES = [
	{ src: 'https://picsum.photos/id/1015/1080/1920' },
	{ src: 'https://picsum.photos/id/1016/1080/1920' },
	{ src: 'https://picsum.photos/id/1024/1080/1920' }
] as const;

const Card: React.FC<{ src: string; active: boolean }> = ({ src, active }) => (
	<div
		style={{
			width: CARD_W,
			height: CARD_H,
			flex: '0 0 auto',
			borderRadius: RADIUS,
			overflow: 'hidden',
			backgroundColor: '#16161C',
			opacity: active ? 1 : 0.45
		}}
	>
		<Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
	</div>
);

/** Una passata: si indietreggia, si scorre di una slide, si torna a pieno schermo. */
const Step: React.FC<{ from: number }> = ({ from }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const OUT = 0.5 * fps;   // fine dell'indietreggiamento
	const RUN = 1.55 * fps;  // fine dello scorrimento
	const END = BEAT * fps;

	// PERCORRENZA: expo in-out. Quasi ferma alle estremita', ripidissima in mezzo.
	const pull = interpolate(frame, [0, OUT], [1, PULL], { easing: EXPO, ...CLAMP });
	const slot = interpolate(frame, [OUT, RUN], [from, from + 1], { easing: EXPO, ...CLAMP });
	// ATTERRAGGIO: la molla riporta a 1 sfondando di poco. È il fotogramma che si ricorda.
	const land = spring({ frame, fps, delay: Math.round(RUN), from: PULL, to: 1, config: { damping: 11, stiffness: 150, mass: 0.6 } });
	const scale = frame < RUN ? pull : land;

	// La card che arriva si alza di un capello quando si posa: seconda molla sullo stesso istante.
	const lift = spring({ frame, fps, delay: Math.round(RUN), from: 26, to: 0, config: { damping: 12, stiffness: 170, mass: 0.6 } });
	// Il pallino dell'indicatore si allunga sulla slide nuova.
	const dot = spring({ frame, fps, delay: Math.round(RUN), from: 0, to: 1, config: { damping: 13, stiffness: 200, mass: 0.5 } });
	// La targhetta in alto entra atterrando, all'inizio della passata.
	const tag = spring({ frame, fps, from: -70, to: 0, config: { damping: 13, stiffness: 150, mass: 0.6 } });

	// LA VITA: una deriva che va dal primo all'ultimo fotogramma della battuta, così anche dopo
	// l'atterraggio nessun fotogramma è fermo.
	const drift = interpolate(frame, [0, END], [10, -10], { easing: EXPO, ...CLAMP });
	const landed = Math.round(slot);

	return (
		<AbsoluteFill style={{ backgroundColor: GROUND, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
			<div
				style={{
					display: 'flex',
					gap: GAP,
					transform:
						'scale(' + scale + ') translateX(' + (-slot * (CARD_W + GAP)) + 'px) translateY(' + (lift + drift) + 'px)'
				}}
			>
				{SLIDES.map((s, i) => (
					<Card key={s.src} src={s.src} active={i === landed} />
				))}
			</div>
			<div
				style={{
					position: 'absolute',
					top: 96,
					left: 72,
					display: 'flex',
					gap: 12,
					transform: 'translateY(' + (tag + drift * 0.4) + 'px)'
				}}
			>
				{SLIDES.map((s, i) => (
					<div
						key={s.src}
						style={{
							height: 10,
							/* 999 solo qui, ed è l'unico posto legittimo: un tag alto 10px. */
							borderRadius: 999,
							backgroundColor: i === landed ? ACCENT : 'rgba(255,255,255,0.3)',
							width: i === landed ? 40 + 30 * dot : 40
						}}
					/>
				))}
			</div>
		</AbsoluteFill>
	);
};

export default function CarouselPullbackDemo() {
	const { fps } = useVideoConfig();
	// Una <Series.Sequence> per passata: dentro, il tempo riparte da zero e la seconda passata è
	// la prima con un indice diverso. Nessuna guardia sul fotogramma assoluto, quindi niente
	// entrate morte quando qualcuno rifattorizza.
	return (
		<AbsoluteFill style={{ backgroundColor: GROUND }}>
			<Series>
				<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
					<Step from={0} />
				</Series.Sequence>
				<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
					<Step from={1} />
				</Series.Sequence>
			</Series>
		</AbsoluteFill>
	);
}
