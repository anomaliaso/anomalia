// wow: MASK_REVEAL_TYPE — ogni riga sale da DIETRO una maschera, una dopo l'altra.
//
// È il movimento editoriale classico, e risolve un difetto misurato che non è estetico: il
// testo che si scontra al centro. Se le righe arrivano una per volta da dietro il proprio taglio,
// non esiste il fotogramma in cui due blocchi si contendono lo stesso spazio — la lettura ha un
// ordine perché il movimento gliene ha dato uno.
//
// COME FUNZIONA LA MASCHERA, che è l'unico pezzo delicato: il contenitore della riga ha
// `overflow: hidden` e l'altezza esatta della riga; dentro, la riga si muove da +100% a 0. Non
// c'è nessun clip-path e nessuna misura di font — la maschera È la scatola.
//
// DUE BATTUTE, DUE <Series.Sequence>. La seconda non "continua" la prima: riparte da zero, perché
// dentro una Sequence `useCurrentFrame()` riparte da zero. È il motivo per cui questa forma va
// imparata prima delle guardie a mano sul fotogramma assoluto: una rifattorizzazione non la può
// rompere.
//
// IL SALTO DI FONDO È IL TAGLIO. Beat scuro, beat chiaro: le righe che risalgono da dietro la
// maschera coprono il cambio senza nessuna dissolvenza. E il fondo chiaro porta con se' la regola
// del contrasto — sul chiaro l'inchiostro è scuro e non esiste nessun accento colorato, perché
// il lime che sul carbone fa 16:1 sulla carta farebbe 1,04:1, cioè invisibile. Il colore giusto
// dipende dal fondo, sempre.
//
// UNA MOLLA NON HA IL CAMPO `easing` PERCHÉ' NON LE SERVE: la fisica È l'easing.
import React from 'react';
import { AbsoluteFill, Easing, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const GROUND = '#0E0E11';
const PAPER = '#F2EFEA';
const DARK_INK = '#111114';
const ACCENT = '#C8FF3D';

// L'altezza della scatola-maschera È l'altezza della riga, e sta di proposito sopra al corpo: la
// riga ha così una corsa più lunga da fare dietro il taglio. Quattro righe a 232 px riempiono
// 928 px dei 1920 della tela: la tipografia occupa la scena, non ci galleggia dentro.
const LINE_H = 232;
const STEP = 0.14;
const BEAT_A = 2.9;
const BEAT_B = 2.7;

export const durationInFrames = Math.round(BEAT_A * fps) + Math.round(BEAT_B * fps);

const MaskedLines: React.FC<{
	lines: readonly string[];
	ground: string;
	ink: string;
	accent: string | null;
	accentLine: number;
	beat: number;
}> = ({ lines, ground, ink, accent, accentLine, beat }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// La vita della battuta: parte al primo fotogramma, finisce all'ultimo. Senza, la coda è ferma.
	const drift = interpolate(frame, [0, beat * fps], [26, -26], { easing: EXPO, ...CLAMP });
	const bleed = interpolate(frame, [0, beat * fps], [-300, 240], { easing: EXPO, ...CLAMP });

	return (
		<AbsoluteFill
			style={{
				backgroundColor: ground,
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
					right: 0,
					top: 0,
					width: 14,
					height: 1920,
					backgroundColor: accent ?? ink,
					opacity: accent ? 1 : 0.16,
					transform: 'translateY(' + bleed + 'px)'
				}}
			/>
			<div style={{ transform: 'translateY(' + drift * 0.22 + 'px)' }}>
				{lines.map((line, i) => {
					const delay = Math.round(i * STEP * fps);
					// LA MOLLA È LA RIGA CHE SALE. Da +LINE_H (tutta fuori dalla maschera) a 0,
					// sfondando di poco: è quel poco che si legge come peso.
					const rise = spring({ frame, fps, delay, from: LINE_H, to: 0, config: { damping: 13, stiffness: 145, mass: 0.7 } });
					// La riga non si posa e basta: si allarga di un capello, come carta che si stende.
					const track = spring({ frame, fps, delay, from: -11, to: -5, config: { damping: 14, stiffness: 130, mass: 0.6 } });
					return (
						<div key={line} style={{ height: LINE_H, overflow: 'hidden' }}>
							<div
								style={{
									height: LINE_H,
									display: 'flex',
									alignItems: 'center',
									color: accent && i === accentLine ? accent : ink,
									fontSize: 142,
									fontWeight: 800,
									letterSpacing: track,
									transform: 'translateY(' + (rise + drift * 0.07 * (i + 1)) + 'px)'
								}}
							>
								{line}
							</div>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
};

export default function LineMaskRiseDemo() {
	const { fps } = useVideoConfig();
	return (
		<AbsoluteFill style={{ backgroundColor: GROUND }}>
			<Series>
				<Series.Sequence durationInFrames={Math.round(BEAT_A * fps)}>
					{/* Ogni riga è un'unità di senso: soggetto, oggetto, tempo, verdetto. */}
					<MaskedLines
						lines={['Scrivere', 'un post', 'ogni giorno', 'non scala.']}
						ground={GROUND}
						ink="#FFFFFF"
						accent={ACCENT}
						accentLine={3}
						beat={BEAT_A}
					/>
				</Series.Sequence>
				<Series.Sequence durationInFrames={Math.round(BEAT_B * fps)}>
					<MaskedLines
						lines={['Una settimana', 'in un colpo,', 'il lunedì,', 'poi si guarda.']}
						ground={PAPER}
						ink={DARK_INK}
						accent={null}
						accentLine={-1}
						beat={BEAT_B}
					/>
				</Series.Sequence>
			</Series>
		</AbsoluteFill>
	);
}
