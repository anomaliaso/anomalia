import { swallow } from '$lib/server/swallow';
import { bilingualNoticeLocale } from '$lib/i18n/locale';
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { tool, stepCountIs, hasToolCall, type ModelMessage, type UIMessage } from 'ai';
import { harnessStreamText } from '$lib/server/harness';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { transform } from 'sucrase';
import { MOTION_CRAFT_SPECS } from '$lib/motion-video/craft';
import { MOTION_TRANSITIONS_COOKBOOK_PROMPT } from '$lib/motion-video/transitions-cookbook';
import { trendingWallDigestSection } from '$lib/server/wall-digest';
import { motionImportContract } from '$lib/motion-video/modules';
import {
	MOTION_ASPECTS,
	MOTION_FPS,
	MOTION_SOURCE_MAX_CHARS,
	formatMotionDurationPreset,
	motionFramesForDuration,
	motionSizeForAspect,
	parseMotionAspectRatio,
	parseMotionDuration,
	type MotionAspectRatio,
	type MotionDurationPreset
} from '$lib/motion-video/source';
import {
	formatMotionSessionRoster,
	formatMotionTargetingRules
} from '$lib/motion-video/session-targets';
import {
	MOTION_READ_DEFAULT_CHARS,
	MOTION_READ_MAX_CHARS,
	applyReplace,
	grepSource,
	newImageUrls,
	referenceHotlink,
	sliceSource
} from '$lib/motion-video/source-ops';
import { resolveUserTurnMediaParts, type MediaPart } from '$lib/media-parts';
import { extractSdkUsage, logAiCall } from '$lib/server/ai-log';
import { CHAT_USER_ERROR } from '$lib/server/chat/report-error';
import { MOTION_ASSET_MINT_HINT } from '$lib/server/media-origin';
import { mintStandaloneImage } from '$lib/server/mint-standalone-image';
import { loadMediaLibraryPromptSection } from '$lib/server/brand-media';
import { createAdminClient } from '$lib/server/supabase-admin';
import { createMediaLibraryTools } from '$lib/server/chat/media-library-tools';
import {
	brandContextPromptSection,
	createBrandContextTools
} from '$lib/server/chat/brand-context-tools';
import { disruptiveBriefSection } from '$lib/disruptive';
import {
	MOTION_EXPO_IN_OUT,
	MOTION_OVERSHOOT_OUT,
	findDeadEntrances,
	findDurationMismatch,
	findFrozenBackplate,
	findLinearMotion,
	findStaticTails,
	formatDeadEntrances,
	formatDurationMismatch,
	formatFrozenBackplate,
	formatEasingViolations,
	formatStasisViolations
} from '$lib/motion-video/easing';
import { MOTION_SLICE_MAX_STEPS, type DesignerSliceEnd } from '$lib/designer-limits';
import {
	MOTION_REFERENCE_PROMPT,
	buildReferenceStepPatch,
	createMotionReferenceTools,
	type ReferenceStudy
} from '$lib/server/motion-video/reference-tools';
import { pickTools } from '$lib/server/chat/agents';
import { createChatTools } from '$lib/server/chat/tools';
import { createAgentBase } from '$lib/server/agent-base';
import { isSandboxConfigured } from '$lib/server/sandbox';
import { createMotionRenderTools, readSourceMeta } from '$lib/server/motion-video/render-tools';
import { createMotionOutputTools } from '$lib/server/motion-video/output-tools';
import { geminiFast } from '$lib/server/chat/model';
import { motionAgentModel } from '$lib/server/motion-video/model';

export type MotionPersistResult = { id: string; title: string };

export type MotionPersistFn = (opts: {
	id?: string | null;
	title: string;
	source: string;
}) => Promise<MotionPersistResult>;

export type MotionAgentTarget = {
	id: string;
	title: string;
	source: string;
	width?: number;
	height?: number;
	fps?: number;
	durationInFrames?: number;
	/** L'MP4 già reso, se esiste: serve a dire che dopo un edit NON corrisponde più al sorgente. */
	previewUrl?: string | null;
};

function extractText(message: UIMessage): string {
	return message.parts
		.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
		.map((p) => p.text)
		.join('');
}

function assertSourceSyntax(source: string) {
	if (!source.trim()) throw new Error('Empty source');
	if (source.length > MOTION_SOURCE_MAX_CHARS) {
		throw new Error(`Source exceeds ${MOTION_SOURCE_MAX_CHARS} characters`);
	}
	transform(source, { transforms: ['typescript', 'jsx', 'imports'], production: true });
}

/**
 * "Never invent image URLs" in the prompt is not enforcement — the model happily writes a
 * plausible-looking `https://storage.googleapis.com/<bucket>/render_<uuid>.png` that 403s, and the
 * failure only surfaces much later as Remotion's "Error loading image with src". Anything the model
 * introduces has to actually load; URLs already known (brand brief, media section, previous source)
 * are trusted as-is so a brand site that blocks our fetch never blocks an edit.
 */
async function assertImageUrlsLoad(next: string, known: string) {
	const urls = newImageUrls(next, known);
	const checked = await Promise.all(
		urls.map(async (url) => {
			const ok = await fetch(url, {
				method: 'GET',
				headers: { Range: 'bytes=0-0' },
				signal: AbortSignal.timeout(5000)
			})
				.then((r) => r.ok || r.status === 206)
				.catch((error) => { swallow('then failed', error); return false; });
			return ok ? null : url;
		})
	);
	const dead = checked.filter(Boolean);
	if (dead.length) {
		throw new Error(
			`These <Img> URLs do not load: ${dead.join(', ')}. Never invent an image URL — call generate_image or use_library_image and paste the URL it returns.`
		);
	}
}

/**
 * What the studio does NOT take from the chat's motion agent, and why each one.
 *
 * The studio agent had fifteen tools against the chat agent's sixty-three, which is why it invented
 * product UI it could have captured and wrote claims it could have read. It now takes that agent's
 * set — same specialist, same capabilities — minus three groups that are wrong HERE specifically:
 *
 *  1. The id-taking source tools. The studio's own `write_source` / `replace_source` / `set_title`
 *     are bound to the tiles selected for this turn and honour the canvas and reflow rules the
 *     picker set. `write_motion_source(video_id)` bypasses all of that and would let a turn edit a
 *     composition nobody selected.
 *  2. Chat affordances the workbench cannot draw. `ask_user_questions` renders clickable options in
 *     the chat and NOTHING here — the model would ask and the user would never see the question.
 *     A tool whose output the surface cannot render is worse than a missing one.
 *  3. The SEO research pack. Seven DataForSEO endpoints, the audits and the blog reads cannot
 *     inform a six-second kinetic ad; they are in the shared set for the chat's convenience and
 *     here they are only schema in the context window.
 */
