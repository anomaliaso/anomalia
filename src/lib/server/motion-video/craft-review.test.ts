import { describe, expect, it } from 'vitest';
import {
	compactCraftReview,
	craftVerdictFromScores,
	finalizeCraftReview,
	formatCraftApplyBrief
} from './craft-review';
import { reviewNeedsRewrite } from '$lib/server/video-review-apply';
import { findStaticTails } from '$lib/motion-video/easing';
import { detectWowMechanisms } from '$lib/motion-video/transitions-cookbook';

describe('craftVerdictFromScores', () => {
	const ok = { craft: 8, content: 8, pleasant: 8, transitions: 8 };

	it('ships only when every dimension is solid', () => {
		expect(craftVerdictFromScores(ok, [], false).verdict).toBe('ship');
		expect(craftVerdictFromScores(ok, [], false).overall).toBeGreaterThanOrEqual(7);
	});

	it('kills broken or very weak transitions', () => {
		expect(craftVerdictFromScores(ok, [], true).verdict).toBe('kill');
		expect(
			craftVerdictFromScores({ ...ok, transitions: 3 }, [], false).verdict
		).toBe('kill');
	});

	it('fixes mid scores and critical issues', () => {
		expect(
			craftVerdictFromScores({ craft: 6, content: 7, pleasant: 7, transitions: 7 }, [], false)
				.verdict
		).toBe('fix');
		expect(craftVerdictFromScores(ok, [{ severity: 'critical' }], false).verdict).toBe('fix');
	});
});

describe('finalizeCraftReview', () => {
	it('owns overall and flags broken transitions', () => {
		const review = finalizeCraftReview(
			{
				transitions_broken: true,
				scores: { craft: 9, content: 9, pleasant: 9, transitions: 2 },
				issues: [
					{
						dimension: 'transitions',
						severity: 'critical',
						at_s: 1.2,
						problem: 'Hard cut at 1.2s',
						fix: 'Overlap a slide for 12 frames'
					}
				],
				weakest_link: 'transitions',
				next_test: 'Because transitions, add an iris clipPath.',
				summary: 'The cut pops.',
				judgment: 'Broken iris.'
			},
			6
		);
		expect(review.verdict).toBe('kill');
		expect(review.transitions_broken).toBe(true);
		expect(review.scores.transitions).toBe(2);
		expect(reviewNeedsRewrite(review)).toBe(true);
	});
});

describe('formatCraftApplyBrief', () => {
	it('asks the agent to patch Remotion craft before sellability', () => {
		const review = finalizeCraftReview(
			{
				transitions_broken: true,
				scores: { craft: 4, content: 6, pleasant: 5, transitions: 2 },
				issues: [
					{
						dimension: 'transitions',
						severity: 'critical',
						problem: 'Freeze then cut',
						fix: 'Carry the spring into the iris'
					}
				],
				next_test: 'Because transitions, overlap the outgoing scene.',
				summary: 'Cuts are broken.',
				judgment: 'Not shippable craft.'
			},
			6
		);
		const text = formatCraftApplyBrief(review);
		expect(text).toContain('MOTION CRAFT QC FAILED');
		expect(text).toContain('TRANSITIONS ARE BROKEN');
		expect(text).toContain('grep_source');
		expect(text).toContain('Carry the spring into the iris');
		expect(text).toContain('before any sellability');
	});
});

describe('compactCraftReview', () => {
	it('flags must_rewrite on kill', () => {
		const review = finalizeCraftReview(
			{
				transitions_broken: true,
				scores: { craft: 3, content: 3, pleasant: 3, transitions: 2 },
				issues: [],
				summary: 'Broken'
			},
			6
		);
		const compact = compactCraftReview(review);
		expect(compact.must_rewrite).toBe(true);
		expect(compact.verdict).toBe('kill');
		expect(compact.scores.transitions).toBe(2);
	});
});

