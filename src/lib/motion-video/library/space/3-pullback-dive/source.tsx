// wow: FULL_CANVAS_SCALE — andata e ritorno: la camera si strappa indietro finché la nuvola intera
// sta in un fotogramma, si posa, e poi rientra fino a fermarsi su UNA card sola.
//
// LE DUE METÀ HANNO CURVE DIVERSE, ED È TUTTA LA VOCE. Un allontanamento e un ritorno con la
// stessa curva sono un rimbalzo: si vede che è lo stesso gesto riavvolto, e la seconda metà non
// dice niente che la prima non abbia già detto. Qui le due metà hanno carattere opposto, e la
// differenza sta nella curva, non nella durata:
//   - USCITA `Easing.bezier(0.16, 1, 0.3, 1)` — expo OUT. Parte di scatto e decelera lunghissima:
//     lo strappo è subito, poi la nuvola si compone e si posa davanti a chi guarda. È la rivelazione,
//     e la sua coda lenta È la posa larga: non c'è nessuna pausa scritta a mano, c'è la fine di
//     una curva che ci mette un secondo e mezzo a percorrere l'ultimo 6% del tragitto.
//   - RIENTRO `Easing.bezier(0.7, 0, 0.84, 0)` — expo IN. L'esatto contrario: striscia via dalla
//     posa larga quasi senza muoversi e poi accelera fino in fondo. È l'affondo.
// Sono le due metà della stessa expo del progetto (`0.87, 0, 0.13, 1`) prese separate. Chi in
// futuro "uniformasse" i due tratti alla curva simmetrica otterrebbe esattamente il rimbalzo da cui
// questa voce si distingue.
//
// LA CURVA STA SULLA CAMERA, NON SULLE CARD. Le card sono costanti: non hanno una sola animazione
// addosso, in tutto il file. L'unica cosa interpolata è `camera(frame)`. È quello che rende il
// movimento spaziale invece di un mucchio di animazioni sincronizzate — se qualcuno mettesse
// un'expo sulle card starebbe muovendo gli oggetti invece dell'osservatore.
//
// LA PROFONDITÀ STA NELLA Z, NON NELLA SCALA. Ogni card ha una posizione vera in un volume e la sua
// dimensione sullo schermo è `FOCAL / distanza`, mai un numero scritto. Su questa voce si vede
// meglio che sulle altre: allontanandosi, le card vicine rimpiccioliscono in fretta e quelle lontane
// quasi per niente, e la nuvola si CHIUDE su se stessa invece di scalare in blocco. Se la lontananza
// fosse simulata con una scala, allontanarsi sarebbe indistinguibile da uno zoom indietro.
//
// PERCHÉ LA PROIEZIONE A MANO E NON `preserve-3d` + `translate3d`. L'ordine in profondità qui sta
// nel DOM (algoritmo del pittore) invece che nelle mani del browser, quindi due card quasi
// complanari non si scambiano di piano a fotogrammi alterni; una card che finisce dietro
// l'obiettivo sparisce invece di ribaltarsi — e su una voce che ATTRAVERSA la nuvola durante
// l'affondo succede a una decina di card; e la nebbia per distanza andrebbe comunque calcolata a
// mano. Dodici righe di algebra in cambio di zero dipendenza da come il motore implementa il 3D.
//
// LA CASUALITA' È SEMINATA: `random(seed)` di Remotion, mai `Math.random()`. Il render distribuito
// valuta il corpo del modulo in più processi; con `Math.random()` ogni blocco di fotogrammi avrebbe
// una nuvola diversa e il video sfarfallerebbe. Sembra un problema di render, è una riga.
//
// LE CARD SONO SEGNAPOSTO: nessuna tipografia, nessun dato, nessuna didascalia cotta dentro. La voce
// è il movimento, il contenuto entra da fuori.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1440;

// 6 secondi, e sono divisi 2.8 + 2.8 + 0.4. Le due metà durano UGUALE apposta: è l'unico modo di
// rendere evidente che a cambiare è la curva e non il tempo. Sotto i cinque secondi la coda lenta
// dell'uscita non fa in tempo a diventare una posa e l'andata-e-ritorno si legge come un singolo
// scossone.
export const durationInFrames = 180;

