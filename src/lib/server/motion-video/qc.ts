/**
 * Dual Motion Video QC.
 * 1. Technical craft (well-made, right content, pleasant, transitions intact).
 * 2. Classic sellability — same organic/ads judge as UGC (`reviewVideo`).
 *
 * Craft runs first. A failing craft remake skips sellability that round.
 * After the rewritten source is re-rendered, the next call scores both; ads may still remake.
 *
 * Both passes look at `preview_url`, so QC only exists for a row that HAS one: the MP4 is rendered
 * server-side (`render-tools.ts`) and `preview_url` is written by whoever rendered it. It used to
 * be the browser's job to report the url back, and it never did — so every browser-made video
 * scored `no_preview` and this whole pipeline no-opped without a sound. The server only patches
 * Remotion TSX; it never encodes.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { withBrandContext } from '$lib/server/ai-log';
import { getMotionVideo } from '$lib/server/motion-video/persist';
import { runMotionVideoTurn } from '$lib/server/motion-video/run-turn';
import { recordCraftScore } from '$lib/server/motion-video/craft-scores';
import {
	compactFidelity,
	fidelityNeedsRewrite,
	formatFidelityApplyBrief,
	loadStudiedReferences,
	reviewReferenceFidelity,
	type ReferenceFidelity
} from '$lib/server/motion-video/reference-fidelity';
import {
	compactCraftReview,
	formatCraftApplyBrief,
	reviewMotionCraft,
	type MotionCraftReview
} from '$lib/server/motion-video/craft-review';
import {
	compactReviewForTool,
	formatReviewApplyBrief,
	reviewNeedsRewrite,
	scoreFinishedClip
} from '$lib/server/video-review-apply';
import type { VideoReview } from '$lib/server/video-review';
import type { MotionReferenceSpec } from '$lib/server/motion-references';

export type MotionQcPass = 'craft' | 'fidelity' | 'ads';

export type MotionQcResult = {
	ok: boolean;
	applied: boolean;
	craft: ReturnType<typeof compactCraftReview> | null;
	/** Null when the composition was not built from a studied reference — most of them. */
	fidelity?: ReturnType<typeof compactFidelity> | null;
	review: ReturnType<typeof compactReviewForTool> | null;
	rewrite_from?: MotionQcPass;
	id?: string;
	title?: string;
	source?: string;
	error?: string;
};

function emptyQc(error: string): MotionQcResult {
	return { ok: false, applied: false, craft: null, review: null, error };
}

export function motionQcShouldRewrite(
	review: Pick<VideoReview, 'verdict' | 'overall'> | null | undefined,
	apply: boolean
): boolean {
	return apply === true && reviewNeedsRewrite(review);
}

/** Craft first, then ads sellability. Already-rewritten passes are skipped. */
export function pickMotionRewritePass(opts: {
	apply: boolean;
	craft: Pick<MotionCraftReview, 'verdict' | 'overall'> | null | undefined;
	ads: Pick<VideoReview, 'verdict' | 'overall'> | null | undefined;
	/** Only set when the composition was built from a studied reference. */
	fidelity?: Pick<ReferenceFidelity, 'fidelity'> | null;
	rewritten?: readonly MotionQcPass[];
}): MotionQcPass | null {
	if (!opts.apply) return null;
	const done = new Set(opts.rewritten ?? []);
	// Craft first: a clip that stops dead between scenes is unshippable whatever it was built from.
	if (!done.has('craft') && reviewNeedsRewrite(opts.craft)) return 'craft';
	// Then fidelity — structure before selling. Rewriting the hook of a composition that never
	// built the structure it studied just polishes the wrong piece.
	if (!done.has('fidelity') && fidelityNeedsRewrite(opts.fidelity)) return 'fidelity';
	if (!done.has('ads') && reviewNeedsRewrite(opts.ads)) return 'ads';
	return null;
}

