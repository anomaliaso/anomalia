/**
 * Il contratto del ricettario: ogni voce COMPILA cosi' com'e' (un ricettario con una ricetta
 * rotta e' peggio di nessun ricettario), l'euristica riconosce i propri stessi snippet, e le
 * craft specs nominano ogni voce (altrimenti la regola cita codice che l'agente non vede).
 */
import { describe, expect, it } from 'vitest';
import { compileMotionSource } from './compile';
import { MOTION_CRAFT_SPECS } from './craft';
import { findLinearMotion, findStaticTails } from './easing';
import {
	MOTION_TRANSITIONS_COOKBOOK_PROMPT,
	TRANSITIONS_COOKBOOK,
	cookbookNameForMechanism,
	detectWowMechanisms
} from './transitions-cookbook';

describe('TRANSITIONS_COOKBOOK', () => {
	it.each(TRANSITIONS_COOKBOOK.map((e) => [e.name, e] as const))('%s compiles as-is', (_n, e) => {
		const compiled = compileMotionSource(e.code);
		expect(typeof compiled.component).toBe('function');
		expect(compiled.fps).toBe(30);
	});

	it('every entry carries its wow marker and a when-to-use line', () => {
		for (const e of TRANSITIONS_COOKBOOK) {
			expect(e.code).toContain(`// wow: ${e.name}`);
			expect(e.when.length).toBeGreaterThan(10);
		}
	});

	it('the prompt block and the craft specs both name every entry', () => {
		for (const e of TRANSITIONS_COOKBOOK) {
			expect(MOTION_TRANSITIONS_COOKBOOK_PROMPT).toContain(e.name);
			expect(MOTION_CRAFT_SPECS).toContain(e.name);
		}
	});
});

describe('detectWowMechanisms', () => {
	it('sees the full-canvas scale in its own snippet', () => {
		const code = TRANSITIONS_COOKBOOK.find((e) => e.name === 'FULL_CANVAS_SCALE')!.code;
		expect(detectWowMechanisms(code).fullCanvasScale).toBe(true);
	});

	it('sees the mask blow-up as a full-canvas scale', () => {
		const code = TRANSITIONS_COOKBOOK.find((e) => e.name === 'MASK_REVEAL_TYPE')!.code;
		expect(detectWowMechanisms(code).fullCanvasScale).toBe(true);
	});

	it('sees the shared element in the match-cut and carryover snippets', () => {
		for (const name of ['MATCH_CUT_DOT', 'ELEMENT_CARRYOVER']) {
			const code = TRANSITIONS_COOKBOOK.find((e) => e.name === name)!.code;
			expect(detectWowMechanisms(code).sharedElement, name).toBe(true);
		}
	});

	it('finds neither in an all-slide composition, and counts its beats', () => {
		const slideshow = `
import React from 'react';
import { TransitionSeries } from '@remotion/transitions';
export default function V() {
	return (
		<TransitionSeries>
			<TransitionSeries.Sequence durationInFrames={90}><div /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={90}><div /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={90}><div /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={90}><div /></TransitionSeries.Sequence>
		</TransitionSeries>
	);
}`;
		const wow = detectWowMechanisms(slideshow);
		expect(wow.beats).toBe(4);
		expect(wow.fullCanvasScale).toBe(false);
		expect(wow.sharedElement).toBe(false);
	});

	it('a cursor flying left/top inside a mockup does not count without the marker', () => {
		const cursor = `
const cx = interpolate(frame, [0, 30], [100, 800], { easing: E });
const el = <div style={{ left: cx + 'px', top: 200 }} />;`;
		expect(detectWowMechanisms(cursor).sharedElement).toBe(false);
	});

	it('sees the shrink-to-dot as BOTH a full-canvas move and a shared element', () => {
		const code = TRANSITIONS_COOKBOOK.find((e) => e.name === 'SCENE_SHRINK_TO_DOT')!.code;
		const wow = detectWowMechanisms(code);
		expect(wow.fullCanvasScale).toBe(true);
		expect(wow.sharedElement).toBe(true);
	});

	it('sees the word zoom as a full-canvas scale', () => {
		const code = TRANSITIONS_COOKBOOK.find((e) => e.name === 'WORD_ZOOM_CUT')!.code;
		expect(detectWowMechanisms(code).fullCanvasScale).toBe(true);
	});

	it('a watered-down scale (1 → 0.94) counts as NOTHING, marker or not', () => {
		// Il caso del 2026-08-21: l'agente cita la ricetta, mette il marker, e la "scala oltre la
		// camera" è un timido 1 → 0.94. Il marker senza il meccanismo non deve valere niente.
		const watered = `
// wow: FULL_CANVAS_SCALE
const zoom = interpolate(frame, [0, 30], [1, 0.94], { easing: E });
const el = <div style={{ transform: 'scale(' + zoom + ')' }} />;`;
		const wow = detectWowMechanisms(watered);
		expect(wow.fullCanvasScale).toBe(false);
		expect(wow.sharedElement).toBe(false);
	});

	it('a small pulsing badge (0.05 → 0.08) is not a shrink-to-dot', () => {
		const badge = `
const pulse = interpolate(frame, [0, 30], [0.05, 0.08], { easing: E });
const el = <div style={{ transform: 'scale(' + pulse + ')' }} />;`;
		expect(detectWowMechanisms(badge).fullCanvasScale).toBe(false);
	});

	it('a cargo-culted marker with only a cursor flight still does not count', () => {
		// Il caso visto dal vivo (2026-08-22): marker ELEMENT_CARRYOVER sul beat, ma l'unico volo
		// left/top era il cursore del mockup. Marker senza meccanismo = niente.
		const fake = `
// wow: ELEMENT_CARRYOVER & interactive tap cursor
const cursorX = interpolate(frame, [0, 30], [100, 800], { easing: E });
const cursorY = interpolate(frame, [0, 30], [1200, 600], { easing: E });
const el = <div style={{ left: cursorX + 'px', top: cursorY + 'px' }} />;`;
		expect(detectWowMechanisms(fake).sharedElement).toBe(false);
	});
});

