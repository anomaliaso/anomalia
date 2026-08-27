/**
 * IL PATTO DELLA LIBRERIA, e perché è un test veloce e non un render.
 *
 * Una voce entra solo dopo aver prodotto un MP4 (`npm run bake:motion-library`, stessa VM del
 * render di produzione). Quel passo costa una macchina e una decina di secondi a voce, quindi si
 * fa UNA volta e il file resta accanto al codice. Qui si verifica ciò che resta vero per sempre:
 * la voce compila, passa i cancelli deterministici, atterra sulle molle, e il suo video c'è.
 *
 * IL NUMERO CHE GOVERNA IL TEST DELLE MOLLE. Misura del 22/8/2026 su tutti e 24 i sorgenti in
 * produzione contro i voti di mestiere: i sorgenti con ≥4 `spring()` prendono 7,70 di media (8,8
 * spring, 6,8 interpolate), quelli con ≤2 prendono 4,98 (0,5 spring, 22,8 interpolate). La serie è
 * monotona e il peggiore mai giudicato — unico `kill`, unico `transitions_broken` — ha 0 spring e
 * 44 interpolate. Non è "eased contro lineare": ogni interpolate porta già il suo `easing`. È
 * MOLLA contro INTERPOLAZIONE. Quindi una voce annacquata a forza di interpolate cade qui, non in
 * produzione.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileMotionSource, findUnexportedNamedImport } from './compile';
import {
	findDeadEntrances,
	findDurationMismatch,
	findFrozenBackplate,
	findLinearMotion,
	findStaticTails,
	formatDurationMismatch,
	formatFrozenBackplate
} from './easing';
import { LIBRARY_SECTIONS, MOTION_LIBRARY, libraryFileBody, motionLibraryIndex } from './library';

const REPO = process.cwd();
const each = MOTION_LIBRARY.map((e) => [e.id, e] as const);

/** La prova versionata della cottura: chi ha renderizzato, con quale sorgente. */
const MANIFEST = JSON.parse(
	readFileSync(join(REPO, 'src/lib/motion-video/library/bake-manifest.json'), 'utf8')
) as Record<string, { renders: boolean; at: string; sourceHash: string; kb: number; stills: number }>;

