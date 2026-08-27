import { describe, it, expect } from 'vitest';
import { motionBeats } from './beats';
import { defaultMotionSource } from './source';

describe('motionBeats — un fotogramma per scena, non uno ogni tot secondi', () => {
	it('legge le scene di una <Series> e le mette in fila', () => {
		const src = `
export const durationInFrames = 300;
export default function V() {
	return (
		<Series>
			<Series.Sequence durationInFrames={90}><A /></Series.Sequence>
			<Series.Sequence durationInFrames={120}><B /></Series.Sequence>
			<Series.Sequence durationInFrames={90}><C /></Series.Sequence>
		</Series>
	);
}`;
		const beats = motionBeats(src, 300);
		expect(beats.map((b) => b.startFrame)).toEqual([0, 90, 210]);
		// 55% dentro la battuta: dopo l'entrata, prima dell'uscita.
		expect(beats.map((b) => b.frame)).toEqual([50, 156, 260]);
	});

	it('la transizione di una TransitionSeries accorcia la timeline — le scene dopo non slittano', () => {
		const src = `
export default function V() {
	return (
		<TransitionSeries>
			<TransitionSeries.Sequence durationInFrames={90}><A /></TransitionSeries.Sequence>
			<TransitionSeries.Transition presentation={slide()} timing={linearTiming({ durationInFrames: 20 })} />
			<TransitionSeries.Sequence durationInFrames={90}><B /></TransitionSeries.Sequence>
		</TransitionSeries>
	);
}`;
		const beats = motionBeats(src, 160);
		// senza il conto della transizione la seconda scena partirebbe a 90, non a 70
		expect(beats.map((b) => b.startFrame)).toEqual([0, 70]);
	});

	it('rispetta offset negativi e <Sequence from=…>', () => {
		const overlap = `
			<Series>
				<Series.Sequence durationInFrames={60}><A /></Series.Sequence>
				<Series.Sequence durationInFrames={60} offset={-15}><B /></Series.Sequence>
			</Series>`;
		expect(motionBeats(overlap, 120).map((b) => b.startFrame)).toEqual([0, 45]);

		const absolute = `
			<AbsoluteFill>
				<Sequence from={0} durationInFrames={60}><A /></Sequence>
				<Sequence from={60} durationInFrames={60}><B /></Sequence>
			</AbsoluteFill>`;
		expect(motionBeats(absolute, 120).map((b) => b.startFrame)).toEqual([0, 60]);
	});

	it('risolve le durate scritte come costanti, che è come le scrive davvero il modello', () => {
		const src = `
const fps = 30;
const BEAT = fps * 3;
export default function V() {
	return (
		<Series>
			<Series.Sequence durationInFrames={BEAT}><A /></Series.Sequence>
			<Series.Sequence durationInFrames={BEAT}><B /></Series.Sequence>
		</Series>
	);
}`;
		expect(motionBeats(src, 180).map((b) => b.startFrame)).toEqual([0, 90]);
	});

	it('nessun fotogramma cade fuori dalla clip', () => {
		const src = `
			<Series>
				<Series.Sequence durationInFrames={500}><A /></Series.Sequence>
			</Series>`;
		const [beat] = motionBeats(src, 100);
		expect(beat.frame).toBeLessThan(100);
		expect(beat.frame).toBeGreaterThanOrEqual(0);
	});

	it('legge le scene scritte a mano — la forma che il modello usa davvero in produzione', () => {
		// Sonda su un trailer vero (22/8/2026): zero <Sequence>, sei battute fatte di
		// `frame >= A && frame < B`. Prima questo sorgente tornava vuoto e lo storyboard
		// ripiegava sullo spargimento, saltando apertura e CTA.
		const gated = `
export const durationInFrames = 540;
export default function V() {
	const frame = useCurrentFrame();
	return (
		<AbsoluteFill>
			{frame < 92 && <Hook />}
			{frame >= 82 && frame < 172 && <Stall />}
			{frame >= 162 && frame < 270 && <Chat />}
			{frame >= 256 && frame < 364 && <Calendar />}
			{frame >= 350 && frame < 450 && <Plan />}
			{frame >= 436 && <Cta />}
		</AbsoluteFill>
	);
}`;
		const beats = motionBeats(gated, 540);
		// Sei battute: le quattro con la coppia, più l'apertura e la CTA che esistono per
		// costruzione — e che sono i due secondi che decidono tutto.
		expect(beats.map((b) => b.startFrame)).toEqual([0, 82, 162, 256, 350, 450]);
		// Ogni fotogramma cade dentro la sua battuta, non su un confine.
		for (const b of beats) {
			expect(b.frame).toBeGreaterThan(b.startFrame);
			expect(b.frame).toBeLessThan(b.startFrame + b.durationInFrames);
		}
	});

	it('una condizione a un lato solo non è una scena', () => {
		// `frame > 60` da solo è l'opacità di un accento, non un confine: prenderlo per tale
		// sposterebbe ogni fotogramma dopo di lui.
		const loose = `
			<AbsoluteFill>
				{frame > 60 && <Accent />}
				{frame < 200 && <Other />}
			</AbsoluteFill>`;
		expect(motionBeats(loose, 300)).toEqual([]);
	});

	it('vuoto quando il sorgente non dichiara scene leggibili — meglio niente che la scena sbagliata', () => {
		expect(motionBeats('export default function V() { return <AbsoluteFill />; }', 180)).toEqual([]);
		// Una durata che non si risolve (viene da una prop) non si indovina.
		expect(
			motionBeats('<Series><Series.Sequence durationInFrames={props.len}><A /></Series.Sequence></Series>', 180)
		).toEqual([]);
	});

	/**
	 * IL SEME HA LE SCENE, e prima del 22/8/2026 non le aveva.
	 *
	 * Questo test diceva l'opposto — «il seme è una composizione a frame, lo storyboard deve dire
	 * non lo so» — ed era vero: `Sequence|Series` compariva ZERO volte in `source.ts`, dieci
	 * `<AbsoluteFill>` pilotati dall'aritmetica sul fotogramma assoluto. Il seme è il documento più
	 * letto del sistema, e il modello imitava lui e non il prompt: 8 video su 24 in produzione
	 * erano scritti in quella forma, compreso il trailer bocciato 3,5.
	 *
	 * La forma non era sbagliata in sé — dentro UN componente solo, l'aritmetica assoluta è
	 * corretta. Non sopravviveva alla FATTORIZZAZIONE, che è il passo che chiunque fa: estratto
	 * `CtaBeat`, il componente continua a ricevere il fotogramma assoluto mentre chi lo scrive
	 * pensa in locale, e l'entrata risulta già finita quando la scena appare.
	 *
	 * Ora ogni battuta è una `<Series.Sequence>`: il tempo locale è vero per costruzione, e
	 * fattorizzare è sicuro invece che letale.
	 */
	it('le tre battute del seed si leggono, e coprono esattamente la composizione', () => {
		const seed = defaultMotionSource({ brandName: 'Demo' });
		const beats = motionBeats(seed, 180);
		expect(beats).toHaveLength(3);
		expect(beats.map((b) => b.startFrame)).toEqual([0, 48, 102]);
		// Nessun buco e nessuna coda: l'ultima battuta chiude l'aritmetica su durationInFrames.
		const last = beats[beats.length - 1]!;
		expect(last.startFrame + last.durationInFrames).toBe(180);
		for (const b of beats) {
			expect(b.frame).toBeGreaterThanOrEqual(b.startFrame);
			expect(b.frame).toBeLessThan(b.startFrame + b.durationInFrames);
		}
	});

	it('il seme resta leggibile a ogni durata offerta dal picker', () => {
		for (const preset of ['6', '15', '60', '90'] as const) {
			const seed = defaultMotionSource({ brandName: 'Demo', duration: preset });
			const total = Number(preset) * 30;
			const beats = motionBeats(seed, total);
			expect(beats, preset).toHaveLength(3);
			const last = beats[beats.length - 1]!;
			expect(last.startFrame + last.durationInFrames, preset).toBe(total);
		}
	});
});
