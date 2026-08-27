/**
 * Shared post-render QC helpers for UGC Creator and Motion video.
 * Same judge as calendar clips (`reviewVideo` + persistReadyReview).
 * A fix/kill verdict is insufficient — the producer must apply `next_test`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	AUTO_VIDEO_REVIEW_ENABLED,
	reviewVideo,
	type ReviewVideoOpts,
	type VideoReview,
	type VideoStandard
} from '$lib/server/video-review';
import { persistReadyReview } from '$lib/server/video-review-store';

export const VIDEO_QC_REMAKE_MAX = 1;

export function reviewNeedsRewrite(
	review: Pick<VideoReview, 'verdict' | 'overall'> | null | undefined
): boolean {
	if (!review) return false;
	if (review.verdict === 'fix' || review.verdict === 'kill') return true;
	return typeof review.overall === 'number' && review.overall < 7;
}

export function compactReviewForTool(review: VideoReview) {
	return {
		overall: review.overall,
		verdict: review.verdict,
		judgment: review.judgment,
		next_test: review.next_test,
		weakest_link: review.weakest_link,
		summary: review.summary,
		issues: review.issues.slice(0, 6).map((i) => ({
			severity: i.severity,
			dimension: i.dimension,
			problem: i.problem,
			fix: i.fix
		})),
		must_rewrite: reviewNeedsRewrite(review)
	};
}

export function formatReviewApplyBrief(
	review: VideoReview,
	kind: 'ugc' | 'motion'
): string {
	const issueLines = review.issues
		.slice(0, 6)
		.map(
			(i) =>
				`- [${i.severity}] ${i.dimension}: ${i.problem}${i.fix ? ` → ${i.fix}` : ''}`
		);
	const issuesBlock = issueLines.length ? issueLines.join('\n') : '- (no issue list — still apply next_test)';
	const tail =
		kind === 'motion'
			? 'SELLABILITY QC (ads/organic) — Patch the Remotion TSX now (grep_source → replace_source, or write_source if the structure must change). Apply every note: hook, CTA, proof, contrast, timing. Do not reply without writing source. Do not argue with the verdict.'
			: 'Remake the talking clip. Keep the speaker/product identity. Rewrite the shot brief and spoken line so every note is visible. Do not ship the previous take.';
	// What the judge could NOT determine travels with the verdict. Without it a `fix` produced on
	// half the dimensions reads exactly like a `fix` produced on all of them, and the agent spends a
	// remake chasing notes that were never a complete read of the clip.
	const gaps =
		review.evidence && review.evidence.tier !== 'full'
			? `\n\nWhat I could not determine: ${review.evidence.label} Treat the unjudged dimensions as OPEN, not as passed.`
			: '';
	return `MEDIA QC FAILED — verdict ${review.verdict.toUpperCase()} (${review.overall}/10). This version is NOT shippable. You MUST apply the notes below.

Judgment: ${review.judgment || review.summary}

Mandatory next test: ${review.next_test || 'Strengthen the first 3s hook and the end CTA.'}

Issues to fix:
${issuesBlock}${gaps}

${tail}`;
}

export async function scoreFinishedClip(
	supabase: SupabaseClient,
	input: {
		brandId: string;
		url: string;
		standard: VideoStandard;
		opts: ReviewVideoOpts;
		/**
		 * true = il giudizio parte DA SOLO dentro una pipeline di generazione (il produttore UGC,
		 * il lotto, il job motion) e alimenta un giro di rifacimento. È esattamente ciò che
		 * l'interruttore spegne. Chi arriva qui perché una persona ha premuto un tasto lo omette.
		 */
		auto?: boolean;
	}
): Promise<{ ok: true; review: VideoReview } | { ok: false; error: string }> {
	const url = input.url.trim();
	if (!url) return { ok: false, error: 'invalid_url' };
	if (input.auto && !AUTO_VIDEO_REVIEW_ENABLED) return { ok: false, error: 'auto_review_off' };
	try {
		const result = await reviewVideo(url, { ...input.opts, standard: input.standard });
		if (!result.ok) return { ok: false, error: result.error };
		await persistReadyReview(supabase, {
			brandId: input.brandId,
			url,
			standard: input.standard,
			review: result.review,
			kind: input.opts.kind ?? 'video'
		});
		return { ok: true, review: result.review };
	} catch (e) {
		if (e instanceof Error && e.name === 'CreditsExhaustedError') {
			return { ok: false, error: 'credits_exhausted' };
		}
		return { ok: false, error: e instanceof Error ? e.message : 'review_failed' };
	}
}
