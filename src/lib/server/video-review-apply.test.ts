import { describe, expect, it } from 'vitest';
import {
	compactReviewForTool,
	formatReviewApplyBrief,
	reviewNeedsRewrite
} from './video-review-apply';
import type { VideoReview } from './video-review';

function review(partial: Partial<VideoReview>): VideoReview {
	return {
		standard: 'organic',
		verdict: 'fix',
		overall: 5.2,
		duration_s: 12,
		doomscroll: { stops: false, who: '', reason: '' },
		hook: {
			at_s: 0,
			type: 'other',
			line: '',
			visual: '',
			callout: false,
			open_loop: false,
			promise_match: false,
			unique: false
		},
		reveal_at_s: null,
		cta_at_s: null,
		dead_seconds: [],
		scores: {},
		weakest_link: 'scroll_stop',
		issues: [
			{
				dimension: 'scroll_stop',
				severity: 'critical',
				at_s: 0,
				problem: 'No motion in the first 500ms',
				fix: 'Open on a face already talking'
			}
		],
		next_test: 'Start mid-sentence on a close-up face',
		summary: 'Thumb keeps moving',
		script: { spoken: '', on_screen: '', caption: '' },
		judgment: 'The open is a logo, not a person.',
		...partial
	};
}

describe('reviewNeedsRewrite', () => {
	it('treats fix, kill, and scores below 7 as insufficient', () => {
		expect(reviewNeedsRewrite(review({ verdict: 'fix' }))).toBe(true);
		expect(reviewNeedsRewrite(review({ verdict: 'kill' }))).toBe(true);
		expect(reviewNeedsRewrite(review({ verdict: 'ship', overall: 8 }))).toBe(false);
		expect(reviewNeedsRewrite(review({ verdict: 'ship', overall: 6.4 }))).toBe(true);
		expect(reviewNeedsRewrite(null)).toBe(false);
		expect(reviewNeedsRewrite(undefined)).toBe(false);
	});
});

describe('formatReviewApplyBrief', () => {
	it('includes score, judgment, next_test and issues', () => {
		const text = formatReviewApplyBrief(review({}), 'ugc');
		expect(text).toContain('FIX');
		expect(text).toContain('5.2/10');
		expect(text).toContain('Start mid-sentence on a close-up face');
		expect(text).toContain('Open on a face already talking');
		expect(text).toContain('Remake the talking clip');
	});

	it('uses Remotion sellability instructions for motion', () => {
		const text = formatReviewApplyBrief(review({}), 'motion');
		expect(text).toContain('grep_source');
		expect(text).toContain('Remotion');
		expect(text).toContain('SELLABILITY');
	});
});

describe('compactReviewForTool', () => {
	it('flags must_rewrite on fix', () => {
		const compact = compactReviewForTool(review({}));
		expect(compact.must_rewrite).toBe(true);
		expect(compact.verdict).toBe('fix');
		expect(compact.issues).toHaveLength(1);
	});
});
