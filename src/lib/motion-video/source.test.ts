import { describe, expect, it } from 'vitest';
import {
	MOTION_ASPECTS,
	MOTION_DURATION_PRESETS,
	defaultMotionSource,
	isMotionAspectRatio,
	motionAspectFromSize,
	motionDurationSeconds,
	motionFramesForDuration,
	formatMotionDurationPreset,
	motionRemakeTitle,
	motionSizeForAspect,
	otherMotionAspects,
	parseMotionAspectRatio,
	parseMotionDuration
} from './source';
import { compileMotionSource } from './compile';

describe('motion-video aspect', () => {
	it('allows only 1:1, 9:16, and 16:9', () => {
		expect([...MOTION_ASPECTS]).toEqual(['1:1', '9:16', '16:9']);
		expect(isMotionAspectRatio('4:5')).toBe(false);
		expect(isMotionAspectRatio('9:16')).toBe(true);
		expect(parseMotionAspectRatio('4:5')).toBe('1:1');
		expect(parseMotionAspectRatio('16:9')).toBe('16:9');
		expect(parseMotionAspectRatio(undefined, '9:16')).toBe('9:16');
	});

	it('maps each aspect to a Remotion canvas', () => {
		expect(motionSizeForAspect('1:1')).toEqual({ width: 1080, height: 1080 });
		expect(motionSizeForAspect('9:16')).toEqual({ width: 1080, height: 1920 });
		expect(motionSizeForAspect('16:9')).toEqual({ width: 1920, height: 1080 });
	});

	it('recovers aspect from stored width/height', () => {
		expect(motionAspectFromSize(1080, 1080)).toBe('1:1');
		expect(motionAspectFromSize(1080, 1920)).toBe('9:16');
		expect(motionAspectFromSize(1920, 1080)).toBe('16:9');
		expect(motionAspectFromSize(2160, 3840)).toBe('9:16');
	});

	it('lists the other remake aspects and suffixes titles', () => {
		expect(otherMotionAspects('1:1')).toEqual(['9:16', '16:9']);
		expect(otherMotionAspects('9:16')).toEqual(['1:1', '16:9']);
		expect(motionRemakeTitle('Launch ad', '9:16')).toBe('Launch ad · 9:16');
		expect(motionRemakeTitle('Launch ad · 1:1', '16:9')).toBe('Launch ad · 16:9');
	});

	it('seeds 9:16 and 16:9 compositions', () => {
		const portrait = defaultMotionSource({ brandName: 'Acme', aspectRatio: '9:16' });
		expect(portrait).toContain('export const width = 1080;');
		expect(portrait).toContain('export const height = 1920;');
		expect(portrait).toContain('Kinetic 9:16');
		expect(compileMotionSource(portrait)).toMatchObject({ width: 1080, height: 1920 });

		const landscape = defaultMotionSource({ brandName: 'Acme', aspectRatio: '16:9' });
		expect(compileMotionSource(landscape)).toMatchObject({ width: 1920, height: 1080 });
	});
});

describe('motion-video duration', () => {
	it('defaults to auto and maps presets to frames at 30fps', () => {
		expect([...MOTION_DURATION_PRESETS]).toEqual(['auto', '6', '8', '10', '15', '30', '60', '90']);
		expect(parseMotionDuration(undefined)).toBe('auto');
		expect(parseMotionDuration('12')).toBe('auto');
		expect(parseMotionDuration(15)).toBe('15');
		expect(parseMotionDuration(90)).toBe('90');
		expect(motionDurationSeconds('auto')).toBeNull();
		expect(motionDurationSeconds('10')).toBe(10);
		expect(motionDurationSeconds('90')).toBe(90);
		expect(motionFramesForDuration('auto')).toBe(180);
		expect(motionFramesForDuration('15')).toBe(450);
		expect(motionFramesForDuration('60')).toBe(1800);
		expect(motionFramesForDuration('90')).toBe(2700);
		expect(formatMotionDurationPreset('6')).toBe('6s');
		expect(formatMotionDurationPreset('60')).toBe('1m');
		expect(formatMotionDurationPreset('90')).toBe('1m:30');
	});

	it('seeds explicit duration and keeps 6s on auto', () => {
		const auto = defaultMotionSource({ brandName: 'Acme' });
		expect(compileMotionSource(auto)).toMatchObject({ fps: 30, durationInFrames: 180 });

		const long = defaultMotionSource({ brandName: 'Acme', duration: '15' });
		expect(long).toContain('export const durationInFrames = 450; // 15s');
		expect(compileMotionSource(long)).toMatchObject({ fps: 30, durationInFrames: 450 });

		const minute = defaultMotionSource({ brandName: 'Acme', duration: '60' });
		expect(minute).toContain('export const durationInFrames = 1800; // 1m');
		expect(compileMotionSource(minute)).toMatchObject({ fps: 30, durationInFrames: 1800 });

		const minuteThirty = defaultMotionSource({ brandName: 'Acme', duration: '90' });
		expect(minuteThirty).toContain('export const durationInFrames = 2700; // 1m:30');
		expect(compileMotionSource(minuteThirty)).toMatchObject({ fps: 30, durationInFrames: 2700 });
	});
});

/**
 * IL SEME DEVE PASSARE I CANCELLI CHE INSEGNA.
 *
 * Il seme è il primo codice che il modello legge e l'unico che imita davvero: le craft specs
 * chiedevano «one beat = one Sequence» mentre il seme non ne aveva NESSUNA, e in produzione 8
 * video su 24 sono usciti nella forma del seme, non in quella del prompt. Un seme che non
 * passasse i propri controlli insegnerebbe il difetto due volte.
 */
describe('il seme contro i cancelli del prodotto', () => {
	it('ha una Sequence per battuta — la forma che rende il tempo locale vero per costruzione', async () => {
		// Si guarda il sorgente come lo guardano i cancelli: senza commenti. Il seme SPIEGA la
		// forma sbagliata in un commento, e un test che non spoglia il codice conterebbe quella.
		const { stripNonCode } = await import('./easing');
		const code = stripNonCode(defaultMotionSource({ brandName: 'Acme' }));
		expect(code.match(/<Series\.Sequence\b/g)).toHaveLength(3);
		// E NESSUNA guardia sul fotogramma assoluto: è la forma che non sopravvive alla
		// fattorizzazione, ed è da qui che il modello la imparava.
		expect(code).not.toMatch(/frame\s*(?:>=|>)\s*[\w$.]+\s*&&\s*frame\s*(?:<=|<)/);
	});

	it('nessun movimento lineare, a ogni durata', async () => {
		const { findLinearMotion } = await import('./easing');
		for (const preset of ['6', '15', '90'] as const) {
			const seed = defaultMotionSource({ brandName: 'Acme', duration: preset });
			expect(findLinearMotion(seed), preset).toEqual([]);
		}
	});

	it('nessuna battuta con la coda ferma — CTA compresa, che è dove il difetto vive', async () => {
		const { findStaticTails } = await import('./easing');
		const seed = defaultMotionSource({ brandName: 'Acme' });
		expect(findStaticTails(seed)).toEqual([]);
	});

	it('compila e riempie il canvas a ogni aspetto', () => {
		for (const aspect of ['1:1', '9:16', '16:9'] as const) {
			const seed = defaultMotionSource({ brandName: 'Acme', aspectRatio: aspect });
			expect(() => compileMotionSource(seed), aspect).not.toThrow();
		}
	});
});