/** Expo OUT: parte di scatto, decelera lunghissima. L'uscita. */
const EXPO_OUT = Easing.bezier(0.16, 1, 0.3, 1);
/** Expo IN: striscia via e poi accelera fino in fondo. Il rientro. */
const EXPO_IN = Easing.bezier(0.7, 0, 0.84, 0);
/** L'expo in-out del progetto, per il roll che attraversa tutto. */
const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const GROUND = '#050506';
/** Lunghezza focale in pixel: un'altezza di mondo h a distanza d misura `h * FOCAL / d` px. */
const FOCAL = 1500;
const NEAR = 300;
const FOG_FAR = 17000;

const TONES = ['#0E0E11', '#1B1B20', '#34343B', '#8C8C95', '#DEDCD5'];
const LABELS = ['#5C5C66', '#6F6F7A', '#9C9CA6', '#232328', '#37373D'];
/**
 * La distribuzione dei toni è PESATA, e il peso l'ha deciso il video, non il gusto: con i cinque
 * toni equiprobabili due card su cinque erano quasi nere, e su fondo nero sparivano. La posa larga
 * — che è tutta la ragione dell'andata — mostrava una nuvola con un terzo dei buchi.
 */
const TONE_MIX = [0, 1, 1, 2, 2, 3, 3, 3, 4, 4];

type Card = { x: number; y: number; z: number; w: number; h: number; tone: number };

/** La card su cui l'affondo si ferma: dead-centre alla fine, come nel terzo riferimento. */
const HERO: Card = { x: -180, y: 120, z: 3050, w: 660, h: 950, tone: 4 };

// ─── IL VOLUME È SCHIACCIATO IN PROFONDITÀ, E QUESTO È IL VINCOLO DELLA VOCE ───
// La posa larga deve CONTENERE la nuvola intera. Una nuvola profonda non ci sta, e non è questione
// di allontanarsi di più: se le card più vicine distano 3000 e le più lontane 9000, le prime si
// proiettano tre volte più larghe delle seconde, quindi o si perdono le vicine fuori dal
// fotogramma o le lontane diventano un grumo al centro. L'unica via è appiattire il volume — 5000
// unità di profondità contro 4200 di larghezza — e allontanarsi quel tanto che basta. La prima
// versione andava a 13200 e la nuvola finiva grande come una moneta in mezzo al nero: il render
// l'ha detto subito, il controllo qui sotto adesso lo dice prima.
//
// LA SEZIONE È UN RETTANGOLO, NON UN'ELLISSE, e anche questo l'ha deciso un render: con una
// sezione ellittica la posa larga mostra un GRUMO di coriandoli con quattro angoli neri, perché
// un'ellisse inscritta in un 3:4 lascia fuori gli angoli. Un rettangolo con un buco rettangolare
// in mezzo li riempie. Il buco è il corridoio libero: senza, durante il rientro una card
// capiterebbe esattamente sull'obiettivo e spazzerebbe il fotogramma in due fotogrammi. Si
// campiona in un quadrato e i punti che cadono nel buco si spingono fuori lungo il loro stesso
// raggio (metrica di Chebyshev, cioè "quadrati concentrici"), così il bordo del buco resta netto
// e la densità fuori resta uniforme.
//
// E LA NUVOLA FINISCE PRIMA DELLA CARD FRONTALE (z ≤ 1400 contro 3050). Non è un caso: alla fine
// dell'affondo la camera sta a 1800, quindi ogni card della nuvola è già dietro l'obiettivo e la
// posa finale la compongono soltanto la card frontale e le sue compagne. È l'unico modo di
// garantire che niente le passi davanti senza inventare regole di distanza minima che poi vanno
// verificate a mano.
const CLOUD: Card[] = Array.from({ length: 150 }, (_, i) => {
	const r = (k: string) => random(`dive-${k}-${i}`);
	const z = -1500 + r('z') * 2900;
	let ux = r('x') * 2 - 1;
	let uy = r('y') * 2 - 1;
	const m = Math.max(Math.abs(ux), Math.abs(uy), 1e-4);
	if (m < 0.16) {
		ux *= 0.16 / m;
		uy *= 0.16 / m;
	}
	const h = 300 + r('h') * 420;
	const asp = r('p') < 0.24 ? 1.34 : 0.7;
	return {
		x: HERO.x + ux * 1650,
		y: HERO.y + uy * 2550,
		z,
		w: h * asp,
		h,
		tone: TONE_MIX[Math.floor(r('t') * TONE_MIX.length)]
	};
});