async function patchMotionFromBrief(opts: {
	supabase: SupabaseClient;
	userId: string;
	brand: { id: string; name: string };
	video: { id: string; source: string };
	brief: string;
	abortSignal?: AbortSignal;
	craft: MotionCraftReview | null;
	ads: VideoReview | null;
	fidelity?: { review: ReferenceFidelity; spec: Parameters<typeof compactFidelity>[1] } | null;
	rewriteFrom: MotionQcPass;
}): Promise<MotionQcResult> {
	const compact = {
		craft: opts.craft ? compactCraftReview(opts.craft) : null,
		fidelity: opts.fidelity ? compactFidelity(opts.fidelity.review, opts.fidelity.spec) : null,
		review: opts.ads ? compactReviewForTool(opts.ads) : null
	};
	try {
		const response = await withBrandContext(opts.brand.id, () =>
			runMotionVideoTurn({
				supabase: opts.supabase,
				userId: opts.userId,
				brand: opts.brand,
				prompt: opts.brief,
				selectedIds: [opts.video.id],
				abortSignal: opts.abortSignal
			})
		);
		await response.arrayBuffer().catch(swallow('response.arrayBuffer failed'));
	} catch (e) {
		if (e instanceof Error && e.name === 'CreditsExhaustedError') {
			return {
				ok: true,
				applied: false,
				...compact,
				rewrite_from: opts.rewriteFrom,
				error: 'credits_exhausted'
			};
		}
		return {
			ok: true,
			applied: false,
			...compact,
			rewrite_from: opts.rewriteFrom,
			error: e instanceof Error ? e.message : 'qc_apply_failed'
		};
	}

	const updated = await getMotionVideo(opts.supabase, opts.brand.id, opts.video.id);
	if (!updated || updated.source === opts.video.source) {
		return {
			ok: true,
			applied: false,
			...compact,
			rewrite_from: opts.rewriteFrom,
			error: 'qc_apply_noop'
		};
	}
	return {
		ok: true,
		applied: true,
		...compact,
		rewrite_from: opts.rewriteFrom,
		id: updated.id,
		title: updated.title,
		source: updated.source
	};
}

