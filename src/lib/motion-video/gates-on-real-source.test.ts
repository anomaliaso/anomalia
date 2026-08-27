import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findDeadEntrances, findLinearMotion, findStaticTails, formatDeadEntrances } from './easing';
import { detectWowMechanisms } from './transitions-cookbook';
import { motionBeats } from './beats';
import { compileMotionSource } from './compile';
import { findVoiceAudioRefs } from './voice-gate';
import { motionSourceFindings } from '$lib/server/motion-video/storyboard';

/**
 * OGNI CANCELLO, CONTRO UN SORGENTE VERO.
 *
 * Il fixture è il TSX in produzione del trailer `c1b4fe72` del 22/8/2026 — 18 secondi, verticale,
 * bocciato dalla QC **3,5/10 `kill`** con «transizioni rotte» e «due secondi di nero morto prima
 * della CTA». Non è scritto a mano per questo test: è quello che il modello ha davvero prodotto.
 *
 * Serve perché quel giorno abbiamo scoperto che DUE cancelli su quattro erano **spenti** su questa
 * classe di sorgente, e nessun test lo diceva. Il motivo è sempre lo stesso: il ricettario insegna
 * `<Series.Sequence>`, e questo file non ne ha NEMMENO UNA — sono `<AbsoluteFill>` accesi da
 * guardie nominate sul frame (`const s2Active = frame >= 82 && frame < 172`). Chi legge solo i tag
 * non legge niente, e tacere sembra passare.
 *
 * La regola di questo file: un cancello che su questo sorgente non trova quello che il giudice ci
 * ha trovato è un cancello spento, e il test lo dice qui invece che il prossimo video in
 * produzione.
 */
const SOURCE = readFileSync(
	fileURLToPath(new URL('./__fixtures__/trailer-3-5.tsx.txt', import.meta.url)),
	'utf8'
);
const FPS = 30;
const DURATION = 540;

