import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatCraftApplyBrief, type MotionCraftReview } from './craft-review';
import { finalizeFidelity, formatFidelityApplyBrief } from './reference-fidelity';
import { finalizeSpec } from '$lib/server/motion-references';

const PREVIEW = 'https://cdn.example.com/media/brand/motion-video/abc-def.mp4';

const REVIEW: MotionCraftReview = {
	verdict: 'fix',
	overall: 5,
	duration_s: 8,
	transitions_broken: true,
	scores: { craft: 5, content: 6, pleasant: 4, transitions: 3 },
	weakest_link: 'transitions',
	issues: [{ severity: 'major', dimension: 'transitions', problem: 'Stacco secco al secondo 3', fix: 'Slide sovrapposto' }],
	next_test: 'Sostituisci lo stacco con uno slide sovrapposto.',
	summary: 'Pulito ma senza respiro.',
	judgment: 'Non spedibile.',
	on_screen: 'UNO'
};

describe('the agent patches what it has watched', () => {
	it('the craft brief carries the clip the agent itself produced', () => {
		const brief = formatCraftApplyBrief(REVIEW, { previewUrl: PREVIEW });
		expect(brief).toContain(PREVIEW);
		expect(brief).toMatch(/your own work, not reading a description/i);
	});

	it('an .mp4 URL in a user turn is what makes it actually watched', async () => {
		// runMotionVideoAgent resolves media parts out of the last user message; the QC brief IS
		// that message. Without a URL ending in .mp4 the agent patches blind.
		const { userTurnMediaParts } = await import('$lib/media-parts');
		const parts = userTurnMediaParts(formatCraftApplyBrief(REVIEW, { previewUrl: PREVIEW }));
		expect(parts.some((p) => p.type === 'file' && p.mediaType === 'video/mp4')).toBe(true);
	});

	it('degrades to the old text-only brief when there is no preview yet', () => {
		const brief = formatCraftApplyBrief(REVIEW);
		expect(brief).not.toContain('THE CLIP YOU MADE');
		expect(brief).toContain('MOTION CRAFT QC FAILED');
	});

	it('the fidelity brief carries it too', () => {
		const spec = finalizeSpec(
			{ format: 'x', duration_s: 10, beats: [{ at_s: 0, on_screen: 'a', motion: 'b', buildable: 'tsx' }] },
			10
		);
		const f = finalizeFidelity({ beats: [{ index: 0, status: 'missing' }], order_kept: true }, { id: 'r', brand: 'B' }, 1);
		expect(formatFidelityApplyBrief(f, spec, { previewUrl: PREVIEW })).toContain(PREVIEW);
	});

	it('every QC pass hands over the clip, sellability included', () => {
		const qc = readFileSync(new URL('./qc.ts', import.meta.url), 'utf8');
		expect(qc).toContain('formatCraftApplyBrief(craft, { previewUrl })');
		expect(qc).toContain('formatFidelityApplyBrief(fidelity.review, fidelity.spec, { previewUrl })');
		expect(qc).toContain('THE CLIP YOU MADE: ${previewUrl}');
	});
});

describe('the reviewer is a designer, not a checklist', () => {
	const src = readFileSync(new URL('./craft-review.ts', import.meta.url), 'utf8');

	it('reviews to a shipping standard rather than to "is it fine"', () => {
		expect(src).toMatch(/senior design director/i);
		expect(src).toMatch(/Praise nothing you would not defend/i);
	});

	it('looks at what a checklist misses', () => {
		for (const lens of ['RESTRAINT', 'SPACING', 'TYPE', 'COLOUR', 'SHAPE', 'RHYTHM']) {
			expect(src).toContain(`- ${lens}:`);
		}
	});

	it('forces the one question that finds the machine-made tell', () => {
		expect(src).toContain('THE TELL');
		expect(src).toMatch(/not looking hard enough/i);
		expect(src).toMatch(/a piece with a visible tell is not an 8/i);
	});
});
