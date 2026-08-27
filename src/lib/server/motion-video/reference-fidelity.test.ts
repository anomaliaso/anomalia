import { describe, expect, it } from 'vitest';
import {
	FIDELITY_REWRITE_BELOW,
	fidelityNeedsRewrite,
	fidelityScore,
	fidelityVerdict,
	finalizeFidelity,
	formatFidelityApplyBrief,
	reachableBeats,
	type BeatVerdict
} from './reference-fidelity';
import { finalizeSpec } from '$lib/server/motion-references';

const beat = (status: BeatVerdict['status'], index = 0): BeatVerdict => ({
	index,
	status,
	note: ''
});

const SPEC = finalizeSpec(
	{
		format: 'announcement card push',
		duration_s: 12,
		beats: [
			{ at_s: 0, on_screen: 'wordmark', motion: 'scales in', buildable: 'tsx' },
			{ at_s: 3, on_screen: 'metric card', motion: 'slides up', buildable: 'asset', needs: 'a screenshot' },
			{ at_s: 6, on_screen: 'chip orbit', motion: 'rotates', buildable: 'out_of_reach', needs: '3D render' },
			{ at_s: 9, on_screen: 'CTA', motion: 'irises in', buildable: 'tsx' }
		]
	},
	12
);

describe('reachableBeats', () => {
	it('drops the beats the spec told the agent to walk away from', () => {
		// An [OUT OF REACH] beat missing from the clip is obedience, not a failure — counting it
		// would push the agent back into attempting 3D in Remotion.
		expect(reachableBeats(SPEC)).toHaveLength(3);
		expect(reachableBeats(SPEC).map((b) => b.on_screen)).not.toContain('chip orbit');
	});
});

describe('fidelityScore', () => {
	it('is 10 when every planned beat is there in order', () => {
		expect(fidelityScore([beat('present'), beat('present', 1)], true)).toBe(10);
	});

	it('counts an altered beat as half', () => {
		expect(fidelityScore([beat('present'), beat('altered', 1)], true)).toBe(8);
	});

	it('is 0 when the composition shares nothing with the plan', () => {
		expect(fidelityScore([beat('missing'), beat('missing', 1)], true)).toBe(0);
	});

	it('takes a point for a broken sequence — the same beats reordered is another piece of film', () => {
		expect(fidelityScore([beat('present'), beat('present', 1)], false)).toBe(9);
	});

	it('never goes negative', () => {
		expect(fidelityScore([beat('missing')], false)).toBe(0);
	});

	it('passes a reference with nothing reachable rather than failing it', () => {
		expect(fidelityScore([], true)).toBe(10);
	});
});

describe('fidelityVerdict / needsRewrite', () => {
	it('ships at 8, fixes in the middle, kills at the bottom', () => {
		expect(fidelityVerdict(9)).toBe('ship');
		expect(fidelityVerdict(7)).toBe('fix');
		expect(fidelityVerdict(3)).toBe('kill');
	});

	it('rewrites below the threshold only', () => {
		expect(fidelityNeedsRewrite({ fidelity: FIDELITY_REWRITE_BELOW })).toBe(false);
		expect(fidelityNeedsRewrite({ fidelity: FIDELITY_REWRITE_BELOW - 1 })).toBe(true);
		expect(fidelityNeedsRewrite(null)).toBe(false);
		// No reference studied → nothing to be faithful to → never a rewrite.
		expect(fidelityNeedsRewrite(undefined)).toBe(false);
	});
});

describe('finalizeFidelity', () => {
	it('computes the score in code rather than trusting the model to pick one', () => {
		const f = finalizeFidelity(
			{
				beats: [
					{ index: 0, status: 'present' },
					{ index: 1, status: 'altered', note: 'headline instead of the UI card' }
				],
				order_kept: true,
				summary: 'Vicino ma senza il beat di prodotto.',
				next_test: 'Rimetti la card metrica al secondo 3.'
			},
			{ id: 'ref-1', brand: 'Cursor' },
			2
		);
		expect(f.fidelity).toBe(8);
		expect(f.verdict).toBe('ship');
		expect(f.checked).toBe(2);
		expect(f.reference_brand).toBe('Cursor');
	});

	it('treats an unrecognised status as missing, never as present', () => {
		const f = finalizeFidelity({ beats: [{ index: 0, status: 'sort of there' }] }, { id: 'r', brand: null }, 1);
		expect(f.beats[0].status).toBe('missing');
		expect(f.fidelity).toBe(0);
	});

	it('defaults order_kept to true so a silent model does not cost a point', () => {
		expect(finalizeFidelity({ beats: [] }, { id: 'r', brand: null }, 0).order_kept).toBe(true);
	});
});

describe('formatFidelityApplyBrief', () => {
	const f = finalizeFidelity(
		{
			beats: [
				{ index: 0, status: 'present' },
				{ index: 1, status: 'missing', note: 'nessuna card di prodotto' },
				{ index: 2, status: 'altered', note: 'CTA senza iris' }
			],
			order_kept: false,
			summary: 'Ha tenuto solo l’apertura.',
			next_test: 'Ricostruisci la card metrica al secondo 3.'
		},
		{ id: 'ref-1', brand: 'Cursor' },
		3
	);

	it('names the beats that did not land, with the timing they were planned for', () => {
		const brief = formatFidelityApplyBrief(f, SPEC);
		expect(brief).toContain('REFERENCE FIDELITY FAILED');
		expect(brief).toContain('[MISSING] 3s — metric card');
		expect(brief).toContain('nessuna card di prodotto');
		expect(brief).toContain('ORDER BROKEN');
	});

	it('tells the agent that dropping an out-of-reach beat was correct', () => {
		expect(formatFidelityApplyBrief(f, SPEC)).toContain('[OUT OF REACH] are NOT part of this');
	});

	it('indexes against the reachable beats, not the raw list', () => {
		// Index 2 is the CTA (the third REACHABLE beat), not the 3D chip orbit at position 2.
		expect(formatFidelityApplyBrief(f, SPEC)).toContain('9s — CTA');
		expect(formatFidelityApplyBrief(f, SPEC)).not.toContain('chip orbit');
	});
});
