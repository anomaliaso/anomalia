/**
 * Technical craft judge for Motion Video (Remotion kinetic ads).
 *
 * This is NOT the organic/ads sellability review (`video-review.ts`).
 * It answers: is the clip well made, is the content right, is it pleasant,
 * and are transitions intact (no broken iris/slide, no hard cuts, no freeze-before-cut).
 *
 * Scores are in-process only — `video_reviews.standard` is CHECK (organic, ads).
 */
import { MOTION_CRAFT_SPECS } from '$lib/motion-video/craft';
import { findStaticTails, type StasisViolation } from '$lib/motion-video/easing';
import { detectWowMechanisms, type WowMechanisms } from '$lib/motion-video/transitions-cookbook';
import { getBrandContext } from '$lib/server/ai-log';
import { llmConfigured, llmStructured, llmVideoReviewerModel } from '$lib/server/llm';
import { isVideoUrl } from '$lib/content-formats';
import {
	clampScore,
	fetchVideoBytes,
	prepareReviewMedia,
	type VideoReviewIssue,
	type VideoReviewVerdict
} from '$lib/server/video-review';
import { reviewNeedsRewrite } from '$lib/server/video-review-apply';

const SOURCE_SNIPPET_CHARS = 8_000;

export const MOTION_CRAFT_DIMENSIONS = ['craft', 'content', 'pleasant', 'transitions'] as const;
export type MotionCraftDimensionId = (typeof MOTION_CRAFT_DIMENSIONS)[number];

export type MotionCraftReview = {
	verdict: VideoReviewVerdict;
	overall: number;
	duration_s: number;
	transitions_broken: boolean;
	scores: Record<MotionCraftDimensionId, number>;
	weakest_link: MotionCraftDimensionId | string;
	issues: VideoReviewIssue[];
	next_test: string;
	summary: string;
	judgment: string;
	on_screen: string;
};

const CRAFT_SCHEMA = {
	type: 'object' as const,
	properties: {
		transitions_broken: {
			type: 'boolean' as const,
			description:
				'True if any scene change is a hard cut, a 1-frame opacity pop, a freeze-then-cut, an incomplete iris/mask, or a slide that jumps/tears.'
		},
		scores: {
			type: 'object' as const,
			properties: {
				craft: {
					type: 'integer' as const,
					description: '1–10 well-made: easing, overshoot settle, motion through the cut, no wall-stop.'
				},
				content: {
					type: 'integer' as const,
					description: '1–10 right content: copy, brand, UI mockups of features — cropped past an edge, faithful to the real product, performing an action whose result lands (not headline-only cards, not static screenshots).'
				},
				pleasant: {
					type: 'integer' as const,
					description: '1–10 visual pleasantness: type, contrast, composition, hierarchy, not noisy or cheap.'
				},
				transitions: {
					type: 'integer' as const,
					description: '1–10 slide or iris/mask with overlap; 1 if broken/hard-cut.'
				}
			},
			required: ['craft', 'content', 'pleasant', 'transitions']
		},
		issues: {
			type: 'array' as const,
			items: {
				type: 'object' as const,
				properties: {
					dimension: {
						type: 'string' as const,
						description:
							"One of craft/content/pleasant/transitions — or 'legibility' for text that overlaps other text or melts into its background."
					},
					severity: { type: 'string' as const, enum: ['critical', 'major', 'nit'] as const },
					at_s: { type: 'number' as const },
					problem: { type: 'string' as const },
					fix: { type: 'string' as const }
				},
				required: ['dimension', 'severity', 'problem', 'fix']
			}
		},
		weakest_link: { type: 'string' as const },
		next_test: {
			type: 'string' as const,
			description: 'One-variable Remotion fix: Because [weakness], change [one thing] in the TSX.'
		},
		summary: { type: 'string' as const },
		judgment: { type: 'string' as const },
		on_screen: { type: 'string' as const, description: 'Readable on-screen copy, one line per block.' }
	},
	required: [
		'transitions_broken',
		'scores',
		'issues',
		'weakest_link',
		'next_test',
		'summary',
		'judgment'
	]
};