describe('MOTION_LIBRARY', () => {
	it('non è vuota e ogni sezione ne ha almeno una', () => {
		expect(MOTION_LIBRARY.length).toBeGreaterThanOrEqual(9);
		for (const s of Object.keys(LIBRARY_SECTIONS)) {
			expect(MOTION_LIBRARY.some((e) => e.section === s), s).toBe(true);
		}
	});

	it.each(each)('%s compila così com\'è', (_id, e) => {
		const compiled = compileMotionSource(e.code);
		expect(typeof compiled.component).toBe('function');
		expect(compiled.fps).toBeGreaterThan(0);
		expect(compiled.durationInFrames).toBeGreaterThan(0);
	});

	it.each(each)('%s passa i cancelli deterministici', (_id, e) => {
		expect(findLinearMotion(e.code)).toEqual([]);
		expect(findStaticTails(e.code)).toEqual([]);
		expect(findDeadEntrances(e.code)).toEqual([]);
		// I due numeri: quanto dura la composizione contro quanto coprono le scene.
		expect(formatDurationMismatch(findDurationMismatch(e.code))).toBe('');
		// Nessun fondale congelato: le voci di `posts/` hanno un <Img> al 100% dentro OGNI card, e
		// devono restare verdi — un <Img> dentro una card dimensionata non è un fondale a tutta tela.
		expect(formatFrozenBackplate(findFrozenBackplate(e.code))).toBe('');
	});

	it.each(each)('%s atterra su molle, non su interpolate travestite', (_id, e) => {
		const springs = (e.code.match(/\bspring\s*\(/g) ?? []).length;
		const interps = (e.code.match(/\binterpolate\s*\(/g) ?? []).length;
		// La soglia misurata (≥4 spring → 7,70) vale per una COMPOSIZIONE intera, non per una voce
		// che dimostra un meccanismo solo: qui si verifica ciò che di quella misura trasferisce
		// davvero — la voce atterra su molle, e non le annega in interpolate. La forma bocciata
		// (0 spring / 44 interpolate, 0,5 / 22,8) resta impossibile.
		expect(springs, `${_id} ha ${springs} spring()`).toBeGreaterThanOrEqual(2);
		expect(interps, `${_id}: ${interps} interpolate su ${springs} spring`).toBeLessThanOrEqual(springs * 6);
		// Una molla non ha `easing` perché non le serve: la fisica È l'easing. Se qualcuno gliene
		// attacca uno "per uniformità", ha capito il contrario di quello che la voce insegna.
		expect(/spring\s*\(\s*\{[^}]*easing/.test(e.code)).toBe(false);
	});

	it.each(each)('%s monta le battute in una Sequence, non su guardie a mano', (_id, e) => {
		// Dentro una Sequence `useCurrentFrame()` riparte da 0, quindi il tempo locale è vero per
		// costruzione. È la forma che una rifattorizzazione non può rompere — ed è quella che 16
		// sorgenti su 24 in produzione NON usano.
		expect(/<(?:TransitionSeries|Series)\.Sequence\b|<Sequence\b/.test(e.code)).toBe(true);
	});

	/**
	 * IL PATTO, e perché non guarda più il file MP4.
	 *
	 * Gli MP4 e i fotogrammi sono in `.gitignore` — 46 MB di binari rigenerabili — quindi su un
	 * clone fresco non esistono e un'asserzione su `existsSync` sarebbe rossa per tutti tranne chi
	 * ha cotto in locale. La risposta facile sarebbe saltare l'asserzione quando il file manca: è
	 * la peggiore, perché lascia il test VERDE proprio nel caso in cui non sta verificando niente.
	 * Un test che si disattiva da solo quando la condizione non è comoda è peggio di nessun test.
	 *
	 * Quindi si verifica la PROVA, che si versiona: `bake-manifest.json`, scritto dalla cottura,
	 * dice che quella voce ha renderizzato e con quale sorgente. L'impronta è ciò che lo tiene
	 * onesto — cambia il `source.tsx` senza ricuocere e il test cade dicendo cosa ricuocere. Senza
	 * impronta il manifesto sarebbe una bugia che invecchia.
	 */
	it.each(each)('%s è stata cotta: il manifesto lo prova, e l\'impronta combacia', (_id, e) => {
		const rec = MANIFEST[e.id];
		expect(rec, `${e.id} non è nel manifesto — esegui: npm run bake:motion-library -- ${e.id}`).toBeTruthy();
		expect(rec.renders).toBe(true);
		expect(rec.kb).toBeGreaterThan(50);
		const hash = createHash('sha256').update(e.code, 'utf8').digest('hex').slice(0, 16);
		expect(
			rec.sourceHash,
			`${e.id}: il sorgente è cambiato dopo l'ultima cottura — esegui: npm run bake:motion-library -- ${e.id}`
		).toBe(hash);
		expect(e.stills.length).toBeGreaterThan(0);
		expect(rec.stills).toBe(e.stills.length);
	});

	/**
	 * E quando i file CI SONO — cioè su una macchina che ha cotto — si guardano davvero. È la
	 * seconda rete, quella che prende un download troncato o dei fotogrammi che non combaciano
	 * con `meta.json`: cose che il manifesto da solo non vedrebbe.
	 */
	it.each(each)('%s: se i file sono cotti in locale, sono interi', (_id, e) => {
		const mp4 = join(REPO, e.dir, 'preview.mp4');
		if (!existsSync(mp4)) return; // clone fresco: la prova è il manifesto, verificato sopra
		expect(statSync(mp4).size, `${e.id}: preview.mp4 troncato`).toBeGreaterThan(50_000);
		const dir = join(REPO, e.dir, 'stills');
		const png = existsSync(dir) ? readdirSync(dir) : [];
		for (const f of e.stills) {
			expect(png, `${e.id} frame ${f}`).toContain(`f-${String(f).padStart(4, '0')}.png`);
		}
	});

	it.each(each)('%s dice a quale domanda risponde, e il file lo mostra', (_id, e) => {
		expect(e.intent.length).toBeGreaterThan(40);
		const body = libraryFileBody(e);
		expect(body).toContain(e.intent);
		expect(body).toContain('preview.mp4');
		expect(body).toContain(e.code);
	});

	it("l'indice si legge per intento e resta corto", () => {
		const index = motionLibraryIndex();
		for (const e of MOTION_LIBRARY) {
			expect(index).toContain(e.intent);
			expect(index).toContain(e.id);
		}
		// La regola: se dopo l'indice bisogna aprire più di due voci per scegliere, la riga è
		// scritta male. Il tetto sul numero di righe è ciò che tiene onesta quella regola — il
		// difetto misurato è 1005 righe di ricettario per UNA ricetta usata su undici.
		expect(index.split('\n').filter(Boolean).length).toBeLessThanOrEqual(24);
		// Nessun codice nell'indice: il codice si apre una voce alla volta.
		expect(index).not.toContain('import React');
	});

	/**
	 * Nessuna cartella orfana DENTRO una sezione dichiarata: un `source.tsx` che il registro non
	 * vede è una voce che nessun agente potrà mai aprire, e nessuno se ne accorgerebbe.
	 *
	 * ponytail: il controllo è limitato alle sezioni dichiarate in `LIBRARY_SECTIONS` invece che a
	 * tutte le cartelle sul disco. Una sezione nuova arriva in due tempi — prima le cartelle, poi
	 * la riga che la nomina — e far fallire il test nel mezzo bloccherebbe chi la sta scrivendo
	 * senza dire niente di utile. Il costo dichiarato: una sezione mai dichiarata resta invisibile
	 * al registro in silenzio. Se succede, il posto dove si vede è `ls library/` contro
	 * `LIBRARY_SECTIONS`.
	 */
	it('ogni sorgente di una sezione dichiarata è nel registro (niente cartelle orfane)', () => {
		const root = join(REPO, 'src/lib/motion-video/library');
		const onDisk: string[] = [];
		for (const section of Object.keys(LIBRARY_SECTIONS)) {
			const dir = join(root, section);
			if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
			for (const slug of readdirSync(dir)) {
				if (existsSync(join(dir, slug, 'source.tsx'))) onDisk.push(`${section}/${slug}`);
			}
		}
		expect(onDisk.sort()).toEqual(MOTION_LIBRARY.map((e) => e.id).sort());
	});
});

/* ------------------------------------------------------------------------------------------------
 * IL CANCELLO SULL'IMPORT — quello che compilare non faceva, e che è costato due render.
 * ---------------------------------------------------------------------------------------------- */

const WRONG = `import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming, slide } from '@remotion/transitions';
export const fps = 30;
export const durationInFrames = 60;
export default function X() { return <AbsoluteFill />; }`;

describe('findUnexportedNamedImport', () => {
	it("rifiuta l'import che ha ucciso due render in produzione, e dice dove vive davvero", () => {
		const msg = findUnexportedNamedImport(WRONG);
		expect(msg).toBeTruthy();
		expect(msg).toContain('slide');
		expect(msg).toContain("'@remotion/transitions/slide'");
		// `TransitionSeries` e `linearTiming` escono davvero dalla radice: il rifiuto è sul nome
		// sbagliato, non sull'import intero.
		expect(msg).not.toContain('TransitionSeries');
	});

	it('compileMotionSource lo rifiuta: prima passava e moriva in VM', () => {
		expect(() => compileMotionSource(WRONG)).toThrow(/slide/);
	});

	it.each(['fade', 'wipe', 'clockWipe', 'flip', 'iris', 'none'])(
		'%s dalla radice è rifiutato con il suo sotto-percorso',
		(name) => {
			const src = `import { ${name} } from '@remotion/transitions';`;
			expect(findUnexportedNamedImport(src)).toContain('@remotion/transitions/');
		}
	);

	it('tace sugli import corretti — anche quelli delle voci della libreria', () => {
		expect(
			findUnexportedNamedImport(`import { slide } from '@remotion/transitions/slide';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { AbsoluteFill, spring, interpolate, Easing, Series, Img, random } from 'remotion';`)
		).toBeNull();
		for (const e of MOTION_LIBRARY) expect(findUnexportedNamedImport(e.code), e.id).toBeNull();
	});
});

/* ------------------------------------------------------------------------------------------------
 * IL CONTROLLO ARITMETICO — due numeri, e deve funzionare su ENTRAMBE le forme di sorgente.
 * ---------------------------------------------------------------------------------------------- */

const head = `import React from 'react';
import { AbsoluteFill, Series, Sequence } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
export const fps = 30;
const A: React.FC = () => <AbsoluteFill />;
`;

describe('findDurationMismatch', () => {
	it('vede la coda nera in una <Series>', () => {
		const src = `${head}export const durationInFrames = 300;
export default function X() { return (<Series><Series.Sequence durationInFrames={90}><A /></Series.Sequence><Series.Sequence durationInFrames={120}><A /></Series.Sequence></Series>); }`;
		const m = findDurationMismatch(src)!;
		expect(m.form).toBe('series');
		expect(m.coveredFrames).toBe(210);
		expect(m.gapFrames).toBe(90);
		expect(formatDurationMismatch(m)).toContain('NEL NERO');
	});

	it("in una <TransitionSeries> l'overlap si conta UNA volta sola", () => {
		// 90 + 90 - 18 = 162. Chi somma e basta scrive 180 e taglia gli ultimi 18 fotogrammi.
		const ok = `${head}export const durationInFrames = 162;
export default function X() { return (<TransitionSeries><TransitionSeries.Sequence durationInFrames={90}><A /></TransitionSeries.Sequence><TransitionSeries.Transition timing={linearTiming({ durationInFrames: 18 })} /><TransitionSeries.Sequence durationInFrames={90}><A /></TransitionSeries.Sequence></TransitionSeries>); }`;
		expect(findDurationMismatch(ok)).toBeNull();
		const bad = ok.replace('durationInFrames = 162', 'durationInFrames = 180');
		const m = findDurationMismatch(bad)!;
		expect(m.form).toBe('transition-series');
		expect(m.gapFrames).toBe(18);
	});

	it('sulle <Sequence> sciolte la copertura è il massimo di from + durata, non la somma', () => {
		const src = `${head}export const durationInFrames = 200;
export default function X() { return (<AbsoluteFill><Sequence durationInFrames={120}><A /></Sequence><Sequence from={60} durationInFrames={140}><A /></Sequence></AbsoluteFill>); }`;
		expect(findDurationMismatch(src)).toBeNull(); // 60 + 140 = 200
	});

	/**
	 * LA FORMA CHE CONTA DAVVERO: 16 sorgenti su 24 in produzione non hanno NESSUN tag
	 * `<Sequence>` — sono `<AbsoluteFill>` accesi da guardie nominate. Due cancelli di questo
	 * repo erano già stati scritti indicizzando sui tag, ed erano spenti proprio qui.
	 */
	it('vede il nero anche sui sorgenti a guardie, senza nessun tag Sequence', () => {
		const src = `import React from 'react';
import { AbsoluteFill, interpolate, Easing, useCurrentFrame } from 'remotion';
export const fps = 30;
export const durationInFrames = 485;
const Beat: React.FC = () => { const frame = useCurrentFrame(); const y = interpolate(frame, [0, 410], [0, 40], { easing: Easing.ease }); return <AbsoluteFill style={{ top: y }} />; };
export default function X() {
	const frame = useCurrentFrame();
	const s1Active = frame >= 0 && frame < 200;
	const s2Active = frame >= 200 && frame < 410;
	return (<AbsoluteFill>{s1Active && <Beat />}{s2Active && <Beat />}</AbsoluteFill>);
}`;
		const m = findDurationMismatch(src)!;
		expect(m.form).toBe('guards');
		expect(m.coveredFrames).toBe(410);
		expect(m.gapFrames).toBe(75); // i 2,5 secondi di nero che il giudice ha nominato
	});

	it('tace quando la copertura non si legge — un falso positivo qui rifiuta un finish buono', () => {
		const unreadable = `${head}export const durationInFrames = 300;
export default function X() { return (<Series><Series.Sequence durationInFrames={beatFor(props)}><A /></Series.Sequence></Series>); }`;
		expect(findDurationMismatch(unreadable)).toBeNull();
		// Nessuna struttura leggibile: un solo componente guidato dal frame copre tutto per
		// costruzione, e il difetto lì è la stasi, non l'aritmetica.
		expect(findDurationMismatch(`${head}export const durationInFrames = 300;
export default function X() { return <A />; }`)).toBeNull();
	});
});


/* ------------------------------------------------------------------------------------------------
 * IL FONDALE CONGELATO — la sola metà decidibile di «una UI non è uno sfondo».
 * ---------------------------------------------------------------------------------------------- */

describe('findFrozenBackplate', () => {
	const frozen = `import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
export default function X() {
	return (
		<AbsoluteFill>
			<Img src="https://x/app.png" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
		</AbsoluteFill>
	);
}`;

	it('vede lo screenshot a tutta tela che non si muove', () => {
		const v = findFrozenBackplate(frozen);
		expect(v).toHaveLength(1);
		expect(v[0].tag).toBe('Img');
		// Il rifiuto porta ENTRAMBE le correzioni: il ken burns se è una foto, la ricostruzione in
		// TSX se è un'interfaccia. Il codice non può distinguerle, quindi le dice tutte e due.
		const msg = formatFrozenBackplate(v);
		expect(msg).toContain('ken burns');
		expect(msg).toContain('DENTRO');
	});

	it("tace quando il fondale ha un movimento suo — è la forma di SCRIM_PLATE", () => {
		const moving = frozen.replace(
			"objectFit: 'cover'",
			"objectFit: 'cover', transform: 'scale(' + kenburns + ')'"
		);
		expect(findFrozenBackplate(moving)).toEqual([]);
	});

	it('tace su un <Img> dentro una card: non è un fondale a tutta tela', () => {
		const inCard = `import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
export default function X() {
	return (
		<AbsoluteFill>
			<div style={{ width: 620, height: 860, overflow: 'hidden' }}>
				<Img src="https://x/a.jpg" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
			</div>
		</AbsoluteFill>
	);
}`;
		expect(findFrozenBackplate(inCard)).toEqual([]);
	});
});

/* ------------------------------------------------------------------------------------------------
 * GLI ACCENTI — un refuso in una voce si moltiplica, e in una stringa rompe il build.
 * ---------------------------------------------------------------------------------------------- */

describe('accenti', () => {
	/**
	 * PERCHÉ VALE UN TEST, e non «basta guardare». Lo stesso vizio ha colpito due volte in un
	 * pomeriggio: «gia» senza accento dentro un fotogramma renderizzato — che si moltiplica,
	 * perché queste voci esistono per essere COPIATE — e un `c'è` dentro una stringa a virgolette
	 * singole in `library/index.ts`, che ha rotto il dev server. Due sintomi, una disattenzione.
	 *
	 * ponytail: elenco chiuso di parole invece di un pattern generico. `[a-z]'` prenderebbe ogni
	 * stringa a virgolette singole che finisce per vocale, cioè quasi tutte, e un controllo che dà
	 * falsi allarmi viene spento — è già successo due volte in questo repo. Il costo dichiarato:
	 * una parola tronca fuori elenco non si vede. Si aggiunge quando capita.
	 */
	const APOSTROFO = ['perche','poiche','finche','cioe','gia','piu','puo','cosi','pero','citta',
		'qualita','verita','liberta','novita','volonta','velocita','profondita','unita','identita',
		'lunedi','martedi','mercoledi','giovedi','venerdi','caffe','e','li','la','si','sara','fara','meta'];
	/** Sempre sbagliate anche senza apostrofo: non esiste una parola italiana che si scriva così. */
	const NUDE = ['perche','poiche','finche','cioe','gia','piu','puo','cosi','pero','citta',
		'qualita','verita','liberta','novita','volonta','velocita','profondita','unita','identita',
		'lunedi','martedi','mercoledi','giovedi','venerdi','caffe'];

	const apo = new RegExp(`(?<![\\w])(${APOSTROFO.join('|')})'(?![\\w])`, 'gi');
	const nude = new RegExp(`\\b(${NUDE.join('|')})\\b`, 'gi');

	it.each(each)("%s scrive gli accenti accentati, ovunque", (_id, e) => {
		const lines = e.code.split('\n');
		const bad: string[] = [];
		lines.forEach((l, i) => {
			if (l.includes('https://')) return;
			for (const m of [...l.matchAll(apo), ...l.matchAll(nude)]) {
				bad.push(`riga ${i + 1}: "${m[0]}" in ${l.trim().slice(0, 70)}`);
			}
		});
		expect(bad, bad.join('\n')).toEqual([]);
	});

	it("l'indice e le righe di intento fanno lo stesso", () => {
		const text = motionLibraryIndex();
		const bad = [...text.matchAll(apo), ...text.matchAll(nude)].map((m) => m[0]);
		expect(bad, `nell'indice: ${bad.join(', ')}`).toEqual([]);
	});
});
