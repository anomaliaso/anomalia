/**
 * Did the composition actually build the reference it studied?
 *
 * THE HOLE THIS CLOSES. The wall hands the agent a beat sheet and nothing checks whether the beat
 * sheet survived into the MP4. `craft-review.ts` judges how well the clip is MADE — easing,
 * transitions, type, whether anything freezes before a cut — and would happily ship a beautifully
 * eased composition that shares nothing with the reference it was supposedly built from. Which is
 * exactly what a run looked like from the outside: the agent called the tool, watched a clip, and
 * the output did not visibly change. Without this, "use the structure" is a suggestion nobody
 * audits, and a suggestion nobody audits is a prompt line, not a feature.
 *
 * WHAT IS AND IS NOT A FAILURE. Only the beats the study marked reachable (`tsx`, `asset`) are
 * checked. An `[OUT OF REACH]` beat — a 3D render, filmed footage, a camera flying through a real
 * scene — is one the spec explicitly told the agent to replace or drop, so its absence is
 * OBEDIENCE, and punishing it would push the agent straight back into attempting things Remotion
 * cannot make. A reference whose reachable beats are all gone is the real miss.
 *
 * The score is computed here, not asked of the model: the judge says per beat present / altered /
 * missing and whether the order held, and the arithmetic is ours. A model that also picks the
 * number tends to reconcile it with its own prose rather than with what it saw.
 */
import { getBrandContext } from '$lib/server/ai-log';
import { llmConfigured, llmStructured, llmVideoReviewerModel } from '$lib/server/llm';
import { createAdminClient } from '$lib/server/supabase-admin';
import { fetchVideoBytes, prepareReviewMedia, type VideoReviewVerdict } from '$lib/server/video-review';
import {
	MOTION_SPEC_VERSION,
	buildabilityOf,
	type MotionReferenceSpec
} from '$lib/server/motion-references';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** References compared per QC pass. One is the normal case; the cap is a cost stop. */
export const MAX_REFERENCES_CHECKED = 1;
const SOURCE_SNIPPET_CHARS = 6_000;

/** Below this the composition is not a variation on the reference, it is a different piece. */
export const FIDELITY_REWRITE_BELOW = 6;

export type BeatStatus = 'present' | 'altered' | 'missing';

export type BeatVerdict = {
	index: number;
	status: BeatStatus;
	/** What was expected, and what is there instead. */
	note: string;
};

export type ReferenceFidelity = {
	reference_id: string;
	reference_brand: string | null;
	/** Reachable beats only — see the module comment. */
	checked: number;
	beats: BeatVerdict[];
	order_kept: boolean;
	/** 0–10, computed from the per-beat verdicts. */
	fidelity: number;
	verdict: VideoReviewVerdict;
	summary: string;
	next_test: string;
};

/** present = 1, altered = ½, missing = 0. Pure — exported for the test. */
export function fidelityScore(beats: BeatVerdict[], orderKept: boolean): number {
	if (!beats.length) return 10;
	const weight = (s: BeatStatus) => (s === 'present' ? 1 : s === 'altered' ? 0.5 : 0);
	const raw = beats.reduce((sum, b) => sum + weight(b.status), 0) / beats.length;
	// Order is worth a point: the same beats in the wrong sequence is a different piece of film.
	const penalty = orderKept ? 0 : 1;
	return Math.max(0, Math.min(10, Math.round(raw * 10) - penalty));
}

export function fidelityVerdict(score: number): VideoReviewVerdict {
	if (score >= 8) return 'ship';
	if (score >= FIDELITY_REWRITE_BELOW) return 'fix';
	return 'kill';
}

export function fidelityNeedsRewrite(f: Pick<ReferenceFidelity, 'fidelity'> | null | undefined): boolean {
	return !!f && f.fidelity < FIDELITY_REWRITE_BELOW;
}

/** The beats a composition was actually asked to build. */
export function reachableBeats(spec: MotionReferenceSpec) {
	return spec.beats.filter((b) => b.buildable !== 'out_of_reach');
}

/** Shape a raw model object into a fidelity verdict. Pure — exported for the test. */
export function finalizeFidelity(
	raw: AnyRec,
	ref: { id: string; brand: string | null },
	checked: number
): ReferenceFidelity {
	const rows = Array.isArray(raw.beats) ? raw.beats : [];
	const beats: BeatVerdict[] = rows
		.slice(0, 12)
		.map((b: AnyRec, i: number) => {
			const status = String(b?.status ?? '').toLowerCase();
			return {
				index: Number.isFinite(Number(b?.index)) ? Math.max(0, Math.trunc(Number(b.index))) : i,
				// Anything unrecognised counts as missing: an optimistic default would quietly turn a
				// composition that ignored the reference into a passing score.
				status: (status === 'present' || status === 'altered' ? status : 'missing') as BeatStatus,
				note: String(b?.note ?? '').trim().slice(0, 240)
			};
		});
	const orderKept = raw.order_kept !== false;
	const fidelity = fidelityScore(beats, orderKept);
	return {
		reference_id: ref.id,
		reference_brand: ref.brand,
		checked,
		beats,
		order_kept: orderKept,
		fidelity,
		verdict: fidelityVerdict(fidelity),
		summary: String(raw.summary ?? '').trim().slice(0, 600),
		next_test: String(raw.next_test ?? '').trim().slice(0, 300)
	};
}

