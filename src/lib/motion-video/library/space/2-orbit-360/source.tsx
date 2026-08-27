// wow: PUSH_ZOOM_PARALLAX — la camera gira di 360 gradi intorno a una nuvola di poster sospesi e
// TORNA ESATTAMENTE AL PUNTO DI PARTENZA. Il ciclo chiude per costruzione, e c'è un controllo che
// fa fallire il render se smette di chiudere.
//
// PERCHÉ UN'ORBITA È LA PROVA CHE IL VOLUME È VERO. Un attraversamento si può barare: basta
// ingrandire tutto insieme e sembra che ci si avvicini. Un'orbita no. Al primo grado di rotazione,
// se la lontananza fosse simulata rimpicciolendo le card, si vedrebbe che le card lontane e quelle
// vicine scorrono alla stessa velocità — e la nuvola collasserebbe su un piano. Qui ogni card ha
// una posizione vera in un volume e la sua dimensione sullo schermo è `FOCAL / distanza`: durante
// il giro le card davanti spazzano il fotogramma e quelle dietro quasi non si spostano, senza una
// riga che lo imponga.
//
// PERCHÉ LA PROIEZIONE A MANO E NON `preserve-3d` + `translate3d`. Il CSS 3D farebbe la stessa
// prospettiva con meno righe, ma su un'orbita ha tre problemi che questo file non ha: l'ordine in
// profondità lo deciderebbe il browser (e due card quasi complanari si scambiano di piano a
// fotogrammi alterni — proprio mentre l'ordine cambia di continuo, che è tutta la durata di
// un'orbita), le card che finiscono dietro l'obiettivo si ribalterebbero invece di sparire, e la
// nebbia per distanza andrebbe comunque calcolata a mano. Qui le card si ordinano per distanza a
// ogni fotogramma e si disegnano dalla più lontana alla più vicina: l'ordine sta nel DOM, quindi
// è identico in anteprima e in VM.
//
// LA CURVA STA SULLA CAMERA, NON SULLE CARD. Le card sono costanti: in tutto il file non hanno una
// sola animazione addosso. L'unica cosa interpolata è `camera(frame)`. Chi in futuro volesse
// "aggiungere vita" mettendo un'expo o una molla sulle card starebbe muovendo gli oggetti invece
// dell'osservatore, e la nuvola smetterebbe di essere un luogo.
//
// L'EXPO SU UN GIRO COMPLETO, e la conseguenza da conoscere. Con `Easing.bezier(0.87, 0, 0.13, 1)`
// il giro è quasi fermo alle due estremita' e violentissimo in mezzo. Due cose ne discendono:
//   - IL CICLO CHIUDE COMUNQUE, perché 2π ≡ 0: la posa finale è identica a quella iniziale. In
//     più arriva a velocità quasi nulla, quindi la giuntura del loop non è uno stacco ma una
//     camera che si ferma dove era partita. Un giro a velocità costante ripeterebbe senza pause
//     ma non sarebbe più expo, ed è l'expo che è stata chiesta.
//   - LA CAMERA SI ALLONTANA MENTRE FRUSTA. `R_eff = R + AMPIEZZA * (1 - cos φ) / 2` porta
//     l'obiettivo indietro di 700 unità nel punto più veloce e lo riporta dov'era ai due estremi.
//     Non è un vezzo: senza, nel tratto centrale una card vicina si sposta di più della propria
//     larghezza da un fotogramma all'altro, e a 30 fotogrammi al secondo senza sfocatura di
//     movimento quello non si legge come velocità — si legge come sfarfallio. E `(1 - cos φ)` vale
//     zero sia a 0 sia a 2π, quindi non rompe la chiusura.
//
// LA CASUALITA' È SEMINATA: `random(seed)` di Remotion, mai `Math.random()`. Il render distribuito
// valuta il corpo del modulo in più processi; con `Math.random()` ogni blocco di fotogrammi avrebbe
// una nuvola diversa e il video sfarfallerebbe. Sembra un problema di render, è una riga.
//
// LE CARD SONO SEGNAPOSTO, e sono FRONTALI. Nessuna tipografia e nessun dato cotti dentro: la voce
// è il movimento, il contenuto entra da fuori. E restano sempre rivolte all'obiettivo perché è
// così che stanno nel riferimento — poster appesi che ti guardano, nessuno visto di taglio.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, random, spring, useCurrentFrame } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1440;

// 10 secondi per un giro. Non è una durata scelta a gusto: è il minimo a cui l'expo in-out sta in
// piedi. Sotto gli otto secondi il tratto centrale sposta una card vicina di più della sua stessa
// altezza fra un fotogramma e l'altro e stroba; sopra i dodici le due estremita' quasi ferme
// smettono di essere pose e diventano un'attesa.
export const durationInFrames = 300;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const TAU = Math.PI * 2;

const GROUND = '#050506';
/** Lunghezza focale in pixel: un'altezza di mondo h a distanza d misura `h * FOCAL / d` px. */
const FOCAL = 1500;
const NEAR = 300;
const FOG_NEAR = 3000;
const FOG_FAR = 9000;