const Z_START = -3400;
const Z_WIDE = -8000;
const Z_END = 1800; // distanza dalla card frontale = 1250 -> alta 1140px su una tela da 1440

// ─── LE COMPAGNE DELLA POSA FINALE ────────────────────────────────────────────
// Senza queste, l'affondo finisce su una card sola in mezzo al nero: corretto rispetto alla
// promessa, e piatto da guardare. Nel riferimento intorno al poster centrale ce ne sono altri,
// tagliati dai bordi. Queste nove card si dispongono AL CONTRARIO delle altre: si scelgono la
// profondità e lo scostamento IN PIXEL nella posa finale, e da lì si ricavano le coordinate di
// mondo. Durante l'allontanamento sono card come tutte le altre, in fondo alla nuvola.
//
// Stanno nelle bande laterali e non sopra o sotto perché la card frontale è alta 1140px su una tela
// da 1440: sopra e sotto non c'è spazio, ai lati sì. Il `Math.max` garantisce che nessuna invada il
// poster centrale, e 452 è la sua semi-larghezza IN PIXEL più il margine — non 330, che è la stessa
// grandezza in unità di mondo. Due numeri omogenei solo all'apparenza, ed è l'errore che il
// controllo qui sotto ha già intercettato una volta sulla voce sorella.
const COMPANIONS: Card[] = Array.from({ length: 9 }, (_, i) => {
	const r = (k: string) => random(`divec-${k}-${i}`);
	const depth = 780 + r('d') * 2100;
	const sh = 300 + r('s') * 620; // altezza in pixel nella posa finale
	const asp = r('p') < 0.3 ? 1.3 : 0.72;
	const halfW = (sh * asp) / 2;
	const off = Math.max(400 + r('o') * 430, 452 + halfW);
	const side = i % 2 ? 1 : -1;
	return {
		x: HERO.x + (side * off * depth) / FOCAL,
		y: HERO.y + ((r('y') - 0.5) * 1750 * depth) / FOCAL,
		z: Z_END + depth,
		w: (sh * asp * depth) / FOCAL,
		h: (sh * depth) / FOCAL,
		tone: TONE_MIX[Math.floor(r('t') * TONE_MIX.length)]
	};
});

// La camera si muove solo lungo Z (nessuna rotazione di sguardo), quindi l'ordine in profondità non
// cambia mai: si ordina una volta sola, qui, e nel componente non c'è nessun sort per fotogramma.
const SORTED: Card[] = [...CLOUD, ...COMPANIONS, HERO].sort((a, b) => b.z - a.z);
const LEG = Math.round(durationInFrames * 0.467); // 84: le due metà durano uguale
const RUN_END = LEG * 2; // 168: da qui in poi comanda la molla

/**
 * LA CAMERA, l'unica cosa animata del file. Due tratti con due curve opposte, un atterraggio a
 * molla, e un roll che attraversa tutto.
 */