/** The brief the agent must act on when the reference did not survive into the clip. */
export function formatFidelityApplyBrief(
	f: ReferenceFidelity,
	spec: MotionReferenceSpec,
	opts?: { previewUrl?: string | null }
): string {
	const reachable = reachableBeats(spec);
	const lines = f.beats
		.filter((b) => b.status !== 'present')
		.slice(0, 8)
		.map((b) => {
			const planned = reachable[b.index];
			const head = planned ? `${planned.at_s}s — ${planned.on_screen}` : `beat ${b.index + 1}`;
			return `- [${b.status.toUpperCase()}] ${head}${b.note ? ` → ${b.note}` : ''}`;
		});

	const watch = opts?.previewUrl?.trim()
		? `\nTHE CLIP YOU MADE: ${opts.previewUrl.trim()}\nWatch it against the beat sheet before you patch — the gaps below are visible, not theoretical.\n`
		: '';
	return `REFERENCE FIDELITY FAILED — ${f.fidelity}/10 against ${f.reference_brand ?? 'the studied reference'}.
${watch}

You studied a structure and then built something else. The reference is not decoration on the brief: its beat shape, its pacing and its transition mechanism are what you were asked to reproduce in THIS brand's palette and type.

Judgment: ${f.summary || 'The finished clip does not follow the beat sheet it was built from.'}
${f.order_kept ? '' : '\nORDER BROKEN: the beats that survived are not in the sequence the reference used. The sequence is most of what makes the structure work.'}

Beats that did not land:
${lines.length ? lines.join('\n') : '- (no per-beat detail — rebuild the sequence from the spec above)'}

Mandatory next test: ${f.next_test || 'Rebuild the missing beats in order, at the timings the spec gives, in this brand’s palette and type.'}

Patch the Remotion TSX now (grep_source → replace_source, or write_source if the sequence must be rebuilt). Beats the spec marked [OUT OF REACH] are NOT part of this — leaving those out was correct. Do not reproduce the reference's artwork, colours or copy.`;
}

function fidelityPrompt(opts: {
	spec: MotionReferenceSpec;
	brandName?: string | null;
	language?: string | null;
	duration: number;
	source?: string | null;
}): string {
	const lang = opts.language?.trim() || 'Italian';
	const reachable = reachableBeats(opts.spec);
	const sheet = reachable
		.map((b, i) => `${i}. ${b.at_s}s — ${b.on_screen}${b.motion ? ` | ${b.motion}` : ''}`)
		.join('\n');

	return `You are checking whether a finished Remotion clip actually built the structure it was given.

THE PLAN it was built from (${opts.spec.format}, originally ${opts.spec.duration_s}s):
${sheet}

Transitions the plan used: ${opts.spec.transitions.join('; ') || '(none recorded)'}

THE CLIP you are watching is ~${opts.duration.toFixed(1)}s for ${opts.brandName?.trim() || 'another brand'}. It is NOT supposed to look like the reference — different palette, different type, different logo, different copy. It IS supposed to have the same beat SHAPE: the same states of the screen, in the same order, at proportional timings.

For each planned beat, say whether the clip has a beat doing the same JOB in the sequence:
- present — a beat with the same role and roughly the same position is there, in this brand's own clothes.
- altered — something in that slot, but the role changed (a headline where the plan had a UI demo).
- missing — nothing in the clip serves that purpose.

Judge the ROLE, never the artwork. Same job, different look = present. Different job, similar look = altered.
Length differs on purpose: if the clip is shorter, beats compress — proportional position is what matters, not the second.
Then say whether the surviving beats are in the plan's ORDER.

${opts.source?.trim() ? `REMOTION SOURCE (truncated — correlate a beat with the code that draws it):\n${opts.source.trim().slice(0, SOURCE_SNIPPET_CHARS)}` : ''}

Write summary and next_test in ${lang}; keep statuses in English. next_test must be ONE concrete change.

Return JSON.`;
}

const FIDELITY_SCHEMA = {
	type: 'object' as const,
	properties: {
		beats: {
			type: 'array' as const,
			description: 'One entry per planned beat, in the plan\'s order.',
			items: {
				type: 'object' as const,
				properties: {
					index: { type: 'integer' as const, description: 'Index of the planned beat, 0-based.' },
					status: { type: 'string' as const, enum: ['present', 'altered', 'missing'] },
					note: { type: 'string' as const, description: 'What was expected and what is there instead.' }
				},
				required: ['index', 'status']
			}
		},
		order_kept: { type: 'boolean' as const, description: 'Are the surviving beats in the plan\'s order?' },
		summary: { type: 'string' as const, description: 'Two sentences: how close the clip is to the plan.' },
		next_test: { type: 'string' as const, description: 'One concrete change that would close the biggest gap.' }
	},
	required: ['beats', 'order_kept', 'summary']
};