describe('STAGGER_REVEAL — la ricetta e i gate che rifiutano la sua imitazione', () => {
	const real = TRANSITIONS_COOKBOOK.find((e) => e.name === 'STAGGER_REVEAL')!.code;

	it('è riconosciuta come meccanismo vero (stagger: true)', () => {
		expect(detectWowMechanisms(real).stagger).toBe(true);
	});

	it('passa i gate del moto: niente lineare, niente coda ferma', () => {
		expect(findLinearMotion(real)).toEqual([]);
		expect(findStaticTails(real)).toEqual([]);
	});

	it('sfalsamento a zero — tutti gli elementi insieme — non conta, marker o no', () => {
		// L'annacquamento tipico: la ricetta citata, il marker conservato, e STAG messo a 0.
		const watered = real.replace(
			'Math.min(0.35, Math.max(0.15, (BEAT * 0.5 - IN) / (N - 1)))',
			'0'
		);
		expect(watered).not.toBe(real);
		expect(detectWowMechanisms(watered).stagger).toBe(false);
	});

	it('il marker senza il codice dietro non vale niente', () => {
		const fake = `
// wow: STAGGER_REVEAL
const rise = interpolate(frame, [0, 18], [90, 0], { easing: E });`;
		expect(detectWowMechanisms(fake).stagger).toBe(false);
	});

	it('elementi che entrano e si fermano subito: bocciati dal rilevatore di stasi', () => {
		// L'altro annacquamento: la deriva di gruppo tolta — la cascata finisce e il beat resta immobile.
		const frozen = real.replace(
			'interpolate(frame, [0, BEAT * fps], [16, -16], { easing: EXPO, ...CLAMP })',
			'0'
		);
		expect(frozen).not.toBe(real);
		const violations = findStaticTails(frozen);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations[0].component).toBe('StaggerBeat');
	});

	it('le altre voci del ricettario non diventano stagger per sbaglio', () => {
		for (const e of TRANSITIONS_COOKBOOK) {
			if (e.name === 'STAGGER_REVEAL') continue;
			expect(detectWowMechanisms(e.code).stagger, e.name).toBe(false);
		}
	});
});

describe('cookbookNameForMechanism', () => {
	it('maps studied mechanisms onto cookbook names', () => {
		expect(cookbookNameForMechanism('the scene collapses into the logo dot')).toBe('MATCH_CUT_DOT');
		expect(cookbookNameForMechanism('la scena collassa e diventa un punto')).toBe('MATCH_CUT_DOT');
		expect(cookbookNameForMechanism('the price carries over and becomes the headline')).toBe(
			'ELEMENT_CARRYOVER'
		);
		expect(cookbookNameForMechanism('next scene revealed through the letters')).toBe(
			'MASK_REVEAL_TYPE'
		);
		expect(cookbookNameForMechanism('whole frame zooms past the camera')).toBe('FULL_CANVAS_SCALE');
		expect(cookbookNameForMechanism('layers at different speeds give depth')).toBe(
			'PUSH_ZOOM_PARALLAX'
		);
		expect(cookbookNameForMechanism('hard cut on the beat')).toBeNull();
	});

	it('maps the owner-named moves onto the new entries', () => {
		expect(cookbookNameForMechanism('la scena si rimpicciolisce fino a un punto')).toBe(
			'SCENE_SHRINK_TO_DOT'
		);
		expect(cookbookNameForMechanism('the scene shrinks down to a dot')).toBe('SCENE_SHRINK_TO_DOT');
		expect(cookbookNameForMechanism('a ticker of words scrolling behind a fixed line')).toBe(
			'WORD_SCROLL_TICKER'
		);
		expect(cookbookNameForMechanism('parole che scorrono come un nastro')).toBe(
			'WORD_SCROLL_TICKER'
		);
		expect(cookbookNameForMechanism('una parola zooma e diventa la scena dopo')).toBe(
			'WORD_ZOOM_CUT'
		);
		expect(cookbookNameForMechanism('lateral slide with inertia and overshoot')).toBe(
			'SLIDE_INERTIA'
		);
		expect(cookbookNameForMechanism('list items enter one after the other, staggered')).toBe(
			'STAGGER_REVEAL'
		);
		expect(cookbookNameForMechanism('le righe entrano sfalsate, a cascata')).toBe(
			'STAGGER_REVEAL'
		);
		// Le frasi storiche NON devono cambiare destinazione.
		expect(cookbookNameForMechanism('the scene collapses into the logo dot')).toBe('MATCH_CUT_DOT');
		expect(cookbookNameForMechanism('whole frame zooms past the camera')).toBe('FULL_CANVAS_SCALE');
	});
});