function asBool(v: unknown): boolean {
	return v === true || v === 'true' || v === 1;
}

export function craftVerdictFromScores(
	scores: Record<MotionCraftDimensionId, number>,
	issues: Pick<VideoReviewIssue, 'severity'>[],
	transitionsBroken: boolean
): { overall: number; verdict: VideoReviewVerdict } {
	const weight = (id: MotionCraftDimensionId): number => {
		if (id === 'transitions') return 1.6;
		if (id === 'craft') return 1.3;
		return 1;
	};
	let wsum = 0;
	let acc = 0;
	for (const id of MOTION_CRAFT_DIMENSIONS) {
		const w = weight(id);
		acc += scores[id] * w;
		wsum += w;
	}
	const overall = wsum ? Math.round((acc / wsum) * 10) / 10 : 1;
	const hasCritical = issues.some((i) => i.severity === 'critical');
	if (transitionsBroken || scores.transitions < 4 || overall < 4) {
		return { overall, verdict: 'kill' };
	}
	const ship =
		overall >= 7 &&
		scores.transitions >= 6 &&
		scores.craft >= 6 &&
		scores.pleasant >= 6 &&
		scores.content >= 6 &&
		!hasCritical;
	return { overall, verdict: ship ? 'ship' : 'fix' };
}

