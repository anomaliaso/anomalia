// wow: ELEMENT_CARRYOVER — la frase arriva intera e neutra, poi UNA parola scatta e si porta via
// il significato.
//
// PERCHÉ' ESISTE COME VOCE A SE'. Nelle review il difetto ricorrente non è "manca un'animazione":
// è "manca un hook". Un hook non è un effetto in più — è il fotogramma in cui chi guarda
// capisce di cosa si parla. Questo movimento è quel fotogramma: la frase si spegne di mezzo tono
// e una parola sola prende peso, scala e piastra. È la differenza fra decorare il testo e
// leggerlo ad alta voce.
//
// DIVERSO DA `2-word-by-word`, e vale la pena dirlo perché si somigliano da lontano: lì la
// frase si COSTRUISCE una parola alla volta e tutte pesano uguale; qui la frase c'è già e una
// parola sola SCATTA dopo. Se il contenuto è un elenco che cresce, è l'altra. Se il contenuto
// è una frase con dentro una parola che conta, è questa.
//
// LO SPEGNIMENTO NON PUÒ' SCENDERE SOTTO IL CONTRASTO. Le parole non accentate vanno al 72% di
// bianco, non al 40: sul carbone fanno ancora 9:1, cioè oltre il 4,5:1 del corpo. Una frase che
// per far risaltare una parola rende illeggibili le altre ha rotto la cosa che doveva servire.
//
// LO SCATTO È UNA MOLLA CON DAMPING BASSO. È l'unico posto della libreria dove il rimbalzo si
// deve VEDERE: damping 7 su stiffness 300 sfonda di circa il 12% e rientra in tre fotogrammi.
// Una molla non ha il campo `easing` perché non le serve — la fisica È l'easing, e il controllo
// del movimento lineare non si applica a lei.
import React from 'react';
import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const GROUND = '#0E0E11';
const INK = '#FFFFFF';
const DIM = 'rgba(255,255,255,0.72)';
const ACCENT = '#C8FF3D';

// Quattro righe a 224 px: la tipografia riempie 896 dei 1920 px. Nessuna didascalia, nessuna
// barra di avanzamento — chi copia la voce si porta via il movimento, non la demo.
//
// LA MISURA. Con 86 px di margine per lato restano 908 px di riga, e il sans bold occupa circa
// 0,45 × fontSize per carattere: la riga più lunga (12 caratteri più due spazi) decide il corpo.
// E va contata SULLA PAROLA CHE SCATTA: la piastra le aggiunge 44 px di padding e la molla la
// porta al 114%, quindi la riga dell'accento è la più larga di tutte anche quando non lo sembra.
const LINE_H = 224;
const SNAP = 1.6;   // s: quando scatta
const BEAT = 4.2;

export const durationInFrames = Math.round(BEAT * fps);

// Si va a capo dove l'interruzione porta un significato: due coppie, la seconda ribalta la prima.
// La parola che scatta chiude la sua riga — così lo scatto non spinge nulla e non riflue il testo.
const LINES: readonly (readonly string[])[] = [
	['Non', 'è', 'quello'],
	['che', 'scrivi.'],
	['È', 'quando'],
	['lo', 'pubblichi.']
];
const HIT_LINE = 2;
const HIT_WORD = 1;

const Sentence: React.FC = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const snapAt = Math.round(SNAP * fps);

	// L'ENTRATA, su molla: il blocco intero si posa. Neutro, senza gerarchia — ed è proprio
	// questo che rende lo scatto leggibile quando arriva.
	const enter = spring({ frame, fps, from: 84, to: 0, config: { damping: 14, stiffness: 130, mass: 0.7 } });
	const enterIn = spring({ frame, fps, from: 0, to: 1, config: { damping: 200, stiffness: 120, mass: 0.5 } });

	// LO SCATTO, tre molle sullo stesso istante con tre uscite diverse. Insieme fanno una cosa
	// sola: la parola diventa più grande, si alza, e si siede su una piastra.
	const hit = spring({ frame, fps, delay: snapAt, from: 1, to: 1.14, config: { damping: 7, stiffness: 300, mass: 0.5 } });
	const lift = spring({ frame, fps, delay: snapAt, from: 0, to: -16, config: { damping: 8, stiffness: 260, mass: 0.5 } });
	const plate = spring({ frame, fps, delay: snapAt, from: 0, to: 1, config: { damping: 12, stiffness: 220, mass: 0.5 } });
	const dim = spring({ frame, fps, delay: snapAt, from: 0, to: 1, config: { damping: 200, stiffness: 140, mass: 0.5 } });

	// La vita della battuta, dal primo all'ultimo fotogramma.
	const drift = interpolate(frame, [0, BEAT * fps], [22, -22], { easing: EXPO, ...CLAMP });
	const bleed = interpolate(frame, [0, BEAT * fps], [220, -280], { easing: EXPO, ...CLAMP });

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
			<div style={{ opacity: enterIn, transform: 'translateY(' + (enter + drift * 0.28) + 'px)' }}>
				{LINES.map((words, li) => (
					<div key={li} style={{ display: 'flex', gap: 26, height: LINE_H, alignItems: 'center' }}>
						{words.map((w, wi) => {
							const isHit = li === HIT_LINE && wi === HIT_WORD;
							return (
								<span
									key={w + wi}
									style={{
										position: 'relative',
										display: 'inline-block',
										padding: isHit ? '4px 22px' : 0,
										fontSize: 156,
										lineHeight: 1,
										fontWeight: isHit ? 900 : 700,
										letterSpacing: -8,
										color: isHit ? GROUND : dim > 0.5 ? DIM : INK,
										transformOrigin: '0% 62%',
										transform: isHit
											? 'translateY(' + (lift + drift * 0.12) + 'px) scale(' + hit + ')'
											: 'translateY(' + drift * 0.12 + 'px)'
									}}
								>
									{isHit ? (
										<span
											style={{
												position: 'absolute',
												inset: 0,
												backgroundColor: ACCENT,
												// Raggio FISSO in px, come vuole la specifica: 14 su un
												// elemento con 4 px di padding verticale. Mai 999 — una
												// parola in evidenza non è una pillola.
												borderRadius: 14,
												transform: 'scaleX(' + plate + ')',
												transformOrigin: '0% 50%'
											}}
										/>
									) : null}
									<span style={{ position: 'relative' }}>{w}</span>
								</span>
							);
						})}
					</div>
				))}
			</div>
		</AbsoluteFill>
	);
};

export default function AccentSnapDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: GROUND }}>
			<Series>
				<Series.Sequence durationInFrames={Math.round(BEAT * fps)}>
					<Sentence />
				</Series.Sequence>
			</Series>
		</AbsoluteFill>
	);
}