const MOTION_STUDIO_EXCLUDED = new Set([
	// 1 — the studio owns these, bound to the selection
	'create_motion_video',
	'list_motion_videos',
	'grep_motion_source',
	'read_motion_source',
	'replace_motion_source',
	'write_motion_source',
	// 2 — no renderer on this surface
	'ask_user_questions',
	'propose_open_tab',
	'offer_upgrade',
	'show_setup_checklist',
	'check_job_status',
	'set_section_status',
	'update_demo_account',
	// 3 — cannot inform a composition
	// Il pacchetto dfs_* stava qui, e il 23/8/2026 ha seguito i cinque qui sotto: è uscito da
	// SHARED_TOOL_KEYS ed è tornato a `web`. Non arriva più, quindi non c'è più niente da
	// escludere — e nominarlo lo stesso sarebbe un'esclusione che non esclude nulla.
	// I cinque tool di SEO/blog/sito che stavano qui sono spariti dall'elenco il 22/8/2026, e non
	// perché servissero: perché hanno smesso di arrivare. Erano in SHARED_TOOL_KEYS — cioè in mano
	// a ogni mestiere — e sono tornati a `web`, l'unico che li possiede. Escluderli qui adesso non
	// escluderebbe niente, ed è esattamente ciò che il test di questo elenco impedisce.
	// 4 — la base li monta già, e li monta GIUSTI. `chat/tools.ts` monta i goal tool senza
	//     condizioni (anche con threadId undefined — i turni di patch della QC non ne hanno uno),
	//     e in `attach` i tool di superficie vincono le collisioni: il set_goal senza thread della
	//     chat scavalcava quello condizionato di `agent-base.ts` (full && threadId), che è il
	//     pattern corretto. Esclusi qui, resta solo il mount della base.
	'set_goal',
	'update_goal',
	'close_goal'
]);

/** The chat motion agent's tools, minus what does not belong on this surface. */
function studioChatTools(
	supabase: SupabaseClient,
	brandId: string,
	userId: string,
	threadId?: string,
	/** Dashboard locale: feeds `report_locale` of the async jobs these tools enqueue. */
	locale?: string
) {
	const scoped = pickTools(
		// Bilingual normalization here, not at each caller: an untyped/absent locale must be
		// English — the hardcoded 'it' used to send amazon.in-style users Italian job reports.
		createChatTools(supabase, brandId, 'Europe/Rome', userId, '', bilingualNoticeLocale(locale), threadId),
		'motion'
	);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(scoped)) {
		if (!MOTION_STUDIO_EXCLUDED.has(key)) out[key] = value;
	}
	return out;
}

/**
 * The reference wall gives the model structure, never pixels. `referenceHotlink` is what makes that
 * true rather than merely stated — see its comment for why `assertImageUrlsLoad` cannot catch this.
 */
function assertNoReferenceHotlinks(source: string) {
	const hit = referenceHotlink(source);
	if (hit) {
		throw new Error(
			`Never embed media from the reference wall (${hit}). posts.design curates other brands’ posts — take the structure and rebuild it with generate_image / use_library_image assets in this brand’s palette.`
		);
	}
}

/** Refinement passes a brand-new composition must take before it can be called done. */
const MIN_REFINEMENT_PATCHES = 3;
/**
 * How many times `finish` may be refused before it is allowed through regardless.
 *
 * The turn ends on finish, the step cap or the deadline, so an unbounded refusal turns a model that
 * cannot comply into a slice that burns every step and saves nothing. Two pushes, then it ships.
 */
const MAX_FINISH_REFUSALS = 2;

function durationRule(
	duration: MotionDurationPreset,
	createMode: boolean,
	keepExistingTiming: boolean
): string {
	if (keepExistingTiming) {
		return `- Length: Keep the existing durationInFrames (and fps) unless the user explicitly asks to change length. Do not retarget to a new duration.`;
	}
	if (duration === 'auto') {
		return createMode
			? `- Length: AUTO — derive it from the BEATS, never from a default. A beat needs 2.5–4s to be read: six beats is 18–24s, not 8. Count the beats you are going to build, multiply, then set durationInFrames. A studied reference gives you that count directly. Under ~10s only for a piece that genuinely has two or three beats. Do not exceed 90s (1m:30) unless the brief asks.\n- THE LENGTH SERVES THE VIDEO, never the other way round. Nobody watching counts the seconds; they notice a line cut off mid-word, a beat that flashes past unread, a transition with no room to happen. So if a voice clip does not fit its beat, or two beats need air between them, LENGTHEN the composition — raise durationInFrames and say so in one line. Trimming the audio, speeding up a beat or dropping the last word to hit a number is the one trade you never make.`
			: `- Length: AUTO. Keep each selected video's existing durationInFrames unless the user explicitly asks to shorten or lengthen.`;
	}
	const frames = motionFramesForDuration(duration, MOTION_FPS);
	const label = formatMotionDurationPreset(duration);
	return createMode
		? `- Length: target ${label} — an OBJECTIVE, not a ceiling. export const fps = ${MOTION_FPS}; export const durationInFrames = ${frames}. Time every beat across the full ${label} — do not leave a 6s ad padded with empty hold. But if the voice-over does not fit inside ${label}, go over it: raise durationInFrames until every line has its beat, and say in one line that you did. A few seconds long is invisible; a line cut off mid-word is the first thing anyone notices.`
		: `- Length: retime to ${label} (durationInFrames = fps*${duration}, typically ${frames} at ${MOTION_FPS}fps) unless the user asked otherwise. Stretch or compress beats; do not pad with empty hold. ${label} is the objective, not a ceiling — going a few seconds over so a spoken line fits whole is right, cutting the line to hit the number is not.`;
}

function sourceContract(
	aspect: MotionAspectRatio,
	forceCanvas: boolean,
	duration: MotionDurationPreset,
	createMode: boolean,
	keepExistingTiming: boolean
) {
	const { width, height } = motionSizeForAspect(aspect);
	const canvasRule = forceCanvas
		? `- Canvas MUST be ${width}×${height} (${aspect}). export const width = ${width}; export const height = ${height}. Allowed canvases only: 1080×1080 (1:1), 1080×1920 (9:16), 1920×1080 (16:9). Never 4:5. generate_image stills should use ${aspect}.`
		: `- Keep each selected video's existing width/height. Do not reflow to a different aspect unless the user explicitly asks to change format. Allowed canvases: 1080×1080 (1:1), 1080×1920 (9:16), 1920×1080 (16:9). Never 4:5. generate_image stills should match that video's canvas (default ${aspect}).`;
	return `Remotion TSX contract:
- import React from 'react'
- import { AbsoluteFill, Img, Series, Sequence, useCurrentFrame, interpolate, spring, Easing, useVideoConfig, ... } from 'remotion'
- export const fps, durationInFrames, width, height (numbers)
- export default function MotionVideo() { ... }
${motionImportContract()}
- Brand logo: remotion <Img src={logoUrl} /> with the URL from the brief — never fake a mark
- Photos / illustrations: remotion <Img src="https://..." /> with a URL from use_library_image, generate_image, the brand logoUrl, or a Media library https URL. Never invent URLs. Never require() local files.
- fontFamily: exact brand font names from the brief (the renderer loads them). If none, Inter — clean minimal sans, never a decorative family.
${durationRule(duration, createMode, keepExistingTiming)}
${canvasRule}
- Follow DEFAULT CRAFT: brand type, slide or iris/mask transitions, extreme ease-in-out + overshoot settle, motion through the cut, programmatic UI mockups of every feature, Nano Banana Pro URLs for photos inside those UIs`;
}