export type StudiedReference = {
	id: string;
	brand: string | null;
	spec: MotionReferenceSpec;
};

/**
 * The references a composition was built from, with their specs.
 *
 * Service-role: both tables are RLS-on with no policy. Returns nothing when the video was built
 * without the wall — which is most of them, and is why the caller must treat empty as "no check to
 * run" rather than as a failing score.
 */
export async function loadStudiedReferences(videoId: string): Promise<StudiedReference[]> {
	try {
		const admin = createAdminClient();
		const { data: links } = await admin
			.from('motion_video_references')
			.select('reference_id')
			.eq('video_id', videoId)
			.order('created_at', { ascending: false })
			.limit(MAX_REFERENCES_CHECKED);
		const ids = (links ?? []).map((l) => String((l as { reference_id: string }).reference_id));
		if (!ids.length) return [];
		const { data: specs } = await admin
			.from('motion_reference_specs')
			.select('id, brand, spec')
			.in('id', ids)
			.eq('spec_version', MOTION_SPEC_VERSION);
		return (specs ?? [])
			.map((row) => {
				const r = row as { id: string; brand: string | null; spec: MotionReferenceSpec };
				return { id: r.id, brand: r.brand, spec: r.spec };
			})
			.filter((r) => Array.isArray(r.spec?.beats));
	} catch (e) {
		console.warn(`[fidelity] reference load failed: ${e instanceof Error ? e.message : String(e)}`);
		return [];
	}
}

export async function reviewReferenceFidelity(opts: {
	url: string;
	reference: StudiedReference;
	source?: string | null;
	brandName?: string | null;
	language?: string | null;
	abortSignal?: AbortSignal;
}): Promise<
	| { ok: true; fidelity: ReferenceFidelity; spec: MotionReferenceSpec }
	| { ok: false; error: string }
> {
	if (!llmConfigured()) return { ok: false, error: 'gemini_unconfigured' };
	const spec = opts.reference.spec;
	const reachable = reachableBeats(spec);
	// Nothing reachable was ever asked for, so nothing can be missing. The study already told the
	// agent to walk away from this reference; scoring it would punish it for listening.
	if (!reachable.length) return { ok: false, error: 'no_reachable_beats' };

	const gateBrand = getBrandContext();
	if (gateBrand) {
		const { gateCredits } = await import('$lib/server/credits');
		await gateCredits(gateBrand);
	}

	const bytes = await fetchVideoBytes(opts.url);
	if (opts.abortSignal?.aborted) return { ok: false, error: 'aborted' };
	const media = bytes ? await prepareReviewMedia(bytes) : null;
	if (!media) return { ok: false, error: 'media_extract_failed' };

	try {
		// QC video sul centralino (`llmVideoReviewerModel`): kie ignorava `videoMetadata.fps: 4`.
		const frameNote = media.frames.map((f, i) => `${i + 1}. ${f.label}`).join('\n');
		const prompt = [
			fidelityPrompt({
				spec,
				brandName: opts.brandName,
				language: opts.language,
				duration: media.duration,
				source: opts.source
			}),
			frameNote ? `\nSTILLS (in order):\n${frameNote}` : '',
			media.videoMp4 ? '\nTHE FINISHED CLIP is attached (watch the beats in order).' : ''
		]
			.filter(Boolean)
			.join('');
		const raw = (await llmStructured<AnyRec>({
			prompt,
			schema: FIDELITY_SCHEMA,
			images: media.frames.map((f) => ({ mediaType: f.mimeType, data: f.data })),
			file: media.videoMp4
				? { mediaType: 'video/mp4', data: media.videoMp4.toString('base64') }
				: undefined,
			model: llmVideoReviewerModel(),
			label: 'motion.reference_fidelity'
		})) as AnyRec | null;
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'model_parse_failed' };
		return {
			ok: true,
			spec,
			fidelity: finalizeFidelity(
				raw,
				{ id: opts.reference.id, brand: opts.reference.brand },
				reachable.length
			)
		};
	} catch (e) {
		if (e instanceof Error && e.name === 'CreditsExhaustedError') throw e;
		console.error(`[fidelity] failed: ${e instanceof Error ? e.message : String(e)}`);
		return { ok: false, error: 'model_failed' };
	}
}

/** Compact shape for the QC tool result. */
export function compactFidelity(f: ReferenceFidelity, spec: MotionReferenceSpec) {
	const reach = buildabilityOf(spec);
	return {
		reference_id: f.reference_id,
		reference_brand: f.reference_brand,
		fidelity: f.fidelity,
		verdict: f.verdict,
		order_kept: f.order_kept,
		checked_beats: f.checked,
		out_of_reach_beats: reach.out_of_reach,
		missing: f.beats.filter((b) => b.status === 'missing').length,
		altered: f.beats.filter((b) => b.status === 'altered').length,
		summary: f.summary,
		next_test: f.next_test
	};
}
