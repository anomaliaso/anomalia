// wow: PUSH_ZOOM_PARALLAX — la camera entra in una nuvola di poster sospesi e la attraversa, da
// lontanissimo fino a fermarsi davanti a una card sola. Le card non si muovono: si muove chi guarda.
//
// LA PROFONDITÀ STA NELLA Z, NON NELLA SCALA. È il punto che rompe tutto se sbagliato. Ogni card
// ha una posizione vera in un volume (x, y, z in unità di mondo) e una dimensione vera; quanto
// misura sullo schermo NON è un numero scritto da qualcuno, è `FOCAL / distanza`. Se si simulasse
// la lontananza rimpicciolendo le card, la parallasse sarebbe finta: le card lontane e quelle vicine
// scorrerebbero alla stessa velocità e l'occhio lo vede subito. Qui una card a 1200 di distanza
// attraversa il fotogramma mentre una a 12000 quasi non si sposta, e non c'è una riga di codice che
// lo imponga — è la divisione prospettica che lo fa da sola.
//
// PERCHÉ LA PROIEZIONE A MANO E NON `preserve-3d` + `translate3d`. Il CSS 3D fa la stessa
// prospettiva con meno righe, ed è la strada ovvia. Non è quella scelta qui, per tre motivi che
// contano tutti in VM:
//   1. ORDINE IN PROFONDITÀ. Con `preserve-3d` l'ordinamento lo fa il browser, e due card quasi
//      complanari sfarfallano — si scambiano di piano a fotogrammi alterni. Qui le card si ordinano
//      per distanza e si disegnano dalla più lontana alla più vicina (algoritmo del pittore):
//      l'ordine è nel DOM, quindi è lo stesso in anteprima e in VM, sempre.
//   2. IL PIANO VICINO. Una card che finisce DIETRO l'obiettivo, in CSS, non sparisce: si ribalta e
//      produce un fotogramma sporco. Qui `relZ <= NEAR` la toglie, e la dissolvenza di passaggio la
//      accompagna fuori invece di farla schiantare.
//   3. LA NEBBIA. L'opacita' per distanza serve comunque, e per calcolarla serve comunque la
//      distanza: col CSS la si calcolerebbe due volte, una in JS e una nella matrice.
// Il costo è dodici righe di algebra. Il guadagno è che questo file non ha nessun comportamento
// che dipenda da come il motore di rendering implementa il 3D.
//
// LA CURVA STA SULLA CAMERA, NON SULLE CARD — e questa riga esiste perché qualcuno non la
// "ripari". Nel resto della libreria l'expo sta sull'elemento che entra; qui l'elemento non entra
// mai: le card sono costanti, non hanno una sola animazione addosso. L'unica cosa interpolata in
// tutto il file è `camera(frame)`. Mettere un'expo o una molla sulle card qui significherebbe
// muovere gli oggetti nello spazio invece della camera, e il risultato smetterebbe di essere un
// volume e tornerebbe a essere un mucchio di animazioni sincronizzate — cioè esattamente la cosa
// da cui questa sezione si distingue.
//
// LA CASUALITA' È SEMINATA. Le posizioni sono casuali all'occhio e IDENTICHE a ogni render, perché
// vengono da `random(seed)` di Remotion. `Math.random()` qui sarebbe il difetto che sembra un
// problema di render: il render distribuito valuta il corpo del modulo in più processi, ogni
// processo genererebbe una nuvola diversa, e il video sfarfallerebbe a blocchi di fotogrammi.
//
// LE CARD SONO SEGNAPOSTO. Nessuna tipografia, nessun dato, nessuna didascalia cotta dentro: la
// voce è il movimento, il contenuto entra da fuori. Una voce che si porta dentro il suo contenuto
// non è un template, è una grafica.
//
// GLI ANGOLI SONO VIVI, E NON È UNA SVISTA rispetto alla banda 16-24 della specifica: quella regola
// parla di card di interfaccia disegnate alla loro dimensione. Qui la stessa card misura 1100px alla
// fine e 38px all'inizio; un raggio fisso di 20px la trasformerebbe in una pillola quando è
// lontana. Un poster ha gli angoli vivi, come nel riferimento.
import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1440;