export async function runMotionVideoAgent(opts: {
	messages: UIMessage[];
	brandName: string;
	/** Seed TSX when creating a new video (no selection). */
	seedSource: string;
	/** Currently selected videos — edits target these. Empty → create mode. */
	selected: MotionAgentTarget[];
	/** Palette, type, logo, visual style from brand_kit. */
	brandBrief?: string;
	/** Raster data-URL of the brand mark so the model can see it. */
	logoImage?: string;
	/** Extra stills (uploads + ads library thumbs) attached to the first user turn. */
	referenceImages?: string[];
	/** Human-readable note about attached ads / uploads. */
	referenceNote?: string;
	/** Wall shortlist for this brief, already searched (create turns only). See run-turn.ts. */
	referenceCandidates?: string;
	/** Prompt-picker canvas. Allowed: 1:1, 9:16, 16:9. */
	aspectRatio?: MotionAspectRatio;
	/** Prompt-picker length. `auto` (default) lets the model pick. */
	duration?: MotionDurationPreset;
	/** Edit a duplicate: force the picker canvas (do not keep the source aspect). */
	reflowAspect?: boolean;
	brandId?: string;
	userId?: string;
	/** Thread di questo giro: un artefatto appartiene a una conversazione (vedi run-turn). */
	threadId?: string;
	/** Dashboard locale: i tool condivisi della chat firmano così i job async che aprono. */
	locale?: string;
	supabase?: SupabaseClient;
	/** Persist successful writes so a dropped SSE still leaves a row in the gallery. */
	persist?: MotionPersistFn;
	abortSignal?: AbortSignal;
	/** Soft wall — stop between steps so a continuation job can pick up. */
	deadlineReached?: () => boolean;
	/**
	 * Quanto tempo resta al turno. `deadlineReached` basta a fermare il loop fra uno step e l'altro;
	 * questo serve ai sotto-agenti, che devono sapere PRIMA di partire se hanno il tempo di finire —
	 * una delega che muore a metà ha speso il modello e non torna niente.
	 */
	remainingMs?: () => number;
	consumeSseStream?: (args: { stream: ReadableStream<string | Uint8Array> }) => Promise<void>;
	/** Called when this slice ends — used to chain another job if work remains. */
	onSliceEnd?: (info: DesignerSliceEnd) => void;
}): Promise<Response> {
	const { messages, brandName, brandId, userId, seedSource, persist, supabase } = opts;
	const aspect = parseMotionAspectRatio(opts.aspectRatio);
	const duration = parseMotionDuration(opts.duration);
	const canvas = motionSizeForAspect(aspect);
	const brandBrief = opts.brandBrief?.trim() || `Brand: ${brandName}`;
	const selected = [...opts.selected];
	const byId = new Map(selected.map((v) => [v.id, { ...v }]));
	/** Scratch pad for a brand-new composition in create mode. */
	let draft: { id?: string; title: string; source: string } | null =
		selected.length === 0 ? { title: `${brandName} motion`, source: seedSource } : null;
	const t0 = Date.now();
	/** Risolto UNA volta: il turno, i delegati, i tool del muro e `ai_calls` devono dire lo stesso. */
	const motion = motionAgentModel();
	const createMode = selected.length === 0;
	const reflowAspect = opts.reflowAspect === true && !createMode;
	const forceCanvas = createMode || reflowAspect;
	let calledFinish = false;
	/** Cio` che l'agente dice di aver costruito: la sola prosa che un chiamante delegante riceve. */
	let finishSummary = '';
	let finishUnreviewed = false;

	/**
	 * A new composition is not one call.
	 *
	 * In CREATE mode the whole file IS "a wholly new structure", so the rule that reserves
	 * `write_source` for exactly that made a single 30k-character write the correct move — and the
	 * agent took it every time: read the seed, write everything, set the title, finish. Nothing in
	 * the loop ever asked it to look at what it had produced. The result is what one pass produces:
	 * eight beats crammed into eight seconds, transitions named but not built, no arc.
	 *
	 * So the skeleton is written once and then REFINED, and `finish` is what enforces it. A prompt
	 * line asking nicely would not: today alone, two rules that were only prompt lines went
	 * unobserved until someone read the database.
	 */
	let writeCount = 0;
	let patchCount = 0;
	let readAfterWrite = false;
	let finishRefusals = 0;

	async function commit(target: { id?: string; title: string; source: string }) {
		if (!persist) return target.id ? { id: target.id, title: target.title } : null;
		return persist({ id: target.id ?? null, title: target.title, source: target.source });
	}

	type Resolved =
		| { mode: 'create'; get: () => { id?: string; title: string; source: string } }
		| { mode: 'edit'; id: string; get: () => MotionAgentTarget };

	function resolve(video_id?: string): Resolved {
		if (createMode) {
			if (!draft) throw new Error('No draft');
			return { mode: 'create', get: () => draft! };
		}
		const id = video_id ?? (selected.length === 1 ? selected[0].id : undefined);
		if (!id) throw new Error('video_id required when multiple videos are selected');
		const v = byId.get(id);
		if (!v) throw new Error(`Unknown video_id ${id}`);
		return { mode: 'edit', id, get: () => v };
	}

	/** replace/grep without video_id hit every selected tile (multi-edit). */
	function resolveTargets(video_id?: string): Resolved[] {
		if (createMode || video_id || selected.length <= 1) return [resolve(video_id)];
		return selected.map((v) => {
			const cur = byId.get(v.id);
			if (!cur) throw new Error(`Unknown video_id ${v.id}`);
			return { mode: 'edit' as const, id: v.id, get: () => byId.get(v.id)! };
		});
	}

	function putSource(resolved: Resolved, source: string, title?: string) {
		if (resolved.mode === 'create') {
			if (!draft) throw new Error('No draft');
			draft = { ...draft, source, ...(title != null ? { title } : {}) };
			return;
		}
		const v = byId.get(resolved.id);
		if (!v) throw new Error(`Unknown video_id ${resolved.id}`);
		v.source = source;
		if (title != null) v.title = title;
		byId.set(resolved.id, v);
	}

	async function persistResolved(
		resolved: Resolved,
		extra: Record<string, unknown> = {}
	): Promise<Record<string, unknown>> {
		const cur = resolved.get();
		const saved = await commit({
			id: resolved.mode === 'edit' ? resolved.id : cur.id,
			title: cur.title,
			source: cur.source
		});
		if (resolved.mode === 'create' && saved && draft) draft.id = saved.id;
		const after = resolved.get();
		// L'MP4 in galleria è stato reso da un sorgente che ORA non esiste più: va detto, o il
		// modello non sa distinguere il re-render legittimo (dopo un edit / per la QC, che confronta
		// anteprima e sorgente) da quello cosmetico che il tetto giornaliero esiste per fermare.
		const stalePreview =
			resolved.mode === 'edit' && !!(after as MotionAgentTarget).previewUrl;
		return {
			ok: true as const,
			mode: resolved.mode,
			video_id: saved?.id ?? (resolved.mode === 'edit' ? resolved.id : after.id),
			title: after.title,
			source_chars: after.source.length,
			...(stalePreview
				? {
						preview_stale: true,
						preview_note:
							'The rendered MP4 in the gallery no longer matches this source. A render_motion_video after your edits is legitimate; rendering without further changes is not.'
					}
				: {}),
			...extra
		};
	}

	const canvasLine = forceCanvas
		? reflowAspect
			? `Reflow this COPY to ${canvas.width}×${canvas.height} (${aspect}). The original video is not in this session. Update export const width/height and the layout so it feels native at ${aspect} — no letterboxing.`
			: `Canvas: ${canvas.width}×${canvas.height} (${aspect}). export const width = ${canvas.width}; export const height = ${canvas.height}.`
		: `Keep each selected video's existing canvas. Do not change width/height or reflow to ${aspect} unless the user explicitly asks to change format.`;
	const lengthLine = reflowAspect
		? 'Length: keep the current durationInFrames unless the user asks to change it. Reflow layout only — do not retarget length.'
		: duration === 'auto'
			? createMode
				? 'Length: AUTO — pick what fits the brief (~6s default).'
				: 'Length: AUTO — keep the current durationInFrames unless the user asks to change it.'
			: createMode
				? `Length: ${formatMotionDurationPreset(duration)} (${motionFramesForDuration(duration, MOTION_FPS)} frames at ${MOTION_FPS}fps). Time the whole piece to that length.`
				: `Length: retime to ${formatMotionDurationPreset(duration)} (${motionFramesForDuration(duration, MOTION_FPS)} frames at ${MOTION_FPS}fps) unless the user asked otherwise.`;
	const targetingRules = formatMotionTargetingRules({
		createMode,
		reflowAspect,
		count: selected.length
	});
	const roster = createMode ? '' : formatMotionSessionRoster(selected);
	const selectedBlock = createMode
		? `Mode: CREATE. A seed draft is in memory (${seedSource.length} chars) — headline/sub copy, brand colors, fonts, optional logo <Img>. Do not dump or rewrite the whole file unless the brief needs a new structure.
${targetingRules}
${canvasLine}
${lengthLine}
HOW A NEW COMPOSITION IS BUILT — in passes, never in one call:
1. Say the beats out loud first (one status line): what is on screen at each one, and the arc they form.
2. write_source ONCE: the SKELETON. Every scene present, timed, with its copy and layout. Structure, not polish.
3. Then read_source scene by scene and replace_source repeatedly to bring in what a skeleton never has: the transition mechanism between each pair of scenes, the easing and overshoot on every entrance, motion that keeps running through the cut, and the UI beat for each feature.
4. Re-read what you actually wrote before you call finish. finish is refused on a composition that was written once and never revisited.
Tools: grep_source → read_source (pages of ${MOTION_READ_DEFAULT_CHARS} chars; if next_start is set, call again with start_from=next_start) → replace_source.
Need photo assets? Call read_media first (see MEDIA LIBRARY). If an uploaded image fits, use_library_image then replace_source <Img src="https://..." />. generate_image only when nothing fits.
REFERENCE FIRST: call study_motion_reference on a WALL CANDIDATE before write_source, and build its beat shape in this brand's palette. Skip it only if the user gave you an exact spec.
set_title for the gallery label.`
		: `Mode: EDIT the selected tile(s) only${reflowAspect ? ' — this tile is a duplicate; reflow it and leave the original alone' : ''}.
${targetingRules}
${canvasLine}
${lengthLine}
${roster}
${selected.length > 1 ? 'Pass video_id to read_source / write_source / set_title. Omit video_id on replace_source and grep_source to hit every selected video (unless the user named one).' : ''}
Prefer grep_source + replace_source. write_source only if the composition must be rebuilt.
Need photo assets? Call read_media first. If a library image fits, use_library_image then replace_source <Img src="https://..." />. generate_image only when nothing fits.`;

	const mediaSection =
		supabase && brandId ? await loadMediaLibraryPromptSection(supabase, brandId) : '';
	// The chat specialist's capabilities, on this surface too: capture_website and
	// harvest_product_ui (the real product UI instead of an invented mockup), the brand and post
	// reads, the attachments, and the peer consults. (`review_video` era in questo elenco fino al
	// 23/8/2026: smontato alla fonte in chat/agents.ts, quindi `pickTools` non lo passa più nemmeno
	// di qua. Qui la review la fa `render_stills`.) Spread FIRST so the studio's own
	// selection-bound source tools and its reference tools win every name collision below.
	const chatTools =
		supabase && brandId && userId
			? studioChatTools(supabase, brandId, userId, opts.threadId, opts.locale)
			: {};
	const libraryTools =
		supabase && brandId && userId ? createMediaLibraryTools({ supabase, brandId, userId }) : {};
	// Palette, type and logo came from the brand kit; what the product actually IS did not. This
	// agent builds LAUNCH videos and until now had no way to look that up — see brand-context-tools.
	const contextTools = supabase && brandId ? createBrandContextTools({ supabase, brandId }) : {};
	// The wall needs nothing from the session but the brand's name — it is a public reference site,
	// not brand data — so it is available on every turn, for every brand.
	//
	// What it looked at is recorded against the videos this turn touched. That link is the only way
	// to answer the question the whole feature rests on — do referenced clips actually score better
	// than unreferenced ones — and `qc.ts` writes the scores on the other side of it.
	const studiedReferences = new Set<string>();
	/**
	 * Gli studi con i loro frame e il loro contratto, per `prepareStep` (sonda 2026-08-21, vedi
	 * l'header di reference-tools.ts): il tool result non bastava — su streamText i pixel non
	 * arrivavano MAI al modello, e anche riparato quel canale resta provider-specifico. Da qui in
	 * poi ogni step successivo allo studio riceve i frame come normale messaggio utente e il
	 * REFERENCE CONTRACT sul system: il modello che scrive la TSX ha la reference davanti.
	 * Una entry per reference (Map, non array): uno studio ri-servito dalla cache non raddoppia
	 * né i frame né il contratto.
	 */
	const studiedByRef = new Map<string, ReferenceStudy>();
	const referenceTools = createMotionReferenceTools({
		brandName,
		modelId: motion.modelId,
		onReferenceStudied: (id, study) => {
			studiedReferences.add(id);
			if (study && !studiedByRef.has(id)) studiedByRef.set(id, study);
		}
	});

	/**
	 * LA BASE COMUNE. Delega, macchina, obiettivo, artefatti e le guardie condivise di `finish` non
	 * sono di questa pagina: stanno in `agent-base.ts` e le montano tutte e quattro le superfici
	 * allo stesso modo. Qui resta il mestiere — i tool sul sorgente, il render, il contratto TSX.
	 */
	/**
	 * Voce e musica. Sono di questa superficie e non della base: la chat non conia audio, e il
	 * Media generator ha già i suoi percorsi. Il fps arriva dalla composizione corrente perché le
	 * durate tornino anche in fotogrammi — un beat si dimensiona sull'audio, non viceversa.
	 */
	const audioTools =
		supabase && brandId
			? createMotionOutputTools({
					supabase,
					brandId,
					userId,
					fps: () => {
						try {
							const cur = resolveTargets()[0]?.get();
							return cur
								? readSourceMeta(cur.source, { fps: MOTION_FPS, durationInFrames: motionFramesForDuration(duration) }).fps
								: MOTION_FPS;
						} catch {
							return MOTION_FPS;
						}
					},
					remainingMs: opts.remainingMs,
					abortSignal: opts.abortSignal
				})
			: {};

	const base = await createAgentBase({
		supabase,
		brandId,
		userId,
		threadId: opts.threadId,
		model: (() => {
			const b = geminiFast();
			// I delegati sul modello DEL TURNO: orchestratore e lavoratori su modelli diversi
			// producono pezzi che non combaciano.
			return motion.modelId === b.modelId
				? b
				: { ...b, model: motion.model, modelId: motion.modelId, provider: motion.provider };
		})(),
		defaultAgent: 'motion',
		// I nomi di QUESTA superficie: in chat sarebbero `replace_motion_source`.
		surfaceWriteKeys: ['replace_source', 'write_source', 'generate_image'],
		remainingMs: opts.remainingMs,
		// Un motion video è un artefatto che qualcuno guarderà: la review non è facoltativa.
		requireReview: true,
		label: 'Motion'
	});

	/**
	 * Service-role write: `motion_video_references` is RLS-on with no policy (internal instrument,
	 * same posture as ai_calls). The first version used the turn's request-scoped client, so every
	 * insert was refused and swallowed — the table read as "no references were ever studied" while
	 * the judge was being called several times an hour.
	 */
	async function recordReferenceUse() {
		if (!studiedReferences.size || !brandId) return;
		const touched = createMode
			? draft?.id
				? [draft.id]
				: []
			: [...byId.keys()];
		if (!touched.length) return;
		const rows = touched.flatMap((videoId) =>
			[...studiedReferences].map((referenceId) => ({
				brand_id: brandId,
				video_id: videoId,
				reference_id: referenceId
			}))
		);
		const { error } = await createAdminClient()
			.from('motion_video_references')
			.upsert(rows, { onConflict: 'video_id,reference_id' });
		if (error) console.warn(`[motion-video] reference link write failed: ${error.message}`);
	}
	/** URLs the model was handed (brand logo, media library, seed) — trusted without a fetch. */
	const knownUrlText = `${brandBrief}\n${mediaSection}\n${seedSource}`;
	// Reference stills / clips linked in the prompt, resolved once so a dead link never fails the
	// turn. Only the LAST user message: the clip URLs stay in the persisted prompt text, so
	// attaching them for every historical turn re-downloaded and re-inlined the same tens of MB on
	// every continuation slice — enough on its own to blow the request limit.
	const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
	const mediaByMessage = new Map<number, MediaPart[]>();
	if (lastUserIndex >= 0) {
		const parts = await resolveUserTurnMediaParts(extractText(messages[lastUserIndex]));
		if (parts.length) mediaByMessage.set(lastUserIndex, parts);
	}

	/**
	 * Il blocco esiste solo se la delega è montata davvero: un prompt che promette `compose` a un
	 * turno senza `supabase`/`brandId` fa cercare al modello un tool che non c'è, e il giro finisce
	 * in una scusa invece che in un video.
	 */
	/**
	 * LA MACCHINA, e i due modi in cui serve qui.
	 *
	 * `render_stills` è quello specifico: rende la composizione davvero e attacca i fotogrammi al
	 * risultato, così il modello che ha scritto la scena è il modello che la guarda. I cinque tool
	 * generici della sandbox sono l'altro: un terminale per le volte in cui la cosa giusta da fare
	 * è eseguire qualcosa, non ragionarci sopra. Finora questo loop non aveva né l'uno né gli altri
	 * — e la chat li raggiungeva solo delegando a un sotto-agente `sandbox`.
	 */
	const renderTools =
		brandId && isSandboxConfigured()
			? createMotionRenderTools({
					brandId,
					userId,
					supabase,
					threadId: opts.threadId,
					resolveTarget: (videoId) => {
						try {
							const cur = resolveTargets(videoId)[0]?.get();
							if (!cur) return null;
							const meta = readSourceMeta(cur.source, {
								fps: MOTION_FPS,
								durationInFrames: motionFramesForDuration(duration)
							});
							return { title: cur.title, source: cur.source, ...meta };
						} catch {
							return null;
						}
					},
					remainingMs: opts.remainingMs,
					abortSignal: opts.abortSignal,
					onLog: (line) => console.log(`[Motion render] brand=${brandId} ${line}`)
				})
			: {};
	const machineBlock = Object.keys(renderTools).length
		? `LOOK AT WHAT YOU BUILT (render_stills):
- The source tools do NOT run your code: they check that it parses. A layout that overflows, an <Img> that never loads, a beat that is empty at the second it matters, an element pushed off-canvas by a font — all of it parses fine and all of it ships broken.
- render_stills renders this composition for real and ATTACHES THE FRAMES to the result. Look at them. Judge what you SEE, not what the code says should be there.
- Render after the structure is in place, and again after any fix you cannot verify by reading. Not after every replace_source — it costs about a minute.
- Pick the seconds that matter: mid-transition, the beat you just changed, the moment the UI mockup is supposed to be readable. The default spread skips the first and last frame on purpose — those are the two that hide an animation defect.
- A frame that fails to render is a REAL defect, not a tool problem: it will fail the same way in the user's browser. Read the error, patch, render again.
- render_stills is for WHILE you work. When the composition is finished, render_motion_video produces the actual MP4 and puts it in the gallery — that is what turns this into something the user can watch.
`
		: '';

	/**
	 * Cosa resta di specifico dopo la base: come si spezza UN VIDEO. La disciplina della delega e
	 * l'obbligo di review stanno in `agent-base.ts`; qui c'è solo la forma che quel lavoro prende
	 * quando l'oggetto è una composizione a beat.
	 */
	const craftOrchestration = base.promptBlock
		? `SPLITTING A VIDEO:
- A NEW composition with 3+ beats: run_parallel_tasks with role="compose", ONE TASK PER BEAT. Each worker returns its own <Series.Sequence> block in its report; none of them writes. You assemble with ONE write_source and refine with replace_source — that is what makes a six-beat video cost one beat of wall-clock.
- shared_context is the whole contract between the workers, and they have nothing else: canvas width×height and fps, the exact palette hexes, the font families, the logo URL, the radius scale, and one line saying what the beat BEFORE and AFTER each one does — a worker that does not know what precedes it cannot carry motion through the cut.
- Give each task its own seconds and its own job in the arc ("beat 3 of 6, 3s, demonstration: the editor typing"). "Make a nice scene" comes back as a scene that fits nothing.
- Two beats that each declare the same helper, or that drift on the radius, are your defect to fix before finish — not theirs.
- The verify sub-agent you owe before finish gets the RENDERED FRAMES' verdict, not your description of them.

`
		: '';

	// Pavimento ambientale dal wall /trending: le meccaniche di hook del raccolto virale corrente,
	// già distillate in testo (nessuna chiamata AI qui; stantio o assente ⇒ stringa vuota).
	// NON sostituisce study_motion_reference: quello resta il soffitto per-brief.
	const trendingFloor = await trendingWallDigestSection().catch((error) => { swallow('digest trending wall', error); return ''; });

	// Hoisted so `prepareStep` can re-anchor the studied reference on top of the SAME base system
	// (contract appended per step) — see studiedByRef sopra e reference-tools.ts, sonda 2026-08-21.
	const system = `You are Anomalia Motion Video — a Remotion creative engineer inside a Media-Generator-style gallery.

${brandBrief}

${sourceContract(aspect, forceCanvas, duration, createMode, reflowAspect)}

${selectedBlock}

${mediaSection}

Stay on-brand: palette, type, logo and visual style above are the source of truth. Do not invent colours, fonts, or a logo.
${opts.logoImage ? 'The brand logo is attached as an image — match its lockup, proportions, and clear space. Use the provided logo URL with <Img>, never redraw it.' : ''}
${opts.referenceNote ? `\n${opts.referenceNote}` : ''}

${MOTION_CRAFT_SPECS}

${MOTION_TRANSITIONS_COOKBOOK_PROMPT}
${trendingFloor}

${supabase && brandId ? `${brandContextPromptSection()}\n` : ''}
${supabase && brandId ? `${disruptiveBriefSection()}\nread_disruptive_ideas prima di scegliere l'angolo, e mark_idea_used se ne giri una di quelle; save_disruptive_idea se te ne viene una che passa i tre test — il banco è del brand, non di questa composizione, e lì un'idea laterale sopravvive. Nessun minimo: se non ne è nata nessuna, va bene così.\n` : ''}
REAL PRODUCT UI (DEFAULT CRAFT demands a UI mockup of every feature — do not invent one):
- capture_website(url) screenshots a real page; harvest_product_ui pulls the product's actual interface. Either gives you a media id, then use_library_image gives you the https URL for <Img>.
- Build the chrome around it in TSX — the card, the cursor, the bars, the status pills — and let the captured screen be what sits inside. A hand-drawn approximation of a product you could have photographed is the difference between a launch video and a mockup of one.
- read_posts / read_products / read_people / read_talents when you need to know WHAT to show and WHO appears. read_brand_kit for the mark. Never describe a feature you have not read.

${MOTION_REFERENCE_PROMPT}
${opts.referenceCandidates?.trim() ? `\n${opts.referenceCandidates.trim()}` : ''}

Do not paste the full TSX into chat. Never rewrite the whole file if a substring replace will do.

NARRATION (mandatory — same as brand chat):
- Write a short status line BEFORE every tool call so the chip appears under that line, not in a pile at the top.
- Between replace_source / grep_source / read_source calls, write one line of what you are about to change. Never fire a block of tools with no text in between.

SMALL FAST EDITS (mandatory):
- Prefer MANY tiny replace_source calls over one big patch. Each old_str should be the smallest unique snippet — one string literal, one number, one CSS property, one <span>… typically ≤200 characters.
- grep_source → read_source a short slice → replace_source that slice. Repeat. Do not wait to batch unrelated changes.
- Never replace a whole function, return, or AbsoluteFill block when a 1-line change will do.
- write_source lays down the skeleton of a wholly new composition, once. It is the START of the work, not the end of it: everything after is replace_source. A continuation turn must NOT rewrite the file from scratch.

${base.promptBlock}${machineBlock}${craftOrchestration}MANY TURNS: this slice is one of many. Keep calling tools until the brief is fully applied. A time or step limit will stop THIS slice and another job will resume from the saved TSX — that is expected, not a reason to rush or dump a write_source. Call finish ONLY when the composition matches the brief (or a continuation says nothing is left). Do not call finish to "save steps".

Workflow:
0. REFERENCE FIRST on a CREATE brief: study_motion_reference on the closest WALL CANDIDATE (or search_motion_references if none fit), then build from the structure it returns — in this brand's palette and type. Skip this only when the user handed you an exact spec to follow.
1. grep_source to locate copy, colors, fonts, timing (returns char index + line).
2. read_source around that index (start_from, max_chars ≤ ${MOTION_READ_MAX_CHARS}). If next_start is not null, page forward.
3. replace_source: first match by default; count=N for the first N; replace_all=true for every occurrence. old_str must match exactly and stay small.
4. Photos / UI stills: read_media first. If a library image fits, use_library_image (no credits) then replace_source <Img src="https://..." />. Need a screenshot, avatar, product shot, graph texture, or any photo inside a programmatic UI mockup? generate_image (Nano Banana Pro) — each mint returns image_url and does NOT change the TSX; then replace_source <Img src="https://..." />. Never invent image URLs.
5. write_source once for the skeleton of a wholly new composition — then keep refining it with replace_source. A single write and finish is not a finished video, and finish will say so.
6. set_title for a short gallery label (≤ 60 chars).
7. Keep making tiny replace_source calls across as many turns as needed. Call finish only when done.
8. One short status line in the user's language is OK between edits; the full reply comes AFTER the source tools succeed.

When the user message is ANY QC brief — MOTION CRAFT QC, REFERENCE FIDELITY FAILED, or SELLABILITY QC (verdict FIX/KILL) — you MUST apply every issue and the mandatory next test before you finish. Craft notes (transitions, easing, overlap, type, UI mockups) come first; reference-fidelity notes (missing or altered beats, broken order) come next; ads/organic sellability notes (hook, CTA, proof) come after. Do not argue with the score. Call replace_source or write_source — a text reply without a source change is a failure, and calling finish without one is the same failure with a nicer ending.
`;

	const result = harnessStreamText({
		brandId,
		userId,
		agent: 'motion_video',
		mode: selected.length ? 'edit' : 'create',
		model: motion.modelId,
		provider: motion.provider,
		surface: 'chat'
	}, {
		model: motion.model,
		maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
		system,
		/**
		 * Dopo uno studio riuscito, ogni step successivo riceve: (1) i frame della reference come
		 * NORMALE messaggio utente in coda — il canale che nessun provider degrada, verificato dal
		 * vivo il 2026-08-21 (due contenuti user consecutivi accettati, ~1200 token di immagine
		 * ingeriti, descritti correttamente allo step finale); (2) il REFERENCE CONTRACT sul
		 * system. prepareStep ricostruisce dalla base a ogni step, quindi l'iniezione resta UNA
		 * per reference, mai accumulata. Prima dello studio non tocca niente.
		 */
		prepareStep: ({ messages: stepMessages }: { messages: ModelMessage[] }) =>
			buildReferenceStepPatch([...studiedByRef.values()], system, stepMessages),
		messages: messages.map((m, i) => {
			const text = extractText(m);
			if (m.role === 'user') {
				const images =
					i === 0
						? [...(opts.logoImage ? [opts.logoImage] : []), ...(opts.referenceImages ?? [])].slice(
								0,
								8
							)
						: [];
				// A reference clip or still pasted as a URL is only "watched" if it rides along as a part.
				const media = mediaByMessage.get(i) ?? [];
				if (images.length || media.length) {
					return {
						role: 'user' as const,
						content: [
							{ type: 'text' as const, text },
							...images.map((image) => ({ type: 'image' as const, image })),
							...media
						]
					};
				}
			}
			return { role: m.role as 'user' | 'assistant', content: text };
		}),
		abortSignal: opts.abortSignal,
		stopWhen: [
			hasToolCall('finish'),
			stepCountIs(MOTION_SLICE_MAX_STEPS),
			() => (opts.deadlineReached ? opts.deadlineReached() : false)
		],
		tools: base.attach({
			...chatTools,
			...libraryTools,
			...contextTools,
			...referenceTools,
			...renderTools,
			...audioTools,
			generate_image: tool({
				description: [
					'Mint a Nano Banana Pro PHOTO/VIDEO-STILL asset and return its https image_url. Does NOT change the Remotion TSX. Bills AI credits.',
					'Use this for any real image inside a programmatic UI mockup (post photos, avatars, graph textures, product shots, prompt screenshots).',
					'MEDIA FIRST: call read_media before this. If a library photo fits, use_library_image instead.',
					'Then replace_source to put <Img src="https://..." />. Never invent image URLs.'
				].join('\n'),
				inputSchema: z.object({
					prompt: z.string().describe('Description of the still to generate'),
					aspect_ratio: z
						.enum(MOTION_ASPECTS)
						.optional()
						.describe(`Aspect ratio of the minted still (default ${aspect})`),
					media_ids: z
						.array(z.string())
						.optional()
						.describe('Brand Media library ids as fidelity references')
				}),
				execute: async ({ prompt, aspect_ratio, media_ids }) => {
					if (!supabase || !brandId || !userId) {
						return { error: 'Image generation is unavailable in this session.' };
					}
					return mintStandaloneImage({
						supabase,
						userId,
						brandId,
						prompt,
						aspect_ratio: aspect_ratio ?? aspect,
						media_ids,
						hint: MOTION_ASSET_MINT_HINT
					});
				}
			}),
			grep_source: tool({
				description:
					'Find a word or snippet in the TSX. Returns char indexes for read_source start_from. Literal match by default. Omit video_id when several tiles are selected to search ALL of them. Pass video_id when the user named one tile (title, #index, 9:16, 1m, headline).',
				inputSchema: z.object({
					query: z.string().min(1).max(500),
					regex: z.boolean().optional(),
					ignore_case: z.boolean().optional(),
					video_id: z.string().uuid().optional()
				}),
				execute: async ({ query, regex, ignore_case, video_id }) => {
					const targets = resolveTargets(video_id);
					const foundOpts = { regex: regex === true, ignoreCase: ignore_case === true };
					if (targets.length === 1) {
						const resolved = targets[0];
						const cur = resolved.get();
						const found = grepSource(cur.source, query, foundOpts);
						return {
							mode: resolved.mode,
							video_id: resolved.mode === 'edit' ? resolved.id : cur.id,
							title: cur.title,
							query,
							...found
						};
					}
					return {
						ok: true as const,
						query,
						videos: targets.map((resolved) => {
							const cur = resolved.get();
							return {
								video_id: resolved.mode === 'edit' ? resolved.id : cur.id,
								title: cur.title,
								...grepSource(cur.source, query, foundOpts)
							};
						})
					};
				}
			}),
			read_source: tool({
				description: `Read a slice of the TSX. Default ${MOTION_READ_DEFAULT_CHARS} chars from start_from (0-based char index). Use next_start to continue. Pass video_id when more than one tile is selected.`,
				inputSchema: z.object({
					video_id: z.string().uuid().optional(),
					start_from: z.number().int().min(0).optional(),
					max_chars: z.number().int().min(1).max(MOTION_READ_MAX_CHARS).optional()
				}),
				execute: async ({ video_id, start_from, max_chars }) => {
					const resolved = resolve(video_id);
					const cur = resolved.get();
					if (writeCount > 0) readAfterWrite = true;
					const page = sliceSource(cur.source, start_from ?? 0, max_chars ?? MOTION_READ_DEFAULT_CHARS);
					return {
						mode: resolved.mode,
						video_id: resolved.mode === 'edit' ? resolved.id : cur.id,
						title: cur.title,
						...page
					};
				}
			}),
			set_title: tool({
				description:
					'Set the gallery title for the draft or a selected video. Pass video_id when more than one tile is selected.',
				inputSchema: z.object({
					title: z.string().min(1).max(80),
					video_id: z.string().uuid().optional()
				}),
				execute: async ({ title, video_id }) => {
					const clean = title.trim().slice(0, 80);
					const resolved = resolve(video_id);
					if (resolved.mode === 'create') {
						if (!draft) throw new Error('No draft');
						draft = { ...draft, title: clean };
					} else {
						const v = byId.get(resolved.id);
						if (!v) throw new Error(`Unknown video_id ${resolved.id}`);
						v.title = clean;
						byId.set(resolved.id, v);
					}
					const cur = resolved.get();
					if (resolved.mode === 'edit' || cur.id) {
						const saved = await commit({
							id: resolved.mode === 'edit' ? resolved.id : cur.id,
							title: clean,
							source: cur.source
						});
						if (resolved.mode === 'create' && saved && draft) draft.id = saved.id;
						return {
							ok: true as const,
							mode: resolved.mode,
							video_id: saved?.id ?? (resolved.mode === 'edit' ? resolved.id : draft?.id),
							title: clean
						};
					}
					return { ok: true as const, mode: resolved.mode, video_id: draft?.id, title: clean };
				}
			}),
			replace_source: tool({
				description:
					'Replace a SMALL unique substring in the TSX (one literal / number / style — typically ≤200 chars, never a whole function). First match by default; count=N for the first N; replace_all=true for every occurrence. Omit video_id when several tiles are selected to patch ALL of them with the same old_str/new_str (e.g. a font change). Pass video_id when the user named one tile. After generate_image, put the URL in <Img src="https://..." />.',
				inputSchema: z.object({
					old_str: z.string().min(1).max(MOTION_SOURCE_MAX_CHARS),
					new_str: z.string().max(MOTION_SOURCE_MAX_CHARS),
					replace_all: z.boolean().optional(),
					count: z.number().int().min(1).max(500).optional(),
					video_id: z.string().uuid().optional()
				}),
				execute: async ({ old_str, new_str, replace_all, count, video_id }) => {
					const targets = resolveTargets(video_id);
					const patchOne = async (resolved: Resolved) => {
						const prev = resolved.get().source;
						const { source: next, replaced } = applyReplace(prev, old_str, new_str, {
							replaceAll: replace_all === true,
							count
						});
						assertSourceSyntax(next);
						assertNoReferenceHotlinks(next);
						await assertImageUrlsLoad(next, `${knownUrlText}\n${prev}`);
						putSource(resolved, next);
						return persistResolved(resolved, {
							replaced,
							...(old_str.length > 280
								? {
										warning:
											'old_str is too large; next patches must be smaller (≤200 chars, never a whole function).'
									}
								: {})
						});
					};
					patchCount += 1;
					if (targets.length === 1) return patchOne(targets[0]);
					const results = [];
					for (const resolved of targets) {
						try {
							results.push(await patchOne(resolved));
						} catch (e) {
							results.push({
								ok: false as const,
								video_id: resolved.mode === 'edit' ? resolved.id : undefined,
								error: e instanceof Error ? e.message : String(e)
							});
						}
					}
					const patched = results.filter((r) => 'ok' in r && r.ok).length;
					return {
						ok: patched === targets.length,
						patched,
						total: targets.length,
						incomplete: patched < targets.length,
						results
					};
				}
			}),
			write_source: tool({
				description:
					'Replace the entire Remotion TSX. Use only when replace_source cannot express the change. Pass video_id when more than one tile is selected.',
				inputSchema: z.object({
					source: z.string().min(1).max(MOTION_SOURCE_MAX_CHARS),
					video_id: z.string().uuid().optional()
				}),
				execute: async ({ source, video_id }) => {
					assertSourceSyntax(source);
					assertNoReferenceHotlinks(source);
					writeCount += 1;
					// A read that happened BEFORE this write says nothing about what is in the file now.
					readAfterWrite = false;
					const resolved = resolve(video_id);
					await assertImageUrlsLoad(source, `${knownUrlText}\n${resolved.get().source}`);
					putSource(resolved, source);
					return persistResolved(resolved);
				}
			}),
			finish: tool({
				description:
					'End this session. Call ONLY when the brief is fully applied (or a continuation found nothing left). Shared multi-edit: every listed id must be updated first. Named-subset edit: only that id. Another job will resume if you stop without finish.',
				inputSchema: z.object({
					summary: z.string().max(400).describe('One or two lines of what landed')
				}),
				execute: async ({ summary }) => {
					/**
					 * Le guardie condivise per prime: l'obiettivo che l'agente si è scritto da solo, e
					 * la review delegata. Le due qui sotto guardano il TSX e non sanno niente di cosa
					 * aveva chiesto l'utente — un video con tutte le curve giuste e un beat mancante
					 * le passa entrambe. Non consumano il budget di rifiuti: non sono insistenza.
					 */
					const refusal = await base.guardFinish();
					if (refusal) return refusal;

					const oneShot =
						createMode && writeCount > 0 && (patchCount < MIN_REFINEMENT_PATCHES || !readAfterWrite);
					if (oneShot && finishRefusals < MAX_FINISH_REFUSALS) {
						finishRefusals += 1;
						return {
							error: 'not_finished',
							written: writeCount,
							refinements: patchCount,
							reread_own_source: readAfterWrite,
							hint: [
								`A new composition is not one write_source. You have made ${patchCount} refinement${patchCount === 1 ? '' : 's'} and ${readAfterWrite ? 're-read' : 'NOT re-read'} your own source.`,
								`Now: read_source your composition scene by scene, and replace_source at least ${MIN_REFINEMENT_PATCHES} times to bring in what a skeleton never has —`,
								'the transition mechanism between every pair of scenes (overlapping slide or an iris that completes), the easing and overshoot on each entrance, motion that runs through the cut, and the UI beat for each feature.',
								'Check the arc while you are in there: hook, tension, demonstration, proof, resolution. A list of slides is not a story.',
								'Then call finish again.'
							].join(' ')
						};
					}
					/**
					 * L'ENTRATA MORTA viene per PRIMA perché è la CAUSA, non un sintomo: un beat
					 * montato da una guardia sul fotogramma assoluto ma scritto in tempo locale
					 * appare ad animazione già finita, e da fuori si legge come una scena ferma e
					 * come un taglio secco. Rifiutare la stasi senza dire questo manda il modello a
					 * prolungare una deriva che è già lunga abbastanza. Stesso budget di rifiuti.
					 */
					const dead = (() => {
						try {
							return resolveTargets().flatMap((r) => findDeadEntrances(r.get().source));
						} catch {
							return [];
						}
					})();
					if (dead.length && finishRefusals < MAX_FINISH_REFUSALS) {
						finishRefusals += 1;
						return {
							error: 'dead_entrance',
							violations: dead.length,
							hint: formatDeadEntrances(dead)
						};
					}
					// Il movimento lineare è l'unico difetto di craft che si può VERIFICARE, quindi si
					// verifica invece di chiederlo per favore. In Remotion un interpolate senza easing
					// è lineare: è così che il difetto arriva in produzione, non scrivendo
					// Easing.linear. Stesso budget di rifiuti dell'altra guardia: il turno finisce su
					// finish, sul tetto di step o sulla deadline, e rifiutare all'infinito brucerebbe
					// la slice senza salvare niente.
					const linear = (() => {
						try {
							return resolveTargets().flatMap((r) => findLinearMotion(r.get().source));
						} catch {
							return [];
						}
					})();
					if (linear.length && finishRefusals < MAX_FINISH_REFUSALS) {
						finishRefusals += 1;
						return {
							error: 'linear_motion',
							violations: linear.length,
							hint: [
								`Movimento lineare nel sorgente — ${formatEasingViolations(linear)}`,
								`Ogni interpolate porta \`easing: ${MOTION_EXPO_IN_OUT}\` (expo in-out: piatta alle estremità, ripidissima in mezzo).`,
								`L'overshoot ${MOTION_OVERSHOOT_OUT} resta per l'ULTIMA posa di un'entrata, non per la percorrenza.`,
								'Patcha con replace_source e richiama finish.'
							].join(' ')
						};
					}
					/**
					 * L'ARITMETICA, e viene PRIMA della stasi perché è più certa di tutte: due
					 * numeri, `durationInFrames` contro i fotogrammi che le scene coprono davvero.
					 * È il difetto più contato nei giudizi di mestiere — 4 volte su 10 — e nelle
					 * parole del giudice è «the composition terminates into dead black frames
					 * because the Sequences are shorter than the container», «2,5 secondi di vuoto
					 * nero, frame 410-485». Un video che finisce nel nero non è un'opinione, e
					 * chiedere per favore di far tornare i conti è già stato provato.
					 */
					const arith = (() => {
						try {
							return resolveTargets()
								.map((r) => findDurationMismatch(r.get().source))
								.filter((m): m is NonNullable<typeof m> => m !== null);
						} catch {
							return [];
						}
					})();
					if (arith.length && finishRefusals < MAX_FINISH_REFUSALS) {
						finishRefusals += 1;
						return {
							error: 'duration_mismatch',
							violations: arith.length,
							hint: [
								arith.map((m) => formatDurationMismatch(m)).join(' '),
								'Patcha con replace_source e richiama finish.'
							].join(' ')
						};
					}
					/**
					 * IL FONDALE CONGELATO: un <Img>/<Video> a tutta tela che non si muove, con
					 * sopra elementi animati. È la forma con cui una UI finisce usata come
					 * fotografia invece che ricostruita — «non usare image bg full viewport se
					 * queste sono UI» (proprietario, 22/8/2026) — ed è anche la sola parte di
					 * quella regola che il codice può decidere: dal sorgente uno screenshot e una
					 * fotografia sono indistinguibili, il fatto che il fondo sia fermo no.
					 */
					const frozen = (() => {
						try {
							return resolveTargets().flatMap((r) => findFrozenBackplate(r.get().source));
						} catch {
							return [];
						}
					})();
					if (frozen.length && finishRefusals < MAX_FINISH_REFUSALS) {
						finishRefusals += 1;
						return {
							error: 'frozen_backplate',
							violations: frozen.length,
							hint: `${formatFrozenBackplate(frozen)} Patcha con replace_source e richiama finish.`
						};
					}
					// La STASI è l'altro difetto verificabile in codice (vedi easing.ts): un beat le cui
					// interpolate finiscono tutte più di ~1.2s prima della chiusura è una scena ferma —
					// il difetto numero due del proprietario ("nessuna scena deve essere statica, mai").
					// Stesso budget di rifiuti: il check è conservativo (range illeggibile = silenzio),
					// quindi quando parla ha ragione.
					const stalls = (() => {
						try {
							return resolveTargets().flatMap((r) => findStaticTails(r.get().source));
						} catch {
							return [];
						}
					})();
					if (stalls.length && finishRefusals < MAX_FINISH_REFUSALS) {
						finishRefusals += 1;
						return {
							error: 'static_scene',
							violations: stalls.length,
							hint: [
								formatStasisViolations(stalls),
								'Qualcosa si muove in OGNI frame di ogni beat, fino alla fine della transizione che lo chiude: prolunga una pan di sfondo, un respiro di scala o una deriva lenta fino a durationInFrames del beat.',
								'Patcha con replace_source e richiama finish.'
							].join(' ')
						};
					}
					calledFinish = true;
					finishSummary = summary.trim();
					finishUnreviewed = base.reviewSkipped();
					return {
						ok: true as const,
						summary: summary.trim(),
						// Passato senza review perché non c'era più tempo per aprirne una. Va detto
						// all'utente: consegnare in silenzio un lavoro che nessuno ha guardato è
						// esattamente ciò che la guardia esisteva per impedire.
						...(base.reviewSkipped()
							? {
									unreviewed: true,
									tell_the_user:
										'Say plainly that there was no time left for an independent review of this video, so it has not been checked by anyone but you.'
								}
							: {})
					};
				}
			})
		}),
		onFinish: ({ totalUsage, steps }) => {
			void recordReferenceUse().catch((error) => { swallow('record reference use', error); return undefined; });
			// I file di questa run se ne vanno con lei: la VM è del brand e la spegne il suo timeout,
			// ma lasciarci dentro il workspace di un turno finito è il modo in cui due giri dello
			// stesso brand finiscono a leggersi i file a vicenda.
			void base.close();
			opts.onSliceEnd?.({
				finished: calledFinish,
				steps: Array.isArray(steps) ? steps.length : 0,
				...(finishSummary ? { summary: finishSummary } : {}),
				...(finishUnreviewed ? { unreviewed: true } : {})
			});
			logAiCall({
				label: 'motion-video',
				provider: motion.provider,
				model: motion.modelId,
				ms: Date.now() - t0,
				ok: true,
				...extractSdkUsage(totalUsage),
				brandId,
				userId,
				context: createMode ? 'motion-video:create' : 'motion-video:edit'
			});
		},
		onError: ({ error }) => {
			void base.close();
			opts.onSliceEnd?.({
				finished: calledFinish,
				steps: 0,
				...(finishSummary ? { summary: finishSummary } : {}),
				error: error instanceof Error ? error.message : String(error)
			});
			logAiCall({
				label: 'motion-video',
				provider: motion.provider,
				model: motion.modelId,
				ms: Date.now() - t0,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
				brandId,
				userId,
				context: createMode ? 'motion-video:create' : 'motion-video:edit'
			});
		}
	});

	return result.toUIMessageStreamResponse({
		sendReasoning: true,
		onError: () => CHAT_USER_ERROR,
		...(opts.consumeSseStream ? { consumeSseStream: opts.consumeSseStream } : {})
	});
}
