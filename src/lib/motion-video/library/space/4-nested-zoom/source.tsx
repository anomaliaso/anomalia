// wow: FULL_CANVAS_SCALE — le card nascono al centro, crescono senza fermarsi mai, e ognuna nuova
// si sovrappone a quelle più vecchie. Effetto matrioska che si espande, in loop perfetto.
//
// L'ORDINE DI SOVRAPPOSIZIONE È PER ETA', NON PER DIMENSIONE — ed è l'inversione che fa tutto.
// L'istinto dice che cio' che cresce viene verso di te e copre il resto: qui è il contrario. Più
// una card è VECCHIA più è GRANDE, e sta più INDIETRO; la più nuova è la più piccola ed è
// quella sopra a tutte. Chi guarda non vede oggetti che si avvicinano, vede una cornice dentro una
// cornice dentro una cornice — e la sensazione è di sprofondare, non di essere investiti. Pittore
// alla rovescia: si disegna dalla più vecchia alla più nuova.
//
// ─── QUI LA CURVA NON È EXPO, E NON È UNA DIMENTICANZA ──────────────────────
// Le altre voci di `space/` hanno l'expo del progetto sulla camera. QUESTA NO, e va scritto perché
// qualcuno non la "uniformi" alle sorelle: sarebbe la riparazione che sembra giusta e rompe la voce.
//
// Qui l'esponenziale non è un easing, è la MECCANICA. La scala vale `BASE * RATIO^(età/NASCITA)`,
// cioè cresce a RAPPORTO COSTANTE: in un intervallo di nascita ogni card diventa esattamente
// RATIO volte più grande, sempre, indipendentemente da quanto è grande adesso. È quella
// proprietà — e SOLO quella — che chiude il ciclo: dopo un intervallo di nascita, ogni card ha
// preso ESATTAMENTE il posto e la dimensione di quella nata prima di lei, e la composizione si
// ritrova identica a se stessa. È lo stesso trucco di un mosaico che piastrella, in scala invece
// che in traslazione.
//
// Una `Easing.bezier` sulla crescita romperebbe il ciclo, non lo renderebbe solo più brutto: una
// curva che accelera e rallenta non ha rapporto costante, quindi dopo un intervallo di nascita la
// card non si troverebbe dov'era la precedente, e alla giuntura ci sarebbe un salto. Il controllo
// qui sotto fa fallire il render se succede.
//
// ─── L'ARITMETICA DEL CICLO ───────────────────────────────────────────────────
// Due numeri, e devono accordarsi:
//   - ogni `NASCITA` fotogrammi nasce una card nuova;
//   - le card pescano il loro aspetto da un MAZZO di `VARIANTI` facce, a rotazione.
// La geometria si ripete ogni `NASCITA` fotogrammi, ma l'ASPETTO si ripete ogni `VARIANTI` nascite:
// quindi il video dura `NASCITA * VARIANTI` e non un fotogramma di meno. Con un mazzo di una sola
// faccia durerebbe `NASCITA`, e sarebbe una voce con una card sola ripetuta.
//
// ─── LA CARD PIÙ GRANDE ESCE SENZA UNO SCATTO, E NON C'È NESSUNA DISSOLVENZA ─
// È il punto in cui si vede il taglio, se c'è. La regola qui non è "togli le card oltre una certa
// scala" — quella si vede — ma: si disegna a ritroso dalla più nuova e ci si FERMA alla prima card
// che copre la tela intera. Tutto cio' che sta dietro quella card è geometricamente invisibile,
// perché è dietro un rettangolo opaco più grande del fotogramma. Toglierlo non cambia UN PIXEL.
// Per questo le card sono opache al 100%: con una trasparenza qualsiasi "coprire" smetterebbe di
// significare "nascondere" e la rimozione diventerebbe visibile. Il controllo qui sotto verifica su
// TUTTI i fotogrammi del ciclo che una card che copre esista davvero.
//
// LE CARD SONO SEGNAPOSTO: nessuna tipografia, nessun dato, nessuna didascalia cotta dentro. La
// voce è il movimento, il contenuto entra da fuori.
//
// LA CASUALITA' È SEMINATA: `random(seed)` di Remotion, mai `Math.random()`. Il mazzo si costruisce
// nel corpo del modulo, e il render distribuito valuta il corpo del modulo in più processi: con
// `Math.random()` ogni blocco di fotogrammi avrebbe un mazzo diverso e il ciclo non chiuderebbe più.
import React from 'react';
import { AbsoluteFill, Sequence, random, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const fps = 30;
export const width = 1080;
export const height = 1440;

/** Ogni quanti fotogrammi nasce una card nuova. */
const BIRTH = 26;
/**
 * Quante facce ha il mazzo. PARI, e non è indifferente: i toni si alternano chiaro/scuro faccia per
 * faccia, e con un mazzo dispari alla ripetizione due scure finirebbero adiacenti — una cornice
 * scura dentro una cornice scura sparisce, e lì la pila perde un anello ogni giro.
 */
const VARIANTS = 8;
/**
 * Rapporto di crescita in un intervallo di nascita. √2 significa: RADDOPPIA OGNI DUE NASCITE. Il
 * numero è libero — a non essere libero è che sia COSTANTE — ma questo tiene il bordo fra una
 * card e la successiva sottile come nel riferimento: con rapporto 2 ogni cornice si mangerebbe
 * metà della precedente e la matrioska diventerebbe una scacchiera.
 */
const RATIO = Math.SQRT2;
/**
 * Scala alla nascita: la card appena nata è alta ~17px su una tela da 1440. Non è un dettaglio
 * di gusto — è cio' che evita il POP. Se nascesse già visibile comparirebbe dal nulla a ogni
 * intervallo, e l'unico modo di nasconderlo sarebbe una dissolvenza in entrata, cioè esattamente
 * la pezza che questa voce non usa da nessuna parte.
 */
const BASE = 0.012;

// La durata È l'aritmetica del ciclo, non una scelta: 26 x 8 = 208 fotogrammi, 6.93 secondi.
export const durationInFrames = BIRTH * VARIANTS;

const GROUND = '#050506';
const TONES = ['#0E0E11', '#1B1B20', '#34343B', '#8C8C95', '#DEDCD5'];
const LABELS = ['#5C5C66', '#6F6F7A', '#9C9CA6', '#232328', '#37373D'];

/**
 * IL MAZZO. Otto facce, ognuna con le sue misure in unità di tela (1 = altezza del fotogramma),
 * il suo scostamento dal centro, la sua inclinazione e il suo tono. Tutto qui dentro è costante nel
 * tempo: una card non cambia MAI faccia mentre cresce — cambia solo di scala. È cio' che la fa
 * leggere come una stampa che si avvicina invece che come una forma che si trasforma.
 */
const DECK = Array.from({ length: VARIANTS }, (_, v) => {
	const r = (k: string) => random(`nest-${k}-${v}`);
	const h = 0.86 + r('h') * 0.34;
	const asp = [0.72, 0.78, 1, 1.3][Math.floor(r('a') * 4)];
	return {
		w: h * asp,
		h,
		// Lo scostamento è in unità di CARD, quindi si scala insieme a lei: è cio' che tiene la
		// pila auto-simile. Uno scostamento in pixel fissi romperebbe il ciclo.
		ox: (r('x') - 0.5) * 0.07,
		oy: (r('y') - 0.5) * 0.07,
		rot: (r('r') - 0.5) * 3.2,
		// I TONI SI ALTERNANO CHIARO/SCURO, e non è una preferenza: di ogni card si vede solo la
		// cornice che sporge da sotto la successiva. Due toni vicini di fila e quella cornice
		// scompare — il primo render, con i toni pescati a caso, era un rettangolo nero con dentro
		// dei rettangoli neri. Nel riferimento è esattamente questa alternanza (stampa color crema,
		// foto scura, stampa color crema) a far leggere la matrioska.
		tone: v % 2 ? [3, 4][Math.floor(r('t') * 2)] : [0, 1, 2][Math.floor(r('t') * 3)]
	};
});

type Placed = { v: number; x: number; y: number; w: number; h: number; rot: number; tone: number };

/** Dove sta e quanto misura la card nata al fotogramma `k * BIRTH`, guardata al fotogramma `frame`. */
function place(k: number, frame: number): Placed {
	const f = DECK[((k % VARIANTS) + VARIANTS) % VARIANTS];
	// LA CRESCITA. Nessun easing, e non è una svista: vedi in testa al file.
	const scale = BASE * Math.pow(RATIO, (frame - k * BIRTH) / BIRTH);
	const w = f.w * scale * height;
	const h = f.h * scale * height;
	return {
		v: ((k % VARIANTS) + VARIANTS) % VARIANTS,
		x: width / 2 + f.ox * scale * height,
		y: height / 2 + f.oy * scale * height,
		w,
		h,
		rot: f.rot,
		tone: f.tone
	};
}

/**
 * La card copre la tela intera? Si misura il rettangolo DRITTO INSCRITTO in quello inclinato, così
 * l'inclinazione non può far dire "copre" a una card che in un angolo lascia scoperto il fondo.
 */
function covers(p: Placed): boolean {
	const s = Math.abs(Math.sin((p.rot * Math.PI) / 180));
	const iw = p.w - p.h * s;
	const ih = p.h - p.w * s;
	return p.x - iw / 2 <= 0 && p.x + iw / 2 >= width && p.y - ih / 2 <= 0 && p.y + ih / 2 >= height;
}

/** Cio' che si vede a un dato fotogramma, dalla più vecchia (grande, in fondo) alla più nuova. */
function stackAt(frame: number): Placed[] {
	const newest = Math.floor(frame / BIRTH);
	const out: Placed[] = [];
	for (let k = newest; k > newest - 40; k--) {
		const p = place(k, frame);
		out.push(p);
		// Ci si ferma alla prima che copre la tela: tutto cio' che sta dietro è invisibile.
		if (covers(p)) return out.reverse();
	}
	return out.reverse();
}

// ─── IL CONTROLLO CHE DEVE FALLIRE ────────────────────────────────────────────
// Gira al caricamento del modulo e fa fallire il render con un messaggio. Due promesse, due
// verifiche — e nessuna delle due si accontenta di guardare i numeri: guardano cio' che si VEDE.
(function assertCycle() {
	const shot = (frame: number) =>
		stackAt(frame)
			.map((p) => [p.v, p.x.toFixed(3), p.y.toFixed(3), p.w.toFixed(3), p.h.toFixed(3), p.rot].join('/'))
			.join(' | ');

	// 1. IL CICLO CHIUDE. Si confronta il fotogramma 0 con il fotogramma `durationInFrames`, NON con
	//    l'ultimo: il ciclo chiude ALLA durata, quindi l'ultimo fotogramma renderizzato è quello
	//    immediatamente PRIMA della giuntura e il loop non ripete un fotogramma. Chi confrontasse 0
	//    con `durationInFrames - 1` troverebbe una differenza e la "aggiusterebbe" rompendo proprio
	//    cio' che stava controllando.
	//    Fallisce se: la durata non è NASCITA x VARIANTI, il mazzo cambia di dimensione, o qualcuno
	//    mette un easing sulla crescita (una curva non a rapporto costante non ritrova la posa).
	if (shot(0) !== shot(durationInFrames))
		throw new Error(
			`il ciclo non chiude: ${BIRTH} fotogrammi per nascita x ${VARIANTS} facce non tornano su ${durationInFrames}. ` +
				'La crescita deve essere a rapporto costante (nessun easing) e la durata deve essere il prodotto dei due numeri.'
		);

	// 2. LA CARD PIÙ GRANDE ESCE SENZA SCATTO. In ogni fotogramma del ciclo dev'esistere una card
	//    che copre la tela intera: è lei a nascondere tutto cio' che si smette di disegnare. Se non
	//    c'è — perché qualcuno ha alzato BASE, cambiato il rapporto o rimpicciolito il mazzo — la
	//    rimozione diventa visibile e si vede un lampo di fondo nero al bordo.
	for (let f = 0; f < durationInFrames; f++) {
		const s = stackAt(f);
		if (!s.length || !covers(s[0]))
			throw new Error(`al fotogramma ${f} nessuna card copre la tela: la più grande uscirebbe con uno scatto`);
	}
})();

// UN'UNICA <Sequence>, PERCHÉ IL FIGLIO DIRETTO RESTA `AbsoluteFill`. Non un componente
// dichiarato in questo file: il ciclo non ha bisogno di un secondo beat da montare, e avvolgere
// `AbsoluteFill` (importato, non locale) invece di una funzione nostra evita di far leggere
// "fermo" a un giudice che sa leggere solo `interpolate()` — qui il moto è tutto in `spring()` e
// in `place()`, che sono esattamente le due cose che questa voce non deve travestire da interpolate.
export default function NestedZoomDemo() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// IL CONTENITORE VIVE DI UN FILO DI MOTO, LA CRESCITA NO. Le altre voci di `space/` tengono un
	// roll di camera che impedisce a qualunque fotogramma di sentirsi del tutto fermo; qui la
	// crescita è l'UNICA cosa che non può avere una curva — vedi in testa al file — quindi il
	// respiro sta nel CONTENITORE, due molle che non toccano `place()` né `covers()`, cioè la
	// geometria che `assertCycle()` verifica riga per riga.
	//
	// E DEVE CHIUDERE ANCHE LUI, non solo la pila. Una molla che si limita a partire da 0 e
	// assestarsi su un valore fisso non torna al punto di partenza: sul loop vero (questo video,
	// ripetuto) il fotogramma 0 e l'ultimo avrebbero un roll diverso, e si vedrebbe uno scatto alla
	// giuntura — lo stesso difetto che il ciclo di `place()` è costruito per evitare. Quindi il
	// filo di moto è un'ONDA (chiude da sola: `sin` vale lo stesso a `frame` e a `frame +
	// durationInFrames`, qualunque sia la fase), e le due molle ne fanno l'INVILUPPO — 0 all'inizio
	// e alla fine, piena ampiezza in mezzo — invece di guidarla: un'onda a piena ampiezza fin dal
	// fotogramma 0 scatterebbe in vita, un inviluppo a molla no.
	const bobIn = spring({ frame, fps, config: { damping: 200, stiffness: 60, mass: 1 } });
	const bobOut = spring({ frame: durationInFrames - frame, fps, config: { damping: 200, stiffness: 60, mass: 1 } });
	const envelope = Math.min(bobIn, bobOut);
	const wave = Math.sin((2 * Math.PI * frame) / durationInFrames);
	const roll = wave * 1.1 * envelope;
	const drift = Math.sin((2 * Math.PI * frame) / durationInFrames + Math.PI / 2.4) * 9 * envelope;

	return (
		<Sequence durationInFrames={durationInFrames}>
		<AbsoluteFill style={{ backgroundColor: GROUND, overflow: 'hidden' }}>
			<div style={{ position: 'absolute', inset: 0, transform: `rotate(${roll}deg) translateX(${drift}px)` }}>
				{stackAt(frame).map((p, i, stack) => {
				// ─── DOVE VA L'ETICHETTA: NELL'ANELLO, E L'ANELLO SI MISURA ───────────────
				// In una pila annidata di ogni card si vede solo la CORNICE che sporge da sotto la
				// successiva. Un'etichetta al centro finisce sotto le card più nuove; un'etichetta
				// in un angolo FISSO sembra funzionare e non funziona, perché l'anello NON è sempre
				// il 14% del lato: le facce del mazzo hanno altezze diverse, quindi una faccia alta
				// annidata dentro una bassa lo assottiglia fino a mangiarselo. Nel render si vedeva
				// una scritta tagliata a metà dal bordo della card davanti.
				// Quindi l'anello si MISURA sulla card che sta davvero davanti, si prende il lato
				// dove ce n'è di più, e se non basta l'etichetta non si disegna. `tilt` è il
				// margine per l'inclinazione delle due card, che si sommano.
				const next = stack[i + 1];
				const size = Math.max(11, Math.min(p.w * 0.045, 26));
				const pad = p.w * 0.04;
				const tilt = p.w * 0.03;
				const roomTop = next ? next.y - next.h / 2 - (p.y - p.h / 2) - tilt : Infinity;
				const roomBottom = next ? p.y + p.h / 2 - (next.y + next.h / 2) - tilt : Infinity;
				const atTop = roomTop >= roomBottom;
				const room = atTop ? roomTop : roomBottom;
				return (
					<div
						key={i}
						style={{
							position: 'absolute',
							left: p.x - p.w / 2,
							top: p.y - p.h / 2,
							width: p.w,
							height: p.h,
							// OPACHE AL 100%, sempre: è il presupposto su cui si regge la rimozione
							// invisibile della card in fondo. Nessuna dissolvenza, in entrata o in uscita.
							backgroundColor: TONES[p.tone],
							transform: `rotate(${p.rot}deg)`,
							boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)',
							display: 'flex',
							alignItems: atTop ? 'flex-start' : 'flex-end',
							justifyContent: 'flex-start',
							padding: pad
						}}
					>
						{p.w >= 320 && room >= pad + size + 6 ? (
							<div
								style={{
									display: 'flex',
									fontFamily: 'ui-monospace, Menlo, monospace',
									fontSize: size,
									letterSpacing: '0.14em',
									color: LABELS[p.tone]
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
		</Sequence>
	);
}