// 5 secondi. L'expo in-out spende quasi tutto il tragitto in un secondo e mezzo centrale: sotto i
// quattro secondi la posa lontana non fa in tempo a leggersi e l'attraversamento diventa uno stacco,
// sopra i sei le due estremita' quasi ferme diventano un'attesa.
export const durationInFrames = 150;

const EXPO = Easing.bezier(0.87, 0, 0.13, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const GROUND = '#050506';
/** Lunghezza focale in pixel: un'altezza di mondo h a distanza d misura `h * FOCAL / d` px. */
const FOCAL = 1500;
/** Piano vicino: oltre questo la card è passata dietro l'obiettivo e non si disegna più. */
const NEAR = 300;
const FOG_FAR = 15000;

/** Cinque toni neutri: il riferimento alterna stampe scure e stampe color crema. */
const TONES = ['#0E0E11', '#1B1B20', '#34343B', '#8C8C95', '#DEDCD5'];
const LABELS = ['#5C5C66', '#6F6F7A', '#9C9CA6', '#232328', '#37373D'];
/**
 * La distribuzione dei toni è PESATA, e il peso l'ha deciso il video, non il gusto: con i cinque
 * toni equiprobabili due card su cinque erano quasi nere, e su fondo nero sparivano. Il primo
 * fotogramma sembrava rado — mancava un terzo della nuvola, semplicemente non si vedeva.
 */
const TONE_MIX = [0, 1, 1, 2, 2, 3, 3, 3, 4, 4];

type Card = { x: number; y: number; z: number; w: number; h: number; tone: number };

const Z0 = -6100;
const Z1 = 7350;

// ─── IL VOLUME È UN CONO, NON UN TUBO ─────────────────────────────────────────
// Questa è la costruzione che fa somigliare il primo fotogramma al riferimento, e ci si arriva solo
// guardando un render: con un tubo di raggio costante la nuvola lontana si stringe in un grumo al
// centro del fotogramma e i bordi restano neri. Il motivo è prospettico e non si aggira aggiungendo
// card — a 15000 di distanza il fotogramma è largo 5400 unità di mondo, a 6100 ne è largo 2200.
//
// Quindi il raggio non è un numero: è una FRAZIONE DELLA DISTANZA INIZIALE. Se una card sta a
// `rad = u * d0`, il suo scostamento dal centro dello schermo al fotogramma 0 vale `u * FOCAL` —
// indipendente dalla profondità. Cioè: si dispone la nuvola direttamente in coordinate di SCHERMO
// della posa iniziale, e viene fuori un campo fitto da bordo a bordo come nel primo riferimento,
// che poi si apre intorno all'obiettivo mentre si entra.
//
// `ux` e `uy` sono diversi perché la tela è 3:4: con un cono a sezione circolare gli angoli restano
// vuoti. E il minimo su `t` è il corridoio libero — senza, una card capiterebbe esattamente
// sull'obiettivo e spazzerebbe il fotogramma intero in due fotogrammi.
const CLOUD: Card[] = Array.from({ length: 110 }, (_, i) => {
	const r = (k: string) => random(`fly-${k}-${i}`);
	const z = r('z') * 9000;
	const d0 = z - Z0;
	const a = r('a') * Math.PI * 2;
	// sqrt(u) è la distribuzione uniforme sull'ellisse: senza, le card si ammucchiano al centro.
	const t = 0.16 + Math.sqrt(r('r')) * 0.84;
	const ux = Math.cos(a) * t * 0.42;
	const uy = Math.sin(a) * t * 0.56;
	// Anche l'altezza è una frazione della distanza iniziale: sullo schermo, al fotogramma 0, le card
	// misurano fra 55 e 190px. L'esponente 1.7 è quello che dà la proporzione del riferimento —
	// moltissime piccole, poche grandi. Con una distribuzione piatta la nuvola sembra impaginata.
	const h = (0.037 + Math.pow(r('h'), 1.7) * 0.09) * d0;
	// Qualche formato orizzontale, come nel riferimento: una nuvola di soli verticali sembra stampata.
	const asp = r('p') < 0.24 ? 1.34 : 0.7;
	return { x: ux * d0, y: uy * d0, z, w: h * asp, h, tone: TONE_MIX[Math.floor(r('t') * TONE_MIX.length)] };
});

/** La card su cui il volo si ferma: dead-centre alla fine, come nel terzo riferimento. */
const HERO: Card = { x: 200, y: -40, z: 8600, w: 660, h: 950, tone: 4 };

// ─── LE COMPAGNE DELLA POSA FINALE ────────────────────────────────────────────
// Il cono ha una conseguenza che si vede solo all'arrivo: le sue card stanno a un raggio
// proporzionale alla distanza INIZIALE, quindi a fine volo sono tutte fuori dal fotogramma e la card
// frontale resta sola su nero. Nel riferimento non è così — intorno al poster centrale ce ne sono
// altri, tagliati dai bordi. Queste nove card sono disposte al contrario delle altre: si scelgono la
// profondità e lo scostamento IN PIXEL nella posa finale, e da lì si ricavano le coordinate di
// mondo. Durante il volo sono card come tutte le altre, lontane e piccole.
//
// Stanno nelle bande laterali e non sopra o sotto perché la card frontale è alta 1140px su una tela
// da 1440: sopra e sotto non c'è spazio, ai lati sì. `Math.max` sullo scostamento garantisce che
// nessuna invada il poster centrale — e il controllo qui sotto lo verifica.
const COMPANIONS: Card[] = Array.from({ length: 9 }, (_, i) => {
	const r = (k: string) => random(`flyc-${k}-${i}`);
	const depth = 780 + r('d') * 2100;
	const sh = 300 + r('s') * 620; // altezza in pixel nella posa finale
	const asp = r('p') < 0.3 ? 1.3 : 0.72;
	const halfW = (sh * asp) / 2;
	// 452 è la semi-larghezza IN PIXEL della card frontale nella posa finale (660 unità a 1250 di
	// distanza fanno 792px) più il margine. In unità di mondo sarebbe 330, e usare quel numero qui
	// è l'errore che il controllo qui sotto ha già intercettato una volta: due grandezze omogenee
	// solo all'apparenza.
	const off = Math.max(400 + r('o') * 430, 452 + halfW);
	const side = i % 2 ? 1 : -1;
	return {
		x: HERO.x + (side * off * depth) / FOCAL,
		y: HERO.y + ((r('y') - 0.5) * 1750 * depth) / FOCAL,
		z: Z1 + depth,
		w: (sh * asp * depth) / FOCAL,
		h: (sh * depth) / FOCAL,
		tone: TONE_MIX[Math.floor(r('t') * TONE_MIX.length)]
	};
});

// La camera si muove SOLO lungo Z, quindi l'ordine in profondità non cambia mai: si ordina una
// volta sola, qui, e nel corpo del componente non c'è nessun sort per fotogramma.
const SORTED: Card[] = [...CLOUD, ...COMPANIONS, HERO].sort((a, b) => b.z - a.z);
/** Fine della percorrenza: da qui in poi comanda la molla. */
const RUN = Math.round(durationInFrames * 0.86);

/**
 * LA CAMERA, e in questo file è l'unica cosa animata. Tre movimenti con TRE FINESTRE diverse: se
 * partissero e finissero insieme si leggerebbero come un unico gesto, e un unico gesto è uno zoom.
 */
function camera(frame: number, f: number) {
	// PERCORRENZA lungo l'asse: expo in-out, quasi ferma alle estremita' e ripidissima in mezzo. Si
	// ferma al 94% e lascia l'ultimo tratto alla molla, così il raccordo è continuo.
	const travel = interpolate(frame, [0, RUN], [Z0, Z0 + (Z1 - Z0) * 0.94], { easing: EXPO, ...CLAMP });
	// ATTERRAGGIO: sfonda di poco e rientra. Una molla non ha il campo `easing` perché non le serve:
	// la fisica È l'easing.
	const land = spring({ frame, fps: f, delay: RUN, from: Z0 + (Z1 - Z0) * 0.94, to: Z1, config: { damping: 11, stiffness: 150, mass: 0.7 } });
	const z = frame < RUN ? travel : land;
	// TRASLAZIONE LATERALE, finestra più lunga della percorrenza: quando l'asse si è già posato
	// questa sta ancora arrivando, e il fotogramma non muore mai. Finisce esattamente sulla card
	// frontale, che è il motivo per cui il volo sembra puntare qualcosa invece di sfondare a caso.
	const x = interpolate(frame, [0, durationInFrames * 0.94], [-300, HERO.x], { easing: EXPO, ...CLAMP });
	const y = interpolate(frame, [0, durationInFrames * 0.94], [230, HERO.y], { easing: EXPO, ...CLAMP });
	// ROLL: due gradi e mezzo, e anche lui atterra invece di fermarsi di scatto — la stessa molla
	// della Z, sul grado invece che sull'unità di mondo: se il tragitto si posa fisicamente e il
	// grado si limita a smettere quando la percorrenza smette, la camera si sente ferma due volte,
	// una in Z e una nel grado, e la seconda è quella che si nota perché non ha peso.
	const ROLL_FROM = 2.4;
	const ROLL_TO = -0.9;
	const rollRun = interpolate(frame, [0, RUN], [ROLL_FROM, ROLL_FROM + (ROLL_TO - ROLL_FROM) * 0.94], {
		easing: EXPO,
		...CLAMP
	});
	const rollLand = spring({
		frame,
		fps: f,
		delay: RUN,
		from: ROLL_FROM + (ROLL_TO - ROLL_FROM) * 0.94,
		to: ROLL_TO,
		config: { damping: 11, stiffness: 150, mass: 0.7 }
	});
	const roll = frame < RUN ? rollRun : rollLand;
	return { x, y, z, roll };
}

// ─── IL CONTROLLO CHE DEVE FALLIRE ────────────────────────────────────────────
// Gira al caricamento del modulo e fa fallire il render con un messaggio, non con un fotogramma
// sbagliato che si nota al terzo video. Verifica le tre cose che questa voce PROMETTE, e sono tre
// perché tre sono i modi in cui è già uscita sbagliata guardando i render.
(function assertFlight() {
	const c0 = camera(0, fps);
	// 1. LA POSA INIZIALE È PIENA. Non basta che le card siano davanti all'obiettivo: devono anche
	//    COPRIRE il fotogramma, che è ciò che il primo riferimento mostra. È il controllo che coglie
	//    la nuvola-grumo, cioè il difetto che il cono esiste per risolvere: se qualcuno riportasse
	//    il raggio a un valore costante, qui il conto delle card nei bordi crollerebbe.
	const edges = [0, 0, 0, 0];
	for (const c of SORTED) {
		const d = c.z - c0.z;
		if (d <= NEAR) throw new Error("la posa iniziale ha una card dietro l'obiettivo: alza Z0");
		const s = FOCAL / d;
		const x = width / 2 + (c.x - c0.x) * s;
		const y = height / 2 + (c.y - c0.y) * s;
		if (x < width * 0.2) edges[0]++;
		if (x > width * 0.8) edges[1]++;
		if (y < height * 0.2) edges[2]++;
		if (y > height * 0.8) edges[3]++;
	}
	if (Math.min(...edges) < 8)
		throw new Error(`la posa iniziale non riempie il fotogramma: card per bordo ${edges.join('/')}, ne servono 8`);

	// 2. L'AFFONDO FINISCE SULLA CARD FRONTALE, al centro e grande.
	const c1 = camera(durationInFrames - 1, fps);
	const d = HERO.z - c1.z;
	if (d <= NEAR) throw new Error(`la camera finisce dentro la card frontale (distanza ${Math.round(d)})`);
	const s = FOCAL / d;
	const cx = width / 2 + (HERO.x - c1.x) * s;
	const cy = height / 2 + (HERO.y - c1.y) * s;
	if (Math.abs(cx - width / 2) > 6 || Math.abs(cy - height / 2) > 6)
		throw new Error(`la card frontale non è al centro alla fine: ${Math.round(cx)},${Math.round(cy)}`);
	if (HERO.h * s < 900) throw new Error(`la card frontale finisce alta ${Math.round(HERO.h * s)}px, troppo lontana`);

	// 3. NESSUNA COMPAGNA INVADE LA CARD FRONTALE. È il modo in cui la posa finale si rovina: una
	//    card che a fine volo passa davanti al poster centrale e lo taglia a metà.
	const heroHalf = (HERO.w * s) / 2;
	for (const c of COMPANIONS) {
		const cd = c.z - c1.z;
		if (cd >= d) continue; // sta dietro la card frontale, non può coprirla
		const cs = FOCAL / cd;
		const gap = Math.abs((c.x - c1.x) * cs) - (c.w * cs) / 2 - heroHalf;
		if (gap < 30) throw new Error(`una compagna copre la card frontale (margine ${Math.round(gap)}px)`);
	}
})();

// UN'UNICA BATTUTA, E RESTA COMUNQUE UNA <Sequence>. Non c'è un secondo beat da montare — è un
// volo solo — ma dentro una Sequence `useCurrentFrame()` riparte da 0 per costruzione, invece di
// dipendere dal fatto che questo componente sia montato alla radice: la stessa forma vale anche
// quando la voce ha una battuta sola, non solo quando ne ha molte.
function Flight() {
	const frame = useCurrentFrame();
	const { fps: f } = useVideoConfig();
	const cam = camera(frame, f);

	return (
		<AbsoluteFill style={{ backgroundColor: GROUND, overflow: 'hidden' }}>
			<div style={{ position: 'absolute', inset: 0, transform: `rotate(${cam.roll}deg)` }}>
				{SORTED.map((c, i) => {
					const relZ = c.z - cam.z;
					if (relZ <= NEAR) return null; // passata dietro l'obiettivo
					// LA PROIEZIONE. Tre righe, ed è tutto il 3D di questo file: la grandezza sullo
					// schermo è una CONSEGUENZA della distanza, mai un valore scritto.
					const s = FOCAL / relZ;
					const cw = c.w * s;
					const ch = c.h * s;
					const left = width / 2 + (c.x - cam.x) * s - cw / 2;
					const top = height / 2 + (c.y - cam.y) * s - ch / 2;
					// NEBBIA (prospettiva aerea) e DISSOLVENZA DI PASSAGGIO: la seconda esiste perché
					// una card che sfila accanto all'obiettivo altrimenti spazzerebbe il fotogramma
					// intero in due fotogrammi, e si legge come uno sfarfallio, non come velocità.
					const fog = interpolate(relZ, [1200, FOG_FAR], [1, 0.55], { easing: EXPO, ...CLAMP });
					const pass = interpolate(relZ, [NEAR, NEAR + 900], [0, 1], { easing: EXPO, ...CLAMP });
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left,
								top,
								width: cw,
								height: ch,
								backgroundColor: TONES[c.tone],
								opacity: fog * pass,
								// Il filo di bordo non è decorazione: senza, le stampe scure spariscono
								// nel nero e la nuvola lontana perde metà delle sue card.
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

export default function FlythroughDemo() {
	return (
		<Sequence durationInFrames={durationInFrames}>
			<Flight />
		</Sequence>
	);
}