export function finalizeCraftReview(
	raw: Record<string, unknown>,
	duration_s: number,
	/** L'analisi statica del sorgente (detectWowMechanisms). Assente = sorgente non disponibile. */
	wow?: WowMechanisms | null,
	/** I beat con la coda ferma (findStaticTails). Assente = sorgente non disponibile. */
	stasis?: StasisViolation[] | null
): MotionCraftReview {
	const scoresRaw =
		raw.scores && typeof raw.scores === 'object' ? (raw.scores as Record<string, unknown>) : {};
	const scores = {
		craft: clampScore(scoresRaw.craft),
		content: clampScore(scoresRaw.content),
		pleasant: clampScore(scoresRaw.pleasant),
		transitions: clampScore(scoresRaw.transitions)
	};
	const issuesRaw = Array.isArray(raw.issues) ? raw.issues : [];
	const issues: VideoReviewIssue[] = issuesRaw
		.map((row) => {
			if (!row || typeof row !== 'object') return null;
			const r = row as Record<string, unknown>;
			const problem = String(r.problem ?? '').trim();
			const fix = String(r.fix ?? '').trim();
			if (!problem) return null;
			const sev = String(r.severity ?? 'major');
			const at = Number(r.at_s);
			return {
				dimension: String(r.dimension ?? 'craft'),
				severity: (sev === 'critical' || sev === 'nit' ? sev : 'major') as VideoReviewIssue['severity'],
				at_s: Number.isFinite(at) && at > 0 ? at : null,
				problem,
				fix: fix || problem
			} satisfies VideoReviewIssue;
		})
		.filter((x): x is VideoReviewIssue => !!x)
		.slice(0, 8);

	// IL GATE WOW, verificato nel codice e non nel gusto del giudice: 4+ beat senza NESSUN
	// meccanismo del ricettario (né shared-element né full-canvas scale) è la "slideshow con
	// easing" delle craft specs. Transitions viene tappato sotto la soglia di ship (6), così il
	// verdetto diventa FIX e il brief nomina la voce del ricettario da usare.
	if (wow && wow.beats >= 4 && !wow.fullCanvasScale && !wow.sharedElement) {
		scores.transitions = Math.min(scores.transitions, 5);
		issues.unshift({
			dimension: 'transitions',
			severity: 'major',
			at_s: null,
			problem: `${wow.beats} beat e nessun meccanismo wow nel sorgente: solo slide/fade tra le scene (slideshow con easing)`,
			fix: 'Prendi dal TRANSITIONS COOKBOOK: MATCH_CUT_DOT o ELEMENT_CARRYOVER per lo shared-element, FULL_CANVAS_SCALE o MASK_REVEAL_TYPE per la scala full-canvas'
		});
		if (issues.length > 8) issues.length = 8;
	}

	// IL GATE STASI, gemello del gate wow: un beat la cui coda è ferma è verificato in codice
	// (findStaticTails legge gli input range), non affidato all'occhio del giudice su still
	// campionati. Craft viene tappato sotto la soglia di ship (6) → verdetto FIX col beat nominato.
	if (stasis?.length) {
		scores.craft = Math.min(scores.craft, 5);
		issues.unshift({
			dimension: 'craft',
			severity: 'major',
			at_s: null,
			problem: `${stasis.length} beat con la coda FERMA nel sorgente: ${stasis
				.slice(0, 3)
				.map((s) => `${s.component} (ultimi ${(s.gapFrames / 30).toFixed(1)}s senza interpolate attive)`)
				.join(', ')} — nessuna scena deve mai essere statica, fino alla chiusura della transizione`,
			fix: 'Prolunga una pan di sfondo, un respiro di scala o una deriva lenta fino a durationInFrames del beat (vedi NO STATIC SCENES nelle craft specs)'
		});
		if (issues.length > 8) issues.length = 8;
	}

	const transitionsBroken = asBool(raw.transitions_broken) || scores.transitions < 4;
	const { overall, verdict: scoreVerdict } = craftVerdictFromScores(
		scores,
		issues,
		asBool(raw.transitions_broken)
	);
	// Un testo illeggibile non è un "nit di pleasant": qualunque issue di legibility sopra il nit
	// blocca lo ship — lo scrim/spostamento è una patch da un replace_source, non un'opinione.
	const legibilityBlock = issues.some((i) => i.dimension === 'legibility' && i.severity !== 'nit');
	const verdict = scoreVerdict === 'ship' && legibilityBlock ? 'fix' : scoreVerdict;
	const weakest =
		String(raw.weakest_link ?? '').trim() ||
		[...MOTION_CRAFT_DIMENSIONS].sort((a, b) => scores[a] - scores[b])[0] ||
		'transitions';

	return {
		verdict,
		overall,
		duration_s,
		transitions_broken: transitionsBroken,
		scores,
		weakest_link: weakest,
		issues,
		next_test: String(raw.next_test ?? '').trim(),
		summary: String(raw.summary ?? '').trim(),
		judgment: String(raw.judgment ?? raw.summary ?? '').trim(),
		on_screen: String(raw.on_screen ?? '').trim()
	};
}

export function compactCraftReview(review: MotionCraftReview) {
	return {
		overall: review.overall,
		verdict: review.verdict,
		judgment: review.judgment,
		next_test: review.next_test,
		weakest_link: review.weakest_link,
		summary: review.summary,
		scores: review.scores,
		transitions_broken: review.transitions_broken,
		issues: review.issues.slice(0, 6).map((i) => ({
			severity: i.severity,
			dimension: i.dimension,
			problem: i.problem,
			fix: i.fix
		})),
		must_rewrite: reviewNeedsRewrite(review)
	};
}

