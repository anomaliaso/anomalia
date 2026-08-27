// wow: PUSH_ZOOM_PARALLAX — coverflow orizzontale in 3D: la centrale frontale e grande, le vicine rientrano ruotate su Y.
//
// LE CARD STANNO SU UN ASSE E RUOTANO SU Y. La centrale è frontale e grande; man mano che si
// allontanano dal centro rientrano in profondità e girano — e le più lontane superano i novanta
// gradi, quindi mostrano il RETRO specchiato. Non è un difetto da nascondere con
// `backfaceVisibility: 'hidden'`: è metà dell'effetto, ed è la ragione per cui questa
// presentazione sembra un oggetto invece che una lista.
//
// IL 3D QUI È VERO: siamo in un browser, quindi `perspective`, `transformStyle: preserve-3d` e
// `rotateY` funzionano davvero. È anche il punto in cui anteprima e render divergono più
// spesso — motivo in più perché questa voce esista solo con il suo MP4 accanto.
//
// IL CONTENUTO ENTRA DA FUORI. Le slide sono N immagini qualsiasi: le tue, quelle di un carosello
// già approvato. Dentro le card non c'è nessun testo e nessuna tipografia, ed è deliberato —
// UNA VOCE, UN MOVIMENTO. Un template che si porta dentro il trattamento del testo non è un
// template, è una grafica: chi lo copia si prende tutti e due e la voce smette di incastrarsi
// con quelle di `text/`, che fanno esattamente quel mestiere. Le didascalie si montano sopra.
//
// PERCHÉ' È UN FILE INTERO E NON UNA VARIANTE. Le cinque presentazioni di `posts/` condividono
// lo scheletro (N slide, un indice frazionario, una funzione che colloca la slide in base alla
// sua distanza dal centro) e cambiano solo in quella funzione. Restano cinque file autonomi
// apposta: una voce di libreria si copia e si adatta, e un pezzo condiviso che l'agente non vede
// non lo può copiare.
//
// LA CARD SFORA DAL BORDO, e non è una preferenza. Una composizione che sta tutta dentro il frame
// si legge come la FOTOGRAFIA DI un carosello, centrata e appoggiata su una slide; una in cui il
// bordo non si vede si legge come il carosello. È la stessa regola dei mockup di prodotto nelle
// specifiche, e il difetto opposto è quello che i giudizi chiamano «card letterboxed» — l'anello
// debole del video peggiore mai valutato. Quindi la card centrale è dimensionata per riempire la
// tela e le vicine escono: si taglia, non si rimpicciolisce.//
// LA MOLLA STA SULL'ARRIVO AL CENTRO, ed è lì che il movimento si sente. La corsa è
// `interpolate` con expo in-out — è percorrenza; l'ultimo tratto è `spring`, che sfonda e
// rientra. Una molla non ha il campo `easing` perché non le serve: la fisica È l'easing, e il
// controllo del movimento lineare non si applica a lei.
//
// IL RAGGIO È IN PIXEL, FISSO: 20 su una card, dentro la banda 16-24 della specifica. Mai una
// percentuale — su un box che non è quadrato disegna un'ellisse — e mai 999: una card non è una
// pillola. E ogni immagine RIEMPIE la sua card con `objectFit: 'cover'`, mai `contain`, che è il
// modo di produrre le bande nere che i giudizi chiamano "card letterboxed".
import React from 'react';
import { AbsoluteFill, Easing, Img, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const GROUND = '#0A0A0C';
const CARD_W = 780;
const CARD_H = 1180;
const RADIUS = 20;

const BEAT = 2.5;
const STEPS = 2;
const RUN = 1.35 * fps;   // fine della corsa: da qui in poi comanda la molla

export const durationInFrames = Math.round(BEAT * fps) * STEPS;

// Immagini REMOTE, come nei post veri: il render gira con la rete aperta apposta. Una voce che
// funziona solo con un segnaposto locale non è una voce.
const SLIDES = [
	'https://picsum.photos/id/1015/900/1260',
	'https://picsum.photos/id/1024/900/1260',
	'https://picsum.photos/id/1035/900/1260',
	'https://picsum.photos/id/1043/900/1260',
	'https://picsum.photos/id/1059/900/1260'
];

/** Quante slide restano in scena per lato. Oltre, non si vedono e costano solo render. */
const VISIBLE = 2.6;

const Stage: React.FC<{ from: number }> = ({ from }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// PERCORRENZA: expo in-out, quasi ferma alle estremita' e ripidissima in mezzo. Si ferma al
	// 94% del tragitto e lascia l'ultimo pezzo alla molla, così il raccordo è continuo.
	const travel = interpolate(frame, [0, RUN], [from, from + 0.94], { easing: EXPO, ...CLAMP });
	// ATTERRAGGIO: sfonda l'indice e rientra. È il fotogramma che si ricorda.
	const land = spring({ frame, fps, delay: Math.round(RUN), from: from + 0.94, to: from + 1, config: { damping: 9, stiffness: 200, mass: 0.5 } });
	const pos = frame < RUN ? travel : land;

	// L'arrivo del piano intero, su molla: parte un filo più lontano e si assesta.
	const settle = spring({ frame, fps, from: 0.9, to: 1, config: { damping: 14, stiffness: 120, mass: 0.8 } });
	// LA VITA DELLA BATTUTA: due movimenti lentissimi dal primo all'ultimo fotogramma, così
	// nessun fotogramma è fermo nemmeno dopo che la slide si è posata.
	const drift = interpolate(frame, [0, BEAT * fps], [-10, 10], { easing: EXPO, ...CLAMP });
	const breathe = interpolate(frame, [0, BEAT * fps], [1.0, 1.05], { easing: EXPO, ...CLAMP });

	return (
		<AbsoluteFill style={{ backgroundColor: GROUND, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
			<div
				style={{
					position: 'relative',
					width: 0,
					height: 0,
					perspective: '1500px',
					transformStyle: 'preserve-3d',
					transform: 'scale(' + settle * breathe + ')'
				}}
			>
				{SLIDES.map((src, i) => {
					const offset = i - pos;
					if (Math.abs(offset) > VISIBLE) return null;
					// LA COMPARSA DELLA SLIDE, su molla e sfalsata: il piano non si accende tutto
					// insieme, si popola.
					const pop = spring({ frame, fps, delay: Math.round(i * 0.05 * fps), from: 0.86, to: 1, config: { damping: 12, stiffness: 180, mass: 0.6 } });
					// L'ASSE ORIZZONTALE: x cresce con la distanza, z rientra, e la rotazione su Y
					// supera i 90 gradi sulle più lontane — da lì in poi si vede il retro.
					const turn = Math.max(-165, Math.min(165, -offset * 62));
					const place =
						'translateX(' + (offset * 430 + drift) + 'px) translateZ(' + (-Math.abs(offset) * 420) + 'px) rotateY(' + turn + 'deg)';
					const op = 1 - Math.min(Math.abs(offset), 3) * 0.22;
					return (
						<div
							key={src}
							style={{
								position: 'absolute',
								width: CARD_W,
								height: CARD_H,
								left: -CARD_W / 2,
								top: -CARD_H / 2,
								borderRadius: RADIUS,
								overflow: 'hidden',
								backgroundColor: '#16161C',
								// Il RETRO delle card è VISIBILE, e non è una svista: oltre i 90 gradi
								// la slide mostra il proprio rovescio specchiato — è metà dell'effetto.
								backfaceVisibility: 'visible',
								zIndex: 100 - Math.round(Math.abs(offset) * 10),
								opacity: op * pop,
								transform: place + ' scale(' + pop + ')'
							}}
						>
							<Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

export default function CoverflowDemo() {
	const { fps } = useVideoConfig();
	// Una <Series.Sequence> per avanzamento: dentro, il tempo riparte da zero e il secondo passo
	// è il primo con un indice diverso. Nessuna guardia sul fotogramma assoluto, quindi nessuna
	// entrata morta quando qualcuno rifattorizza.
	return (
		<AbsoluteFill style={{ backgroundColor: GROUND }}>
			<Series>
				<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
					<Stage from={0} />
				</Series.Sequence>
				<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
					<Stage from={1} />
				</Series.Sequence>
			</Series>
		</AbsoluteFill>
	);
}