function camera(frame: number, f: number) {
	// USCITA — expo OUT. Strappo immediato, poi una coda lunghissima: la coda È la posa larga.
	const out = interpolate(frame, [0, LEG], [Z_START, Z_WIDE], { easing: EXPO_OUT, ...CLAMP });
	// RIENTRO — expo IN. Striscia via dalla posa larga e poi accelera. Si ferma al 94% e lascia
	// l'ultimo tratto alla molla, così il raccordo è continuo.
	const back = interpolate(frame, [LEG, RUN_END], [Z_WIDE, Z_WIDE + (Z_END - Z_WIDE) * 0.94], { easing: EXPO_IN, ...CLAMP });
	// ATTERRAGGIO: sfonda di poco e rientra. Una molla non ha il campo `easing` perché non le
	// serve: la fisica È l'easing.
	const land = spring({ frame, fps: f, delay: RUN_END, from: Z_WIDE + (Z_END - Z_WIDE) * 0.94, to: Z_END, config: { damping: 11, stiffness: 150, mass: 0.7 } });
	const z = frame < LEG ? out : frame < RUN_END ? back : land;

	// LA TRASLAZIONE LATERALE segue le stesse due curve, ma con AMPIEZZE diverse: l'uscita scivola
	// via di lato (si sta lasciando qualcosa), il rientro punta la card frontale. Si ferma anche lei
	// al 94% e lascia l'ultimo tratto alla molla — la STESSA molla della Z, non una copia: se solo
	// la profondità atterra fisicamente e il laterale si limita a smettere, l'arrivo si sente
	// spaccato in due camere invece che in una sola che si posa su tre assi insieme.
	const xOut = interpolate(frame, [0, LEG], [HERO.x + 300, HERO.x - 120], { easing: EXPO_OUT, ...CLAMP });
	const xBack = interpolate(frame, [LEG, RUN_END], [HERO.x - 120, HERO.x - 120 + 120 * 0.94], {
		easing: EXPO_IN,
		...CLAMP
	});
	const landX = spring({
		frame,
		fps: f,
		delay: RUN_END,
		from: HERO.x - 120 + 120 * 0.94,
		to: HERO.x,
		config: { damping: 11, stiffness: 150, mass: 0.7 }
	});
	const yOut = interpolate(frame, [0, LEG], [HERO.y - 220, HERO.y + 90], { easing: EXPO_OUT, ...CLAMP });
	const yBack = interpolate(frame, [LEG, RUN_END], [HERO.y + 90, HERO.y + 90 - 90 * 0.94], {
		easing: EXPO_IN,
		...CLAMP
	});
	const landY = spring({
		frame,
		fps: f,
		delay: RUN_END,
		from: HERO.y + 90 - 90 * 0.94,
		to: HERO.y,
		config: { damping: 11, stiffness: 150, mass: 0.7 }
	});

	// IL ROLL ATTRAVERSA TUTTO, e non è decorazione: l'expo IN-OUT è più veloce a METÀ durata,
	// cioè esattamente dove la coda dell'uscita ha quasi smesso di muoversi e il rientro non ha
	// ancora cominciato. È cio' che tiene vivo il fotogramma nella posa larga senza scrivere una
	// pausa e poi doverla riempire.
	const roll = interpolate(frame, [0, durationInFrames], [2.6, -1.4], { easing: EXPO, ...CLAMP });

	return {
		x: frame < LEG ? xOut : frame < RUN_END ? xBack : landX,
		y: frame < LEG ? yOut : frame < RUN_END ? yBack : landY,
		z,
		roll
	};
}

// ─── IL CONTROLLO CHE DEVE FALLIRE ────────────────────────────────────────────
// Gira al caricamento del modulo e fa fallire il render con un messaggio, non con un fotogramma
// sbagliato che si nota al terzo video. Verifica le tre cose che questa voce PROMETTE.
(function assertJourney() {
	// 1. Il raccordo fra le due curve è continuo: se qualcuno ritocca una sola delle due metà, qui
	//    si apre uno stacco di decine di unità e il video ha un salto a metà.
	const gap = Math.abs(camera(LEG - 1, fps).z - camera(LEG, fps).z);
	if (gap > 40) throw new Error(`le due metà non si raccordano: salto di ${Math.round(gap)} unità al fotogramma ${LEG}`);
	// 2. La posa larga mostra la NUVOLA INTERA — che è l'unica ragione per cui esiste l'andata — e
	//    la mostra GRANDE. Le due metà del controllo servono contro due errori opposti, e il
	//    secondo è quello in cui questa voce è già caduta una volta: allontanarsi troppo passa
	//    qualunque verifica di "sta tutto dentro" e produce una nuvola grande come una moneta in
	//    mezzo a un fotogramma nero.
	const wide = camera(LEG, fps);
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const c of SORTED) {
		const d = c.z - wide.z;
		if (d <= NEAR) throw new Error("la posa larga ha una card dietro l'obiettivo");
		const s = FOCAL / d;
		minX = Math.min(minX, width / 2 + (c.x - wide.x) * s - (c.w * s) / 2);
		maxX = Math.max(maxX, width / 2 + (c.x - wide.x) * s + (c.w * s) / 2);
		minY = Math.min(minY, height / 2 + (c.y - wide.y) * s - (c.h * s) / 2);
		maxY = Math.max(maxY, height / 2 + (c.y - wide.y) * s + (c.h * s) / 2);
	}
	if (minX < -40 || maxX > width + 40 || minY < -40 || maxY > height + 40)
		throw new Error(`la posa larga taglia la nuvola: ingombro ${Math.round(minX)},${Math.round(minY)} -> ${Math.round(maxX)},${Math.round(maxY)}`);
		// Le due frazioni sono un PAVIMENTO, non un obiettivo: servono a cogliere la posa larga
	// troppo lontana — la nuvola grande come una moneta in mezzo al nero, che è come questa voce è
	// uscita al primo render. Una nuvola campionata a caso non raggiunge mai il suo ingombro
	// teorico (servirebbe una card contemporaneamente al bordo, la più vicina e la più larga),
	// quindi la soglia sta sotto il valore vero, non sopra.
	if (maxX - minX < width * 0.62 || maxY - minY < height * 0.7)
		throw new Error(
			`la posa larga è troppo lontana: la nuvola occupa ${Math.round(maxX - minX)}x${Math.round(maxY - minY)} su ${width}x${height}`
		);
	// 3. L'affondo finisce sulla card frontale, al centro e grande.
	const end = camera(durationInFrames - 1, fps);
	const d = HERO.z - end.z;
	if (d <= NEAR) throw new Error(`la camera finisce dentro la card frontale (distanza ${Math.round(d)})`);
	const s = FOCAL / d;
	if (Math.abs((HERO.x - end.x) * s) > 6 || Math.abs((HERO.y - end.y) * s) > 6)
		throw new Error("la card frontale non è al centro alla fine dell'affondo");
	if (HERO.h * s < 900) throw new Error(`la card frontale finisce alta ${Math.round(HERO.h * s)}px, troppo lontana`);

	// 4. NESSUNA CARD INVADE LA CARD FRONTALE nella posa finale. È il modo in cui l'affondo si
	//    rovina: qualcosa che passa davanti al poster centrale e lo taglia a metà proprio quando la
	//    camera si ferma.
	const heroHalf = (HERO.w * s) / 2;
	for (const c of SORTED) {
		if (c === HERO) continue;
		const cd = c.z - end.z;
		if (cd <= NEAR || cd >= d) continue; // dietro l'obiettivo, o dietro la card frontale
		const cs = FOCAL / cd;
		const gap = Math.abs((c.x - end.x) * cs) - (c.w * cs) / 2 - heroHalf;
		if (gap < 30) throw new Error(`una card copre quella frontale nella posa finale (margine ${Math.round(gap)}px)`);
	}
})();