export function formatCraftApplyBrief(
	review: MotionCraftReview,
	opts?: { previewUrl?: string | null }
): string {
	const issueLines = review.issues
		.slice(0, 6)
		.map(
			(i) =>
				`- [${i.severity}] ${i.dimension}: ${i.problem}${i.fix ? ` → ${i.fix}` : ''}`
		);
	const issuesBlock = issueLines.length
		? issueLines.join('\n')
		: '- (no issue list — still apply next_test)';
	const broken = review.transitions_broken
		? '\nTRANSITIONS ARE BROKEN. Fix iris/slide overlap first. Never leave a hard cut or a freeze-then-cut.'
		: '';
	const watch = opts?.previewUrl?.trim()
		? `\nTHE CLIP YOU MADE: ${opts.previewUrl.trim()}\nWatch it before you touch the source. You are looking at your own work, not reading a description of it — every note below refers to something visible in those frames.\n`
		: '';
	return `MOTION CRAFT QC FAILED — verdict ${review.verdict.toUpperCase()} (${review.overall}/10). This version is NOT technically shippable. You MUST patch the Remotion TSX before any sellability rewrite.
${watch}

Judgment: ${review.judgment || review.summary}

Mandatory next test: ${review.next_test || 'Replace hard cuts with overlapping slide or iris/mask; keep motion through the cut.'}

Craft scores: craft ${review.scores.craft}/10, content ${review.scores.content}/10, pleasant ${review.scores.pleasant}/10, transitions ${review.scores.transitions}/10.
${broken}

Issues to fix:
${issuesBlock}

Patch the Remotion TSX now (grep_source → replace_source, or write_source if the structure must change). Apply every note: transitions (the wow mechanisms of the TRANSITIONS COOKBOOK when named), easing, overlap, type, legibility (scrim/plate behind text over imagery, no text over text), UI mockups (cropped, faithful, performing an action with its result). Do not reply without writing source. Do not argue with the verdict.`;
}

