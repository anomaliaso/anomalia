/**
 * Keep the craft verdicts.
 *
 * `qc.ts` has scored every clip we render since the day it shipped — craft, content, pleasant,
 * transitions, 1–10 — and thrown the numbers away the moment the turn ended. `ai_calls` kept the
 * latency and the token count of the judge call and none of its judgement. So the one question
 * anyone actually asks about a change to the generator — did the output get better — has had no
 * answer available, for any change, ever.
 *
 * This writes the scores down, next to what the composition was built from. The reference wall is
 * the immediate reason (a clip built from a studied reference should outscore one built from the
 * craft constant alone, and if it does not, that is worth knowing early), but nothing here is
 * specific to it: any future change to the prompt, the model or the craft rules gets a before and
 * after out of the same table.
 *
 * Best-effort. A QC pass must never fail because a metrics row did not land.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '$lib/server/supabase-admin';
import type { MotionCraftReview } from '$lib/server/motion-video/craft-review';

export type CraftScoreRow = {
	brand_id: string;
	video_id: string;
	round: number;
	verdict: string;
	overall: number;
	craft: number;
	content: number;
	pleasant: number;
	transitions: number;
	transitions_broken: boolean;
	weakest_link: string;
	duration_s: number | null;
	reference_ids: string[];
	reference_count: number;
	/** Null when the composition was not built from a studied reference. Absent ≠ zero. */
	reference_fidelity: number | null;
	reference_order_kept: boolean | null;
	reference_beats_checked: number | null;
	reference_beats_missing: number | null;
};

/** Pure — exported for the test. */
export function craftScoreRow(opts: {
	brandId: string;
	videoId: string;
	round: number;
	review: MotionCraftReview;
	referenceIds: string[];
	/** The other half of the verdict: did the studied structure survive into the clip? */
	fidelity?: {
		fidelity: number;
		order_kept: boolean;
		checked: number;
		beats: Array<{ status: string }>;
	} | null;
}): CraftScoreRow {
	const s = opts.review.scores;
	return {
		brand_id: opts.brandId,
		video_id: opts.videoId,
		round: Math.max(0, Math.trunc(opts.round)),
		verdict: opts.review.verdict,
		overall: opts.review.overall,
		craft: s.craft,
		content: s.content,
		pleasant: s.pleasant,
		transitions: s.transitions,
		transitions_broken: opts.review.transitions_broken === true,
		weakest_link: String(opts.review.weakest_link ?? ''),
		duration_s: Number.isFinite(opts.review.duration_s) ? opts.review.duration_s : null,
		reference_ids: [...new Set(opts.referenceIds)].slice(0, 12),
		reference_count: new Set(opts.referenceIds).size,
		reference_fidelity: opts.fidelity ? opts.fidelity.fidelity : null,
		reference_order_kept: opts.fidelity ? opts.fidelity.order_kept : null,
		reference_beats_checked: opts.fidelity ? opts.fidelity.checked : null,
		reference_beats_missing: opts.fidelity
			? opts.fidelity.beats.filter((b) => b.status === 'missing').length
			: null
	};
}

/** Which wall references this composition was built from, if any. */
async function referenceIdsFor(supabase: SupabaseClient, videoId: string): Promise<string[]> {
	const { data, error } = await supabase
		.from('motion_video_references')
		.select('reference_id')
		.eq('video_id', videoId);
	if (error || !data) return [];
	return data.map((r) => String((r as { reference_id: string }).reference_id)).filter(Boolean);
}

/**
 * Writes with the SERVICE ROLE, and that is the whole point of this comment.
 *
 * `motion_craft_scores` and `motion_video_references` are internal instruments: RLS on, no policy,
 * the same posture as `ai_calls` and `market_posts`. The first version took the caller's client —
 * which on every real path is the request-scoped one — so every insert was refused by RLS and
 * swallowed by the best-effort catch. The tables stayed empty for a whole day of use while the
 * feature looked like it was recording, which is worse than not having them: an empty instrument
 * reads as "no signal" rather than as "not plugged in".
 */
export async function recordCraftScore(opts: {
	brandId: string;
	videoId: string;
	round: number;
	review: MotionCraftReview;
	fidelity?: Parameters<typeof craftScoreRow>[0]['fidelity'];
}): Promise<void> {
	try {
		const admin = createAdminClient();
		const referenceIds = await referenceIdsFor(admin, opts.videoId);
		const { error } = await admin
			.from('motion_craft_scores')
			.insert(craftScoreRow({ ...opts, referenceIds }));
		if (error) console.warn(`[motion-craft] score write failed: ${error.message}`);
	} catch (e) {
		console.warn(`[motion-craft] score write failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}
