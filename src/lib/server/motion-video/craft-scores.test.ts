import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { craftScoreRow } from './craft-scores';
import type { MotionCraftReview } from './craft-review';

const REVIEW: MotionCraftReview = {
	verdict: 'fix',
	overall: 6,
	duration_s: 6.2,
	transitions_broken: true,
	scores: { craft: 5, content: 7, pleasant: 6, transitions: 3 },
	weakest_link: 'transitions',
	issues: [],
	next_test: 'Replace the hard cut with an overlapping slide.',
	summary: 'Reads, but it stops dead between scenes.',
	judgment: 'Not shippable yet.',
	on_screen: 'ONE NUMBER'
};

describe('craftScoreRow', () => {
	it('splits the dimensions into columns so they can be correlated', () => {
		const row = craftScoreRow({
			brandId: 'b1',
			videoId: 'v1',
			round: 0,
			review: REVIEW,
			referenceIds: ['ref-a', 'ref-b']
		});
		expect(row).toMatchObject({
			brand_id: 'b1',
			video_id: 'v1',
			round: 0,
			verdict: 'fix',
			overall: 6,
			craft: 5,
			transitions: 3,
			transitions_broken: true,
			weakest_link: 'transitions',
			duration_s: 6.2,
			reference_count: 2
		});
	});

	it('dedupes references — the same one studied twice in a turn is one provenance', () => {
		const row = craftScoreRow({
			brandId: 'b1',
			videoId: 'v1',
			round: 1,
			review: REVIEW,
			referenceIds: ['ref-a', 'ref-a', 'ref-b']
		});
		expect(row.reference_ids).toEqual(['ref-a', 'ref-b']);
		expect(row.reference_count).toBe(2);
	});

	it('marks an unreferenced clip as the control side of the comparison', () => {
		const row = craftScoreRow({ brandId: 'b1', videoId: 'v1', round: 0, review: REVIEW, referenceIds: [] });
		expect(row.reference_count).toBe(0);
		expect(row.reference_ids).toEqual([]);
	});

	it('keeps a rewrite round distinct from the first draft', () => {
		expect(craftScoreRow({ brandId: 'b', videoId: 'v', round: 2, review: REVIEW, referenceIds: [] }).round).toBe(2);
	});
});


describe('craftScoreRow with fidelity', () => {
	const fidelity = {
		fidelity: 4,
		order_kept: false,
		checked: 3,
		beats: [{ status: 'present' }, { status: 'missing' }, { status: 'missing' }]
	};

	it('records the other half of the verdict next to the craft one', () => {
		const row = craftScoreRow({
			brandId: 'b1',
			videoId: 'v1',
			round: 0,
			review: REVIEW,
			referenceIds: ['ref-a'],
			fidelity
		});
		expect(row.reference_fidelity).toBe(4);
		expect(row.reference_order_kept).toBe(false);
		expect(row.reference_beats_checked).toBe(3);
		expect(row.reference_beats_missing).toBe(2);
	});

	it('leaves every fidelity column null when no reference was studied — absent is not zero', () => {
		const row = craftScoreRow({ brandId: 'b1', videoId: 'v1', round: 0, review: REVIEW, referenceIds: [] });
		expect(row.reference_fidelity).toBeNull();
		expect(row.reference_order_kept).toBeNull();
		expect(row.reference_beats_checked).toBeNull();
		expect(row.reference_beats_missing).toBeNull();
	});
});

describe('the instruments write with the service role', () => {
	// Both tables are RLS-on with no policy (internal instruments, same posture as ai_calls).
	// The first version used the caller's request-scoped client: every insert came back
	// `42501 new row violates row-level security policy`, the best-effort catch swallowed it, and
	// the tables read as "nothing was ever studied" through a full day of real use.
	const reads = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

	it('the craft score writer builds its own admin client', () => {
		const src = reads('./craft-scores.ts');
		expect(src).toContain('createAdminClient()');
		expect(src).not.toMatch(/recordCraftScore\(\s*supabase\s*:/);
		// and it must not take one from the caller any more
		expect(src).not.toContain('export async function recordCraftScore(\n\tsupabase');
	});

	it('the reference link writer does too', () => {
		const src = reads('./agent.ts');
		const write = src.indexOf("from('motion_video_references')");
		expect(write).toBeGreaterThan(-1);
		expect(src.slice(write - 120, write)).toContain('createAdminClient()');
	});

	it('qc.ts no longer hands it the request client', () => {
		expect(reads('./qc.ts')).toContain('await recordCraftScore({');
	});
});