const TONES = ['#0E0E11', '#1B1B20', '#34343B', '#8C8C95', '#DEDCD5'];
const LABELS = ['#5C5C66', '#6F6F7A', '#9C9CA6', '#232328', '#37373D'];
/**
 * La distribuzione dei toni è PESATA, e il peso l'ha deciso il video, non il gusto: con i cinque
 * toni equiprobabili due card su cinque erano quasi nere, e su fondo nero sparivano. La nuvola
 * sembrava rada e il giro perdeva metà della parallasse, perché metà delle card non si vedeva.
 */
const TONE_MIX = [0, 1, 1, 2, 2, 3, 3, 3, 4, 4];

/** Raggio dell'orbita, e ampiezza dell'allontanamento nel tratto veloce. */
const R = 5600;
const R_SWING = 700;
/** Semiassi della nuvola. Orizzontale e profondo uguali, VERTICALE più lungo — vedi sotto. */
const RXZ = 1900;
const RY = 3000;

type Card = { x: number; y: number; z: number; w: number; h: number; tone: number };

// ─── IL VOLUME ────────────────────────────────────────────────────────────────
// Un ellissoide, non una scatola: da una scatola di lato 1900 lo spigolo dista 3290 dal centro, e a
// metà giro finirebbe dietro l'obiettivo. Con un ellissoide la distanza minima dalla camera vale
// `R_eff - RXZ` SEMPRE, da qualunque azimut — è il motivo per cui nessuna card di questo file può
// attraversare il piano vicino, mai, e non serve nessuna guardia sperata.
//
// PERCHÉ PIÙ ALTO CHE LARGO. L'asse dell'orbita è Y: allungare la nuvola in Y non cambia NULLA
// ruotando intorno, quindi è l'unico modo di riempire un fotogramma 3:4 senza rendere la
// composizione diversa a seconda di dove si è arrivati nel giro.
const CLOUD: Card[] = Array.from({ length: 88 }, (_, i) => {
	const r = (k: string) => random(`orb-${k}-${i}`);
	// Direzione uniforme sulla sfera (cos θ uniforme, non θ: senza, le card si ammucchiano ai poli),
	// poi raggio con cbrt per riempire il volume invece del guscio, e un vuoto al centro.
	const cos = r('c') * 2 - 1;
	const sin = Math.sqrt(1 - cos * cos);
	const a = r('a') * TAU;
	const rad = 0.42 + Math.cbrt(r('r')) * 0.58;
	const h = 340 + r('h') * 440;
	const asp = r('p') < 0.24 ? 1.34 : 0.7;
	return {
		x: Math.cos(a) * sin * rad * RXZ,
		y: cos * rad * RY,
		z: Math.sin(a) * sin * rad * RXZ,
		w: h * asp,
		h,
		tone: TONE_MIX[Math.floor(r('t') * TONE_MIX.length)]
	};
});

/**
 * LA CAMERA. Sta su un cerchio intorno all'origine e guarda sempre il centro; l'angolo φ è l'unica
 * variabile del file. Ogni termine qui dentro vale ZERO sia a φ=0 sia a φ=2π — è quella proprieta',
 * non la fortuna, che chiude il ciclo.
 */
function camera(frame: number) {
	const phi = interpolate(frame, [0, durationInFrames], [0, TAU], { easing: EXPO, ...CLAMP });
	// Allontanamento nel tratto veloce: 0 alle estremita', massimo a metà giro.
	const rEff = R + (R_SWING * (1 - Math.cos(phi))) / 2;
	// L'INVOLUCRO A MOLLA, e perché non rompe la chiusura del giro. `sin(phi)` vale ESATTAMENTE
	// zero sia a φ=0 sia a φ=2π: qualunque cosa lo moltiplichi vale zero anche lei, in quel punto,
	// indipendentemente da cosa sia. Quindi la salita-discesa e il roll possono "entrare in vita"
	// su una molla — invece di avere piena ampiezza fin dal primo fotogramma — senza spostare di
	// un pixel il confronto fotogramma-0-contro-giuntura che il controllo qui sotto fa. Due molle
	// specchiate, una che sale dall'inizio e una che scende verso la fine: l'oscillazione non parte
	// di scatto e non si ferma di scatto, il giro sì.
	const bobIn = spring({ frame, fps, config: { damping: 200, stiffness: 60, mass: 1 } });
	const bobOut = spring({ frame: durationInFrames - frame, fps, config: { damping: 200, stiffness: 60, mass: 1 } });
	const envelope = Math.min(bobIn, bobOut);
	// Salita e discesa nell'arco del giro: sin(0) = sin(2π) = 0.
	const y = Math.sin(phi) * 320 * envelope;
	// Roll: due gradi appena. Non si legge come rotazione, si legge come "qualcuno tiene la camera".
	const roll = Math.sin(phi) * 2 * envelope;
	// Posizione = centro - rEff * direzione di sguardo, così l'obiettivo punta sempre l'origine.
	return { x: -Math.sin(phi) * rEff, y, z: -Math.cos(phi) * rEff, phi, roll };
}

