// wow: PUSH_ZOOM_PARALLAX — un muro di media a mattoni che scorre in continuo, e il ciclo si chiude.
//
// A COSA SERVE. È il template del "guarda quanti ne facciamo": prende N post già pubblicati e li
// mostra come superficie in movimento, non come galleria. Funziona con qualunque numero di
// immagini, e più ce ne sono meglio viene.
//
// UNA VOCE SOLA, CON DUE MANOPOLE — ed è una decisione, non una svista. C'erano due candidate,
// «griglia regolare inclinata che scorre» e «mosaico a mattoni dritto che scorre»: stesso
// meccanismo, stesso codice all'85%, due righe d'indice che nessuno saprebbe distinguere in una
// lettura sola. Sono diventate una: `TILT` decide se il muro è dritto (0) o obliquo (-12), e la
// dissezione decide il disegno. Due voci quasi identiche in libreria sono lo stesso difetto
// dell'indice lungo che nessuno legge, travestito da abbondanza.
//
// IL PEZZO DIFFICILE È UNO SOLO: IL CICLO SI DEVE CHIUDERE. Una deriva continua su un piano
// funziona solo se il piano è PIASTRELLABILE. Qui il modulo è una DISSEZIONE ESATTA di un
// rettangolo 4×7 unità: undici caselle che lo coprono tutto senza sovrapporsi né lasciare buchi
// (la verifica è nel commento sotto `MODULE`). Un modulo così si affianca a sé stesso in entrambe
// le direzioni, e la battuta del ciclo dura ESATTAMENTE il tempo che il piano impiega a
// percorrere l'altezza di un modulo: all'ultimo fotogramma la composizione è identica al primo.
// Se il ciclo non chiude, questa non è questa voce — è una carrellata che a un certo punto
// finisce, e si vede.
//
// LA CURVA QUASI LINEARE, e perché qui è giusta. Ovunque nel progetto la percorrenza è expo
// in-out: quasi ferma alle estremità, ripidissima in mezzo. Su un muro che scorre in continuo
// quella curva metterebbe una frenata e una ripartenza proprio sul punto di giunzione, cioè
// renderebbe visibile la cosa che il ciclo serve a nascondere. Quindi qui la bezier è quasi
// dritta: un piano che scorre non accelera. Resta un `easing` esplicito — mai `interpolate` senza,
// che in Remotion è lineare per default ed è il modo in cui il movimento piatto viene spedito
// senza che nessuno l'abbia deciso.
//
// LE FUGHE SONO UNA FRAZIONE DELLA TELA, non un numero a caso: 28 px su 1080 è il 2,6%. Sono
// spesse apposta — sono loro a far leggere il muro come muratura invece che come griglia.
//
// IL CONTENUTO ENTRA DA FUORI: nessun testo, nessuna tipografia, nessun badge. Una voce, un
// movimento. Le didascalie si prendono da `text/` e si montano sopra.
//
// UNA MOLLA NON HA IL CAMPO `easing` PERCHÉ NON LE SERVE: la fisica È l'easing.
import React from 'react';
import { AbsoluteFill, Easing, Img, Series, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1920;

// Quasi dritta: vedi sopra. Non copiarla altrove — fuori da un ciclo la curva giusta è l'expo.
const GLIDE = Easing.bezier(0.35, 0.06, 0.65, 0.94);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const GROUND = '#000000';
const U = 260;              // l'unità del modulo
const GUT = 28;             // la fuga: 2,6% della larghezza della tela
const MW = 4 * U;           // 1040
const MH = 7 * U;           // 1820 — anche la distanza percorsa in un ciclo
const COLS = 2;
const ROWS = 3;
const TILT = 0;             // 0 = muro dritto · -12 = muro obliquo

const ARRIVE = 1.2;         // s: le caselle compaiono
const LOOP = 7.5;           // s: un modulo intero di percorrenza

export const durationInFrames = Math.round(ARRIVE * fps) + Math.round(LOOP * fps);

/**
 * LA DISSEZIONE, in unità: [x, y, w, h] dentro un rettangolo 4 largo × 7 alto.
 *
 * Copertura verificata colonna per colonna, ed è la sola cosa che rende il piano piastrellabile:
 *   col 0 → y0-2 (0,0,2,3) · y3-4 (0,3,1,2) · y5-6 (0,5,3,2)
 *   col 1 → y0-2 (0,0,2,3) · y3 (1,3,3,1) · y4 (1,4,2,1) · y5-6 (0,5,3,2)
 *   col 2 → y0-1 (2,0,2,2) · y2 (2,2,1,1) · y3 (1,3,3,1) · y4 (1,4,2,1) · y5-6 (0,5,3,2)
 *   col 3 → y0-1 (2,0,2,2) · y2 (3,2,1,1) · y3 (1,3,3,1) · y4 (3,4,1,1) · y5 · y6
 * Nessun buco, nessuna sovrapposizione. Cambiare una casella senza rifare questo conto rompe il
 * ciclo, ed è l'unico modo di rompere questa voce.
 */
const MODULE: ReadonlyArray<readonly [number, number, number, number]> = [
	[0, 0, 2, 3],
	[2, 0, 2, 2],
	[2, 2, 1, 1],
	[3, 2, 1, 1],
	[0, 3, 1, 2],
	[1, 3, 3, 1],
	[1, 4, 2, 1],
	[3, 4, 1, 1],
	[0, 5, 3, 2],
	[3, 5, 1, 1],
	[3, 6, 1, 1]
];

// Immagini REMOTE, come nei post veri: il render gira con la rete aperta apposta. Una voce che
// funziona solo con un segnaposto locale non è una voce.
const IDS = [1015, 1016, 1024, 1025, 1035, 1043, 1050, 1059, 1069, 1074, 1080];
const src = (i: number) => 'https://picsum.photos/id/' + IDS[i % IDS.length] + '/700/700';

const Wall: React.FC<{ arriving: boolean; beat: number }> = ({ arriving, beat }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// LA PERCORRENZA: nella battuta del ciclo va da 0 a MH esatti — a fine battuta il piano è
	// tornato dov'era, perché il modulo si ripete ogni MH. Nella battuta d'arrivo il piano è già
	// fermo al punto di partenza del ciclo, e a muoversi sono le caselle.
	const travel = interpolate(frame, [0, beat * fps], arriving ? [0, 0] : [0, MH], {
		easing: GLIDE,
		...CLAMP
	});

	return (
		<AbsoluteFill style={{ backgroundColor: GROUND, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
			<div style={{ position: 'relative', width: 0, height: 0, transform: 'rotate(' + TILT + 'deg)' }}>
				{Array.from({ length: COLS * ROWS }, (_, m) => {
					const mx = (m % COLS) - (COLS - 1) / 2;
					const my = Math.floor(m / COLS) - (ROWS - 1) / 2;
					return MODULE.map(([cx, cy, cw, ch], k) => {
						// LA COMPARSA, su molla e sfalsata sulla diagonale del modulo: il muro non si
						// accende tutto insieme, si costruisce. Nella battuta del ciclo la molla è già
						// a riposo da un pezzo, quindi non tocca la chiusura.
						const delay = Math.round((k * 0.035 + (m % COLS) * 0.05) * fps);
						const pop = spring({ frame, fps, delay, from: 0.8, to: 1, config: { damping: 13, stiffness: 190, mass: 0.6 } });
						const ink = spring({ frame, fps, delay, from: 0, to: 1, config: { damping: 200, stiffness: 160, mass: 0.5 } });
						return (
							<div
								key={m + '-' + k}
								style={{
									position: 'absolute',
									left: mx * MW + cx * U - MW / 2 + GUT / 2,
									top: my * MH + cy * U - MH / 2 + GUT / 2 + travel,
									width: cw * U - GUT,
									height: ch * U - GUT,
									overflow: 'hidden',
									backgroundColor: '#15151B',
									opacity: arriving ? ink : 1,
									transform: arriving ? 'scale(' + pop + ')' : undefined
								}}
							>
								<Img
									// `objectFit: 'cover'` e mai `contain`: le caselle hanno proporzioni
									// diverse fra loro, quindi qualunque immagine arrivi va TAGLIATA per
									// riempire. `contain` qui produrrebbe le bande nere che i giudizi
									// chiamano "card letterboxed", su undici caselle per modulo.
									src={src(k + m * 3)}
									style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
								/>
							</div>
						);
					});
				})}
			</div>
		</AbsoluteFill>
	);
};

export default function MediaWallDemo() {
	const { fps } = useVideoConfig();
	// DUE BATTUTE, e la seconda è quella che si ripete. Per un muro infinito si monta SOLO la
	// seconda `<Series.Sequence>` in loop: comincia e finisce sullo stesso identico fotogramma.
	// La prima esiste perché una superficie che compare già intera non ha nessun arrivo — e
	// l'arrivo è l'unico punto di questa voce dove una molla ha qualcosa da fare.
	return (
		<AbsoluteFill style={{ backgroundColor: GROUND }}>
			<Series>
				<Series.Sequence durationInFrames={Math.round(ARRIVE * fps)}>
					<Wall arriving beat={ARRIVE} />
				</Series.Sequence>
				<Series.Sequence durationInFrames={Math.round(LOOP * fps)}>
					<Wall arriving={false} beat={LOOP} />
				</Series.Sequence>
			</Series>
		</AbsoluteFill>
	);
}