describe('i cancelli contro il trailer 3,5 — nessuno deve tacere', () => {
	it('il fixture è il sorgente vero, e compila', () => {
		expect(SOURCE.length).toBeGreaterThan(15_000);
		// Zero sequenze: è ESATTAMENTE la forma su cui i cancelli erano ciechi. Se un giorno questo
		// fallisce, qualcuno ha sostituito il fixture con un file che non prova più niente.
		expect(SOURCE).not.toMatch(/<(?:Transition)?Series\.Sequence\b/);
		expect(SOURCE).not.toMatch(/<Sequence\b/);
		expect(() => compileMotionSource(SOURCE)).not.toThrow();
	});

	it('motionBeats trova le sei scene, non zero', () => {
		const beats = motionBeats(SOURCE, DURATION);
		expect(beats).toHaveLength(6);
		// I confini veri, letti dalle guardie: 0 / 82 / 162 / 256 / 350 / 450.
		expect(beats.map((b) => b.startFrame)).toEqual([0, 82, 162, 256, 350, 450]);
		// Ogni fotogramma dello storyboard cade DENTRO la sua scena — apertura e CTA comprese, che
		// sono i due secondi che decidono se qualcuno guarda e se qualcuno clicca.
		for (const b of beats) {
			expect(b.frame).toBeGreaterThanOrEqual(b.startFrame);
			expect(b.frame).toBeLessThan(b.startFrame + b.durationInFrames);
		}
	});

	it('findStaticTails vede la scena ferma che il giudice ha nominato', () => {
		// Prima del 22/8 questo tornava [] su QUALUNQUE sorgente scritto così: `hosted` si
		// riempiva solo dai tag `<Sequence>`, quindi restava vuoto e la funzione usciva senza
		// guardare niente. «Nessuna scena deve essere statica, mai» non aveva mai visto un video.
		const stalls = findStaticTails(SOURCE);
		expect(stalls.length).toBeGreaterThan(0);
		const overview = stalls.find((s) => s.component === 'OverviewBeat');
		expect(overview, 'la scena che si congela per ~2,9s').toBeTruthy();
		expect(overview!.gapFrames / FPS).toBeGreaterThan(2);
	});

	it('detectWowMechanisms conta le battute — il cancello 4+ deve potersi accendere', () => {
		// Contava 0, quindi la soglia «4 o più battute» non scattava mai e i cinque marcatori
		// `// wow:` di questo file non li ha verificati nessuno.
		const wow = detectWowMechanisms(SOURCE);
		expect(wow.beats).toBeGreaterThanOrEqual(4);
		// E i meccanismi ci sono davvero, marcatori a parte: questa è la metà che funzionava.
		expect(wow.fullCanvasScale).toBe(true);
		expect(wow.sharedElement).toBe(true);
	});

	it('findLinearMotion tace, e ha ragione: 44 interpolate, 44 easing', () => {
		// Il controllo che NON era spento. Sta qui perché un test che verifica solo i cancelli
		// rotti non distingue «funziona» da «non l'abbiamo guardato».
		expect(findLinearMotion(SOURCE)).toEqual([]);
	});

	it('il video è muto, e adesso qualcuno lo dice prima del render', () => {
		// Il gate sulla voce guarda il PIAZZAMENTO della voce che esiste: senza un solo <Audio>
		// esce con voiced:false e non dice niente. Su questo trailer significava consegnare un
		// video muto senza che nessun controllo lo nominasse.
		expect(findVoiceAudioRefs(SOURCE)).toHaveLength(0);
		expect(motionSourceFindings(SOURCE, FPS).join(' ')).toContain('MUTO');
	});

	it('il referto completo che l’agente riceve nomina la stasi E il silenzio', () => {
		const findings = motionSourceFindings(SOURCE, FPS).join(' ');
		expect(findings).toContain('FERMA');
		expect(findings).toContain('MUTO');
		// Su questo file i meccanismi wow ci sono, quindi quella riga NON deve comparire: un
		// referto che si lamenta sempre è un referto che nessuno legge.
		expect(findings).not.toContain('TRANSITIONS COOKBOOK');
	});
	/**
	 * L'ENTRATA MORTA — il difetto per cui il giudice ha visto fotogrammi congelati e ha dato la
	 * colpa alla cosa sbagliata («due secondi di nero»).
	 *
	 * Il file dichiara `s2Local = frame - 82` e altre quattro come lei, e NON NE USA NESSUNA: le
	 * battute ricevono il fotogramma assoluto mentre dentro sono scritte in locale. Quando la
	 * scena compare, la sua animazione è già finita.
	 */
	it('findDeadEntrances nomina OverviewBeat — la stessa scena che la stasi e lo storyboard indicano', () => {
		// La prova che il difetto è davvero nel file: cinque `sNLocal` dichiarate, zero usate.
		expect(SOURCE.match(/const s\dLocal = frame - \d+;/g)!.length).toBeGreaterThanOrEqual(4);

		const dead = findDeadEntrances(SOURCE);
		const overview = dead.find((d) => d.component === 'OverviewBeat');
		expect(overview).toBeDefined();
		expect(overview!.guard).toBe('s3Active');
		expect(overview!.mountFrame).toBe(162);
		// `iris` è scritta su [0, 22]: la rivelazione è finita 140 fotogrammi prima che la scena
		// esista. È il motivo per cui quel taglio si legge come secco e quel fotogramma è fermo.
		expect(overview!.variable).toBe('iris');
		expect(overview!.lastActiveFrame).toBeLessThan(overview!.mountFrame);

		// LE TRE LETTURE CONVERGONO. Stasi, storyboard ed entrata morta arrivano a OverviewBeat da
		// direzioni diverse: se un giorno una delle tre smette di nominarlo, è quella ad essersi
		// rotta, non il video ad essere guarito.
		expect(findStaticTails(SOURCE).some((v) => v.component === 'OverviewBeat')).toBe(true);

		// Il referto deve dire dove guardare e cosa fare, non solo che qualcosa non va.
		const report = formatDeadEntrances(dead);
		expect(report).toContain('OverviewBeat');
		expect(report).toContain('162');
		expect(report).toContain('<Series.Sequence');
	});

	/**
	 * IL PUNTO CIECO, dichiarato invece che scoperto dal prossimo video.
	 *
	 * `CtaEndCard` è l'entrata morta PEGGIORE del file — monta al fotogramma 436 con range che
	 * finiscono entro il 104, cioè 3,5 secondi di fermo immagine — e il controllo TACE su di lei.
	 * Il motivo è la politica di questo file: una delle sue interpolate è scritta su `[0, len]`,
	 * dove `len` è una PROP passata al montaggio (`<CtaEndCard len={104} />`). Un range che non si
	 * risolve rende il componente non giudicabile, e il silenzio è preferito a un rifiuto
	 * inventato che brucerebbe una slice.
	 *
	 * ponytail: il passo successivo, se questi casi diventano frequenti, è risolvere le prop
	 * numeriche dal sito di montaggio (~8 righe). Non fatto ora perché la stessa `unresolved`
	 * governa anche `findStaticTails`, e cambiarla sposterebbe i rifiuti di stasi in un file che
	 * un altro lavoro sta toccando.
	 */
	it('tace su CtaEndCard, e il motivo è una prop non risolvibile — non un difetto assente', () => {
		expect(findDeadEntrances(SOURCE).some((d) => d.component === 'CtaEndCard')).toBe(false);
		expect(SOURCE).toContain('<CtaEndCard len={104} />');
		expect(SOURCE).toMatch(/interpolate\(frame, \[0, len\]/);
	});

	it('non accusa una battuta scritta in assoluto, che è corretta', () => {
		// Stessa forma a guardia, ma i range sono ASSOLUTI come il clock: niente da dire.
		const honest = `
export const fps = 30;
const Beat = () => {
	const frame = useCurrentFrame();
	const y = interpolate(frame, [82, 172], [0, 40], { easing: EXPO });
	return <div style={{ top: y }} />;
};
export default function V() {
	const frame = useCurrentFrame();
	const active = frame >= 82 && frame < 172;
	return <AbsoluteFill>{active && <Beat />}</AbsoluteFill>;
}`;
		expect(findDeadEntrances(honest)).toEqual([]);
	});

	it('tace su una battuta montata da una Sequence — lì il tempo locale è vero', () => {
		const correct = `
export const fps = 30;
const BEAT = 90;
const Beat = () => {
	const frame = useCurrentFrame();
	const y = interpolate(frame, [0, BEAT], [0, 40], { easing: EXPO });
	return <div style={{ top: y }} />;
};
export default function V() {
	return <Series><Series.Sequence durationInFrames={BEAT}><Beat /></Series.Sequence></Series>;
}`;
		expect(findDeadEntrances(correct)).toEqual([]);
	});
});