describe('finalizeCraftReview — wow gate + legibility', () => {
	const cleanRaw = {
		transitions_broken: false,
		scores: { craft: 8, content: 8, pleasant: 8, transitions: 8 },
		issues: [],
		weakest_link: 'craft',
		next_test: 'n',
		summary: 's',
		judgment: 'j'
	};

	it('caps transitions and forces FIX on 4+ beats with zero wow mechanisms', () => {
		const review = finalizeCraftReview(cleanRaw, 12, {
			beats: 5,
			fullCanvasScale: false,
			sharedElement: false,
			stagger: false
		});
		expect(review.scores.transitions).toBe(5);
		expect(review.verdict).toBe('fix');
		expect(review.issues[0]?.dimension).toBe('transitions');
		expect(review.issues[0]?.fix).toContain('MATCH_CUT_DOT');
	});

	it('leaves a clean 4+ beat review alone when a wow mechanism exists in source', () => {
		const review = finalizeCraftReview(cleanRaw, 12, {
			beats: 5,
			fullCanvasScale: true,
			sharedElement: false,
			stagger: false
		});
		expect(review.scores.transitions).toBe(8);
		expect(review.verdict).toBe('ship');
	});

	it('does not demand wow from a 3-beat composition, nor without source analysis', () => {
		expect(
			finalizeCraftReview(cleanRaw, 9, { beats: 3, fullCanvasScale: false, sharedElement: false, stagger: false })
				.verdict
		).toBe('ship');
		expect(finalizeCraftReview(cleanRaw, 9).verdict).toBe('ship');
	});

	it('caps craft and forces FIX on a beat with a frozen tail (stasis gate)', () => {
		const review = finalizeCraftReview(cleanRaw, 12, null, [
			{ component: 'BeatCTA', beatFrames: 156, lastActiveFrame: 60, gapFrames: 96 }
		]);
		expect(review.scores.craft).toBe(5);
		expect(review.verdict).toBe('fix');
		expect(review.issues[0]?.dimension).toBe('craft');
		expect(review.issues[0]?.problem).toContain('BeatCTA');
	});

	it('annacquata vs vera: la sorgente del 2026-08-21 fallisce ENTRAMBI i gate, quella con i meccanismi veri passa', () => {
		// La forma esatta del trailer vero: 5 beat TransitionSeries, solo slide(), scala "annacquata"
		// 1 -> 0.94 col marker, e code ferme. Con punteggi puliti dal giudice, i gate statici da soli
		// devono portarla a FIX.
		const watered = `
export const fps = 30;
const b1 = 5.2 * fps;
// wow: FULL_CANVAS_SCALE
function BeatHook() {
	const frame = useCurrentFrame();
	const zoom = interpolate(frame, [0, 30], [1, 0.94], { easing: E });
	const rise = interpolate(frame, [0, 24], [40, 0], { easing: E });
	return <div style={{ transform: 'scale(' + zoom + ')' }} />;
}
export default function V() {
	return (
		<TransitionSeries>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
		</TransitionSeries>
	);
}`;
		const wateredWow = detectWowMechanisms(watered);
		const wateredStasis = findStaticTails(watered);
		expect(wateredWow.beats).toBe(5);
		expect(wateredWow.fullCanvasScale).toBe(false);
		expect(wateredStasis.length).toBeGreaterThan(0);
		const failed = finalizeCraftReview(cleanRaw, 24, wateredWow, wateredStasis);
		expect(failed.verdict).toBe('fix');
		expect(failed.scores.transitions).toBeLessThanOrEqual(5);
		expect(failed.scores.craft).toBeLessThanOrEqual(5);

		// La versione VERA: stessa struttura, ma la scala sfonda davvero la camera, un elemento
		// condiviso attraversa il taglio, e ogni beat resta vivo fino alla chiusura.
		const real = `
export const fps = 30;
const b1 = 5.2 * fps;
// wow: ELEMENT_CARRYOVER
function BeatHook() {
	const frame = useCurrentFrame();
	const zoom = interpolate(frame, [4.5 * fps, b1], [1, 8], { easing: E });
	const flyX = interpolate(frame, [4.6 * fps, b1], [340, 120], { easing: E });
	return (
		<div style={{ transform: 'scale(' + zoom + ')' }}>
			<span style={{ left: flyX + 'px', top: 300 }}>29</span>
		</div>
	);
}
export default function V() {
	return (
		<TransitionSeries>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
			<TransitionSeries.Sequence durationInFrames={b1}><BeatHook /></TransitionSeries.Sequence>
		</TransitionSeries>
	);
}`;
		const realWow = detectWowMechanisms(real);
		const realStasis = findStaticTails(real);
		expect(realWow.fullCanvasScale).toBe(true);
		expect(realWow.sharedElement).toBe(true);
		expect(realStasis).toEqual([]);
		expect(finalizeCraftReview(cleanRaw, 24, realWow, realStasis).verdict).toBe('ship');
	});

	it('a non-nit legibility issue blocks ship even with high scores', () => {
		const review = finalizeCraftReview(
			{
				...cleanRaw,
				issues: [
					{
						dimension: 'legibility',
						severity: 'major',
						at_s: 4,
						problem: 'Titolo bianco su cielo chiaro al beat 2',
						fix: 'Scrim gradiente dietro il blocco testo (SCRIM_PLATE)'
					}
				]
			},
			12
		);
		expect(review.verdict).toBe('fix');
	});
});