function buildCraftPrompt(opts: {
	brandName?: string | null;
	language?: string | null;
	duration: number;
	hasVideo: boolean;
	source?: string | null;
	wow?: WowMechanisms | null;
	stasis?: StasisViolation[] | null;
}): string {
	const lang = opts.language?.trim() || 'Italian';
	const brand = opts.brandName?.trim() || '(unknown brand)';
	const source = opts.source?.trim()
		? `REMOTION SOURCE (truncated — correlate broken motion with the TSX):\n${opts.source.trim().slice(0, SOURCE_SNIPPET_CHARS)}`
		: 'REMOTION SOURCE: (not provided — judge only from the clip)';
	const wow = opts.wow
		? `STATIC SOURCE ANALYSIS (already verified in code, do not re-derive): ${opts.wow.beats} beats; full-canvas scale mechanism in source: ${opts.wow.fullCanvasScale ? 'YES' : 'NO'}; match-cut / shared-element in source: ${opts.wow.sharedElement ? 'YES' : 'NO'}; real staggered group entrance (STAGGER_REVEAL, step ≥0.15s) in source: ${opts.wow.stagger ? 'YES' : 'NO'}. Where a mechanism is present, verify ON THE STILLS that the cut moment actually carries it — code that exists but reads as a plain cut on screen still costs transitions.${
				opts.stasis?.length
					? ` STATIC TAILS found in source: ${opts.stasis
							.slice(0, 4)
							.map((s) => `${s.component} freezes for its last ${(s.gapFrames / 30).toFixed(1)}s`)
							.join('; ')} — confirm on the stills and file them under craft.`
					: ''
			}`
		: '';
	const watch = opts.hasVideo
		? 'MEDIA: stills from scene changes plus the actual video. Watch transitions in order. A still that pops vs the previous still with no slide/iris is a hard cut.'
		: 'MEDIA: stills only. Infer transitions from still-to-still jumps. Be harsher when consecutive stills share no overlapping motion.';

	return `You are a senior design director — the kind who has spent twenty years shipping product film at a company where nothing goes out looking almost right. You are reviewing a FINISHED Remotion kinetic ad. This is CRAFT and TASTE, not sellability (no hook/CTA/offer scores).

Your standard is not "is it fine". It is: would this survive being put on the page next to work made by people who do only this? Almost everything you review would not, and saying so precisely is the job. Praise nothing you would not defend.

BRAND: ${brand}
CLIP LENGTH: ~${opts.duration.toFixed(1)}s

Watch protocol:
1. First frame — is type readable, is anything already moving?
2. Every scene change — slide with overlap, or iris/mask that completes? Flag hard cuts, 1-frame opacity pops, freeze-then-cut, torn slides, incomplete clipPath iris.
3. Easing — expo in-out su ogni movimento (piatta alle estremità, ripidissima in mezzo) + overshoot solo sull'ultima posa. Un movimento a velocità costante si riconosce a occhio: costa craft, e va nominato per nome ("lineare") invece che come "un po' meccanico". Nessun arresto contro il muro.
4. Motion through the cut — outgoing scene still moving as the next enters. Nothing parks on the last pose.
5. Content — copy matches a kinetic ad; features appear as programmatic UI mockups, not only headlines on cards.
5b. UI mockups — the three things that separate a product demo from a slide, judged on what you SEE:
   - CROPPED? The window must run past at least one edge. A complete window floating inside the frame reads as a picture of an app, not a screen you are looking at — and it is always too small to read. Flag "letterboxed mockup".
   - REAL? Does the interface look like the product, or like a generic dashboard someone invented — placeholder labels, arbitrary column widths, controls no product has? Flag "invented UI".
   - SCREENSHOT INSIDE A DRAWN UI? A real interface pasted into hand-made chrome is the worst case: two different products in one shot, one of them soft and frozen. Flag "screenshot in a drawn frame" — it costs both craft and content.
   - DOING SOMETHING, WITH A RESULT? A cursor that travels and clicks, a tap, text typed into a field, a toggle flipped — AND the consequence on screen in the same beat. A mockup that just sits there, or an action whose result never lands, demonstrates nothing. Flag "static mockup" or "action without result".
5c. LEGIBILITY — on EVERY still: is every on-screen text readable? Name any frame where text overlaps other text, or where text melts into the background — copy sitting naked on a photo/video frame without a scrim, plate or gradient band; white type on a bright area; dark type on a dark shot. Contrast intent: ≥4.5:1 body/UI text, ≥3:1 display type. File each moment as an issue with dimension "legibility" (critical when the copy cannot be read at all, major when it strains), and the fix names the remedy AND the beat: scrim/plate behind it, move it to a clean area, or recolor. Any non-nit legibility issue blocks ship.
5d. SCREENSHOT BACKGROUNDS — the highest-frequency real failure, check it frame by frame:
   - A full-bleed product screenshot is FULL OF ITS OWN TEXT. If the screenshot's labels, buttons or headlines are still readable behind the video's headline, the scrim is too weak — file it as legibility, name the competing background copy you can read.
   - TWO SCREENSHOTS CROSSFADED: any frame where two interfaces are superimposed through opacity is critical legibility, full stop. The fix is a cut, slide, mask or full-canvas move — never a dissolve between screenshots.
   - The headline's zone must be CLEAN: background UI detail bleeding through the headline's box (even faintly) is the "overlapping elements" defect — file it even when the headline itself remains readable, because the frame reads as clutter.
6. Shape — radii proportionate and consistent. A full pill (999) on a button, a CTA or any tall padded box is a lozenge, not a button; a percentage radius on a non-square box is an ellipse. Both cost pleasant.
6b. Audio — a motion video normally speaks. If there is no <Audio> at all, that is a defect unless the brief asked for silence. If there is: does any spoken line get cut off at the end of its beat (the beat is shorter than its clip), and does the music sit UNDER the voice rather than fighting it?
7. Pleasant — composition, contrast, type hierarchy. Cheap noise, clipped glyphs, or muddy colour = low pleasant.

WHAT A DESIGNER SEES THAT A CHECKLIST DOES NOT — go through these too:
- RESTRAINT: what is on screen that could be removed without losing meaning? Decoration that survives only because nobody questioned it is the most common failure. Count the elements in the busiest frame.
- SPACING: is there ONE spacing scale, or improvised numbers? Are the edge margins equal and generous? Is anything optically off-centre because it was centred mathematically instead of by eye?
- TYPE: one scale with a consistent ratio, or arbitrary sizes? More than two weights is usually indiscipline. At large sizes, is the tracking tightened? Are the line breaks chosen, or wherever the box ended?
- COLOUR: is one accent doing the work, or is everything competing? Does the contrast hold with the sound off and the brightness down?
- SHAPE: radii proportionate and consistent per role. A full pill on a tall padded button is a lozenge; a percentage radius on a non-square box is an ellipse.
- RHYTHM: do the beats breathe, or is it a slideshow at speed? Can each beat actually be READ in the time it is given?
- THE TELL: name the ONE thing that gives it away as machine-made. There is always one. If you cannot find it, you are not looking hard enough.

${MOTION_CRAFT_SPECS}

${watch}

${source}

${wow}

SCORING: integers 1–10. 1 = broken/absent, 5 = average, 8 = would ship craft, 10 = exceptional. Be harsh — most first drafts are 4–6, and a piece with a visible tell is not an 8 however clean the rest is.
If transitions are broken, set transitions_broken=true and score transitions ≤3.
LANGUAGE: write summary, issues, next_test, judgment in ${lang}. Keep dimension ids and enums in English.

next_test MUST be one Remotion variable: "Because [weakest_link], change [exactly one TSX thing]."

Return JSON.`;
}