// DUE METÀ, UNA BATTUTA SOLA: l'andata e il ritorno sono la stessa camera che percorre due curve
// diverse, non due scene separate — quindi non c'è una seconda <Sequence> da montare. Resta dentro
// una comunque, perché dentro `useCurrentFrame()` riparte da 0 per costruzione.
function Dive() {
	const frame = useCurrentFrame();
	const { fps: f } = useVideoConfig();
	const cam = camera(frame, f);

	return (
		<AbsoluteFill style={{ backgroundColor: GROUND, overflow: 'hidden' }}>
			<div style={{ position: 'absolute', inset: 0, transform: `rotate(${cam.roll}deg)` }}>
				{SORTED.map((c, i) => {
					const relZ = c.z - cam.z;
					if (relZ <= NEAR) return null; // passata dietro l'obiettivo durante l'affondo
					// LA PROIEZIONE. Tre righe, ed è tutto il 3D di questo file: la grandezza sullo
					// schermo è una CONSEGUENZA della distanza, mai un valore scritto.
					const s = FOCAL / relZ;
					const cw = c.w * s;
					const ch = c.h * s;
					// NEBBIA (prospettiva aerea) e DISSOLVENZA DI PASSAGGIO: la seconda esiste perché
					// nell'affondo una decina di card sfila accanto all'obiettivo, e senza si vedrebbe
					// una lastra spazzare il fotogramma in due fotogrammi — che si legge come
					// sfarfallio, non come velocità.
					const fog = interpolate(relZ, [1200, FOG_FAR], [1, 0.55], { easing: EXPO, ...CLAMP });
					const pass = interpolate(relZ, [NEAR, NEAR + 900], [0, 1], { easing: EXPO, ...CLAMP });
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: width / 2 + (c.x - cam.x) * s - cw / 2,
								top: height / 2 + (c.y - cam.y) * s - ch / 2,
								width: cw,
								height: ch,
								backgroundColor: TONES[c.tone],
								opacity: fog * pass,
								// Senza il filo di bordo le stampe scure spariscono nel nero, e nella posa
								// larga la nuvola perde metà delle sue card proprio quando serve intera.
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

export default function PullbackDiveDemo() {
	return (
		<Sequence durationInFrames={durationInFrames}>
			<Dive />
		</Sequence>
	);
}