/** Proiezione di una card con una data camera. Screen x/y del centro, e fattore di scala. */
function project(c: Card, cam: ReturnType<typeof camera>) {
	const rx = c.x - cam.x;
	const ry = c.y - cam.y;
	const rz = c.z - cam.z;
	const cos = Math.cos(cam.phi);
	const sin = Math.sin(cam.phi);
	// Coordinate nella terna della camera: avanti = (sin φ, 0, cos φ), destra = (cos φ, 0, -sin φ).
	const camX = rx * cos - rz * sin;
	const camZ = rx * sin + rz * cos;
	const s = FOCAL / camZ;
	return { depth: camZ, s, x: width / 2 + camX * s, y: height / 2 + ry * s };
}

// ─── IL CONTROLLO CHE DEVE FALLIRE ────────────────────────────────────────────
// La disciplina è che il ciclo chiuda PER COSTRUZIONE e sia VERIFICATO da un controllo che
// fallisce, non che chiuda per fortuna. Gira al caricamento del modulo e fa fallire il render con
// un messaggio, non con uno stacco al loop che si nota al terzo video.
//
// SI CONFRONTA IL FOTOGRAMMA 0 CON IL FOTOGRAMMA `durationInFrames`, NON CON L'ULTIMO. È la
// stessa aritmetica di un mosaico che piastrella: il ciclo chiude ALLA durata, quindi l'ultimo
// fotogramma renderizzato (`durationInFrames - 1`) è quello immediatamente PRIMA della giuntura e
// il loop non ripete un fotogramma. Chi confrontasse 0 con `durationInFrames - 1` troverebbe una
// differenza e la "aggiusterebbe" rompendo proprio la cosa che stava controllando.
//
// E si confrontano le PROIEZIONI, non l'angolo: così il controllo fallisce anche se qualcuno
// aggiunge un movimento di camera nuovo che non torna a casa (una deriva laterale, un cambio di
// focale, un'inclinazione), non solo se sbaglia i 360 gradi.
(function assertClosedLoop() {
	const a = camera(0);
	const b = camera(durationInFrames);
	for (const c of CLOUD) {
		const pa = project(c, a);
		const pb = project(c, b);
		const off = Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y), Math.abs(pa.s - pb.s) * c.h);
		if (off > 0.5) throw new Error(`il giro non chiude: una card si sposta di ${off.toFixed(1)}px fra il primo fotogramma e la giuntura`);
	}
	if (Math.abs(a.roll - b.roll) > 0.01) throw new Error('il giro non chiude: il roll non torna al punto di partenza');
	// E la garanzia geometrica su cui si regge tutto il resto: nessuna card può attraversare il
	// piano vicino, da nessun azimut. Se qualcuno allarga la nuvola o stringe l'orbita, lo dice qui.
	if (R - R_SWING / 2 - RXZ <= NEAR) throw new Error('la nuvola tocca il piano vicino: allarga R o stringi RXZ');
})();

// UN'UNICA BATTUTA: il giro non ha una seconda scena da montare, ma resta dentro una <Sequence>
// comunque — dentro, `useCurrentFrame()` riparte da 0 per costruzione, e questa forma non dipende
// dal fatto che il componente sia montato alla radice della composizione.
function Orbit() {
	const frame = useCurrentFrame();
	const cam = camera(frame);

	// ALGORITMO DEL PITTORE, rifatto a ogni fotogramma perché qui l'ordine in profondità CAMBIA di
	// continuo: è esattamente ciò che un'orbita fa. 72 confronti per fotogramma, e in cambio zero
	// dipendenza da come il motore di rendering ordina i piani 3D.
	const drawn = CLOUD.map((c) => ({ c, p: project(c, cam) }))
		.filter((d) => d.p.depth > NEAR)
		.sort((a, b) => b.p.depth - a.p.depth);

	return (
		<AbsoluteFill style={{ backgroundColor: GROUND, overflow: 'hidden' }}>
			<div style={{ position: 'absolute', inset: 0, transform: `rotate(${cam.roll}deg)` }}>
				{drawn.map(({ c, p }, i) => {
					const cw = c.w * p.s;
					const ch = c.h * p.s;
					const fog = interpolate(p.depth, [FOG_NEAR, FOG_FAR], [1, 0.58], { easing: EXPO, ...CLAMP });
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: p.x - cw / 2,
								top: p.y - ch / 2,
								width: cw,
								height: ch,
								backgroundColor: TONES[c.tone],
								opacity: fog,
								// Senza il filo di bordo le stampe scure spariscono nel nero e la nuvola
								// perde metà delle sue card proprio dove dovrebbe essere fitta.
								boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}}
						>
							{cw >= 460 ? (
								<div
									style={{
										display: 'flex',
										fontFamily: 'ui-monospace, Menlo, monospace',
										fontSize: Math.min(cw * 0.075, 30),
										letterSpacing: '0.14em',
										color: LABELS[c.tone]
									}}
								>
									(ADD MEDIA)
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
}

export default function Orbit360Demo() {
	return (
		<Sequence durationInFrames={durationInFrames}>
			<Orbit />
		</Sequence>
	);
}