export async function reviewMotionCraft(opts: {
	url: string;
	source?: string | null;
	brandName?: string | null;
	language?: string | null;
	abortSignal?: AbortSignal;
}): Promise<{ ok: true; review: MotionCraftReview } | { ok: false; error: string }> {
	if (!llmConfigured()) return { ok: false, error: 'gemini_unconfigured' };
	const target = opts.url?.trim();
	if (!target || !/^https?:\/\//i.test(target)) return { ok: false, error: 'invalid_url' };

	const gateBrand = getBrandContext();
	if (gateBrand) {
		const { gateCredits } = await import('$lib/server/credits');
		await gateCredits(gateBrand);
	}

	const bytes = isVideoUrl(target) ? await fetchVideoBytes(target) : null;
	if (opts.abortSignal?.aborted) return { ok: false, error: 'aborted' };
	const media = bytes ? await prepareReviewMedia(bytes) : null;
	if (!media) return { ok: false, error: 'media_extract_failed' };

	try {
		// QC video sul centralino (`llmVideoReviewerModel`): kie ignorava `videoMetadata.fps: 4`.
		const wow = opts.source?.trim() ? detectWowMechanisms(opts.source) : null;
		const stasis = opts.source?.trim() ? findStaticTails(opts.source) : null;
		const frameNote = media.frames.map((f, i) => `${i + 1}. ${f.label}`).join('\n');
		const prompt = [
			buildCraftPrompt({
				brandName: opts.brandName,
				language: opts.language,
				duration: media.duration,
				hasVideo: !!media.videoMp4,
				source: opts.source,
				wow,
				stasis
			}),
			frameNote ? `\nSTILLS (in order):\n${frameNote}` : '',
			media.videoMp4 ? '\nFULL CLIP is attached (watch scene changes in order).' : ''
		]
			.filter(Boolean)
			.join('');
		const parsed = await llmStructured<Record<string, unknown>>({
			prompt,
			schema: CRAFT_SCHEMA,
			images: media.frames.map((f) => ({ mediaType: f.mimeType, data: f.data })),
			file: media.videoMp4
				? { mediaType: 'video/mp4', data: media.videoMp4.toString('base64') }
				: undefined,
			model: llmVideoReviewerModel(),
			label: 'motion.craft_review'
		});
		if (!parsed) return { ok: false, error: 'model_parse_failed' };
		return { ok: true, review: finalizeCraftReview(parsed, media.duration, wow, stasis) };
	} catch (e) {
		if (e instanceof Error && e.name === 'CreditsExhaustedError') throw e;
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`[reviewMotionCraft] failed: ${msg}`);
		return { ok: false, error: 'model_failed' };
	}
}