export async function scoreAndMaybeRewriteMotion(opts: {
	supabase: SupabaseClient;
	userId: string;
	brand: { id: string; name: string };
	videoId: string;
	apply?: boolean;
	rewritten?: MotionQcPass[];
	abortSignal?: AbortSignal;
	/** true quando parte da un job schedulato e non dal tasto QC del workbench. */
	auto?: boolean;
}): Promise<MotionQcResult> {
	const apply = opts.apply !== false;
	const rewritten = opts.rewritten ?? [];
	const video = await getMotionVideo(opts.supabase, opts.brand.id, opts.videoId);
	if (!video) return emptyQc('not_found');

	const previewUrl = video.preview_url?.trim() ?? '';
	if (!previewUrl || !/^https?:\/\//i.test(previewUrl)) {
		return emptyQc('no_preview');
	}

	const { data: brandRow } = await opts.supabase
		.from('brands')
		.select('name, content_prefs')
		.eq('id', opts.brand.id)
		.maybeSingle();
	const language =
		brandRow?.content_prefs && typeof brandRow.content_prefs === 'object'
			? String((brandRow.content_prefs as { language?: string }).language ?? '').trim() || null
			: null;

	let craft: MotionCraftReview | null = null;
	try {
		const crafted = await withBrandContext(opts.brand.id, () =>
			reviewMotionCraft({
				url: previewUrl,
				source: video.source,
				brandName: opts.brand.name || null,
				language,
				abortSignal: opts.abortSignal
			})
		);
		if (crafted.ok) {
			craft = crafted.review;
		} else if (crafted.error === 'credits_exhausted') {
			return { ok: true, applied: false, craft: null, review: null, error: 'credits_exhausted' };
		}
	} catch (e) {
		if (e instanceof Error && e.name === 'CreditsExhaustedError') {
			return { ok: true, applied: false, craft: null, review: null, error: 'credits_exhausted' };
		}
	}

	// Round = how many rewrite passes had already run, so a first draft and its patched version are
	// two comparable rows rather than one overwriting the other.
	const scoreRound = rewritten.length;

	if (pickMotionRewritePass({ apply, craft, ads: null, rewritten }) === 'craft' && craft) {
		// Recorded without a fidelity number on purpose: the check never ran on this path, and a
		// zero would read as "ignored the reference" when the truth is "not measured".
		await recordCraftScore({
			brandId: opts.brand.id,
			videoId: video.id,
			round: scoreRound,
			review: craft
		});
		return patchMotionFromBrief({
			supabase: opts.supabase,
			userId: opts.userId,
			brand: opts.brand,
			video,
			brief: formatCraftApplyBrief(craft, { previewUrl }),
			abortSignal: opts.abortSignal,
			craft,
			ads: null,
			rewriteFrom: 'craft'
		});
	}

	// Did it build the structure it studied? Only runs when the wall was actually used — which is a
	// minority of compositions, so this costs nothing on the ones that were written from scratch.
	let fidelity: { review: ReferenceFidelity; spec: MotionReferenceSpec } | null = null;
	if (!rewritten.includes('fidelity')) {
		for (const reference of await loadStudiedReferences(video.id)) {
			const checked = await withBrandContext(opts.brand.id, () =>
				reviewReferenceFidelity({
					url: previewUrl,
					reference,
					source: video.source,
					brandName: opts.brand.name || null,
					language,
					abortSignal: opts.abortSignal
				})
			).catch((error) => { swallow('reviewReferenceFidelity failed', error); return null; });
			if (checked?.ok) {
				fidelity = { review: checked.fidelity, spec: checked.spec };
				break;
			}
		}
	}

	if (craft) {
		await recordCraftScore({
			brandId: opts.brand.id,
			videoId: video.id,
			round: scoreRound,
			review: craft,
			fidelity: fidelity?.review ?? null
		});
	}

	if (
		pickMotionRewritePass({ apply, craft, ads: null, fidelity: fidelity?.review, rewritten }) ===
			'fidelity' &&
		fidelity
	) {
		return patchMotionFromBrief({
			supabase: opts.supabase,
			userId: opts.userId,
			brand: opts.brand,
			video,
			brief: formatFidelityApplyBrief(fidelity.review, fidelity.spec, { previewUrl }),
			abortSignal: opts.abortSignal,
			craft,
			ads: null,
			fidelity,
			rewriteFrom: 'fidelity'
		});
	}

	const scored = await withBrandContext(opts.brand.id, () =>
		scoreFinishedClip(opts.supabase, {
			brandId: opts.brand.id,
			url: previewUrl,
			auto: opts.auto === true,
			standard: 'ads',
			opts: {
				standard: 'ads',
				brandName: opts.brand.name || null,
				language,
				kind: 'video',
				abortSignal: opts.abortSignal
			}
		})
	);
	if (!scored.ok) {
		return {
			ok: true,
			applied: false,
			craft: craft ? compactCraftReview(craft) : null,
			fidelity: fidelity ? compactFidelity(fidelity.review, fidelity.spec) : null,
			review: null,
			error: scored.error
		};
	}

	const ads = scored.review;
	if (pickMotionRewritePass({ apply, craft, ads, rewritten }) === 'ads') {
		return patchMotionFromBrief({
			supabase: opts.supabase,
			userId: opts.userId,
			brand: opts.brand,
			video,
			// The sellability brief is shared with UGC, so the clip line is appended here rather than
			// changing a signature three other surfaces depend on. Same rule either way: the agent
			// patches what it has watched, not what it has been told about.
			brief: `${formatReviewApplyBrief(ads, 'motion')}\n\nTHE CLIP YOU MADE: ${previewUrl}\nWatch it before you patch.`,
			abortSignal: opts.abortSignal,
			craft,
			ads,
			fidelity,
			rewriteFrom: 'ads'
		});
	}

	return {
		ok: true,
		applied: false,
		craft: craft ? compactCraftReview(craft) : null,
		fidelity: fidelity ? compactFidelity(fidelity.review, fidelity.spec) : null,
		review: compactReviewForTool(ads)
	};
}
