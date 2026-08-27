import { describe, expect, it } from 'vitest';
import { motionQcShouldRewrite, pickMotionRewritePass } from './qc';
import { reviewNeedsRewrite } from '$lib/server/video-review-apply';

describe('motionQcShouldRewrite', () => {
	it('rewrites only when apply is on and the score is insufficient', () => {
		expect(motionQcShouldRewrite({ verdict: 'fix', overall: 5 }, true)).toBe(true);
		expect(motionQcShouldRewrite({ verdict: 'kill', overall: 3 }, true)).toBe(true);
		expect(motionQcShouldRewrite({ verdict: 'ship', overall: 6.2 }, true)).toBe(true);
		expect(motionQcShouldRewrite({ verdict: 'ship', overall: 8 }, true)).toBe(false);
		expect(motionQcShouldRewrite({ verdict: 'fix', overall: 5 }, false)).toBe(false);
		expect(motionQcShouldRewrite(null, true)).toBe(false);
	});

	it('matches reviewNeedsRewrite when apply is true', () => {
		const low = { verdict: 'fix' as const, overall: 4 };
		expect(motionQcShouldRewrite(low, true)).toBe(reviewNeedsRewrite(low));
	});
});

describe('pickMotionRewritePass', () => {
	const fail = { verdict: 'fix' as const, overall: 4 };
	const ship = { verdict: 'ship' as const, overall: 8 };

	it('prefers technical craft over ads sellability', () => {
		expect(pickMotionRewritePass({ apply: true, craft: fail, ads: fail })).toBe('craft');
		expect(pickMotionRewritePass({ apply: true, craft: fail, ads: ship })).toBe('craft');
		expect(pickMotionRewritePass({ apply: true, craft: fail, ads: null })).toBe('craft');
	});

	it('rewrites ads only after craft ships', () => {
		expect(pickMotionRewritePass({ apply: true, craft: ship, ads: fail })).toBe('ads');
		expect(pickMotionRewritePass({ apply: true, craft: null, ads: fail })).toBe('ads');
		expect(pickMotionRewritePass({ apply: true, craft: ship, ads: ship })).toBe(null);
	});

	it('does not rewrite when apply is off', () => {
		expect(pickMotionRewritePass({ apply: false, craft: fail, ads: fail })).toBe(null);
	});

	it('skips passes already remade this encode', () => {
		expect(
			pickMotionRewritePass({
				apply: true,
				craft: fail,
				ads: fail,
				rewritten: ['craft']
			})
		).toBe('ads');
		expect(
			pickMotionRewritePass({
				apply: true,
				craft: fail,
				ads: fail,
				rewritten: ['craft', 'ads']
			})
		).toBe(null);
		expect(
			pickMotionRewritePass({
				apply: true,
				craft: fail,
				ads: ship,
				rewritten: ['craft']
			})
		).toBe(null);
	});
});


describe('pickMotionRewritePass with fidelity', () => {
	const bad = { verdict: 'fix' as const, overall: 4 };
	const good = { verdict: 'ship' as const, overall: 9 };

	it('fixes craft before fidelity — a clip that stops dead is unshippable whatever it copied', () => {
		expect(
			pickMotionRewritePass({ apply: true, craft: bad, ads: null, fidelity: { fidelity: 2 } })
		).toBe('craft');
	});

	it('fixes fidelity before sellability — polishing the hook of the wrong structure is waste', () => {
		expect(
			pickMotionRewritePass({ apply: true, craft: good, ads: bad, fidelity: { fidelity: 2 } })
		).toBe('fidelity');
	});

	it('leaves a faithful composition alone', () => {
		expect(
			pickMotionRewritePass({ apply: true, craft: good, ads: good, fidelity: { fidelity: 9 } })
		).toBeNull();
	});

	it('never asks for a fidelity rewrite when no reference was studied', () => {
		expect(pickMotionRewritePass({ apply: true, craft: good, ads: good, fidelity: null })).toBeNull();
		expect(pickMotionRewritePass({ apply: true, craft: good, ads: good })).toBeNull();
	});

	it('does not repeat a pass that already ran', () => {
		expect(
			pickMotionRewritePass({
				apply: true,
				craft: good,
				ads: null,
				fidelity: { fidelity: 2 },
				rewritten: ['fidelity']
			})
		).toBeNull();
	});
});
