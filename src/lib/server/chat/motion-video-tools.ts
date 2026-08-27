import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { compileMotionSource } from '$lib/motion-video/compile';
import { referenceHotlink } from '$lib/motion-video/source-ops';
import {
	kitColorHexes,
	kitFontNames,
	kitLogoUrl
} from '$lib/motion-video/brand';
import { defaultMotionSource, MOTION_SOURCE_MAX_CHARS } from '$lib/motion-video/source';
import {
	MOTION_READ_DEFAULT_CHARS,
	MOTION_READ_MAX_CHARS,
	applyReplace,
	grepSource,
	sliceSource
} from '$lib/motion-video/source-ops';
import {
	getMotionVideo,
	listMotionVideos,
	saveMotionVideo,
	type MotionVideoRow
} from '$lib/server/motion-video/persist';
import { noteRead, requireFreshRead } from './read-guards';

const MOTION_SOURCE_HINT =
	'Patch with grep_motion_source → read_motion_source → replace_motion_source. Photos inside UI mockups: read_media then use_library_image (or generate_image / Nano Banana Pro if nothing fits) then <Img src="https://..." />. Always: brand type (or Inter), slide/iris transitions, extreme ease-in-out + overshoot, motion through the cut, programmatic UI mockups — text-only cards are not enough. write_motion_source only to rebuild. Writes are refused unless you read this source first — and refused again if it changed since that read.';

/** Vero SOLO dopo il render: prima di allora quella pagina non ha niente da mostrare. */
const PREVIEW_HINT = ' Preview in the Motion video gallery — propose_open_tab /motion-video.';

/**
 * LA FONTE DELLA BUGIA, non una delle sue guardie.
 *
 * Questa risposta diceva `ok: true`, `preview_url: null` e, nello stesso `hint`, «Preview in the
 * Motion video gallery — propose_open_tab /motion-video». Ogni campo era vero e l'insieme era
 * ingannevole: il 22/08 l'agente ha letto `ok: true`, ha preso il `/motion-video` dal hint e lo ha
 * mandato al proprietario come anteprima del trailer. La pagina era vuota — `motion_videos.
 * preview_url` è NULL ancora adesso. Il link «inventato» non era inventato: gliel'abbiamo dato noi.
 *
 * E ha impostato tutto il resto del turno: se la creazione ti dice riuscito con l'anteprima in
 * galleria, il render è una formalità e il rifiuto `storyboard_first` è un intoppo da aggirare.
 *
 * Quindi: niente `ok` (era il segnale di testa, e non era la domanda), uno `status` che nomina lo
 * stato reale, il passo successivo esplicito, e l'invito all'anteprima SOLO quando l'anteprima
 * esiste. Punto unico: ci passano create_motion_video, write_motion_source e replace_motion_source.
 */
export function compactMotionPersist(row: MotionVideoRow, extra: Record<string, unknown> = {}) {
	const rendered = !!row.preview_url;
	return {
		status: rendered ? ('rendered' as const) : ('source_saved_not_rendered' as const),
		...(rendered
			? {}
			: {
					not_rendered_yet:
						'The source is saved. There is NO video yet: no MP4 exists for this composition, nothing is in the gallery to watch, and there is nothing to show or link to the user.',
					next_step: 'render_motion_video'
				}),
		video_id: row.id,
		title: row.title,
		source_chars: row.source.length,
		updated_at: row.updated_at,
		width: row.width,
		height: row.height,
		fps: row.fps,
		duration_in_frames: row.duration_in_frames,
		preview_url: row.preview_url,
		hint: MOTION_SOURCE_HINT + (rendered ? PREVIEW_HINT : ''),
		...extra
	};
}

/**
 * Esportata per il plugin motion del kit (`src/lib/agent/plugins/motion.ts`, `motion_write`):
 * STESSO percorso di scrittura di `create_motion_video` / `write_motion_source` in chat — hotlink
 * wall, compile, save — mai duplicato.
 */
export async function persistCompiled(
	supabase: SupabaseClient,
	brandId: string,
	userId: string,
	opts: { id?: string | null; title: string; source: string }
) {
	// Every chat write of a Remotion source funnels through here, so this is where the reference
	// wall's one hard rule is enforced on this path too: study the structure, never embed the media.
	const hotlink = referenceHotlink(opts.source);
	if (hotlink) {
		return {
			error: `Never embed media from the reference wall (${hotlink}). posts.design curates other brands’ posts — take the structure and rebuild it with generate_image / use_library_image assets in this brand’s palette.`
		};
	}
	let compiled;
	try {
		compiled = compileMotionSource(opts.source);
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
	const result = await saveMotionVideo(supabase, {
		brandId,
		userId,
		id: opts.id,
		title: opts.title,
		source: opts.source,
		meta: {
			fps: compiled.fps,
			durationInFrames: compiled.durationInFrames,
			width: compiled.width,
			height: compiled.height
		}
	});
	if (!result.ok) return { error: result.error };
	return compactMotionPersist(result.row);
}

async function loadSeedSource(supabase: SupabaseClient, brandId: string) {
	const [{ data: brand }, { data: kit }] = await Promise.all([
		supabase.from('brands').select('name').eq('id', brandId).maybeSingle(),
		supabase
			.from('brand_kit')
			.select('fonts, brand_colors, logos, favicon_url')
			.eq('brand_id', brandId)
			.maybeSingle()
	]);
	const colors = kitColorHexes(kit?.brand_colors);
	const fonts = kitFontNames(kit?.fonts);
	const brandName = ((brand?.name as string) || 'Brand').trim() || 'Brand';
	return {
		brandName,
		source: defaultMotionSource({
			brandName,
			ctaText: env.MOTION_AD_CTA,
			accent: colors[0] ?? null,
			colors,
			displayFont: fonts[0] ?? null,
			bodyFont: fonts[1] ?? fonts[0] ?? null,
			logoUrl: kitLogoUrl(kit?.logos, kit?.favicon_url as string | null)
		})
	};
}

async function loadOwned(supabase: SupabaseClient, brandId: string, videoId: string) {
	const row = await getMotionVideo(supabase, brandId, videoId);
	if (!row) return { error: 'Motion video not found' as const };
	return { row };
}

const CREDITS_BLOCKED = {
	error: 'credits_exhausted' as const,
	message:
		'AI credits for this billing period are exhausted. Explain the limit and do not retry generation.'
};

/** Reading or patching Remotion TSX is an AI spend — same ledger as Motion gallery chat. */
async function requireMotionCredits(brandId: string) {
	const { gateCredits } = await import('$lib/server/credits');
	try {
		await gateCredits(brandId);
		return null;
	} catch (e) {
		if (e instanceof Error && e.name === 'CreditsExhaustedError') return CREDITS_BLOCKED;
		throw e;
	}
}

// ── Library documentation (Context7) ─────────────────────────────────────────
/**
 * WHY HTTP AND NOT MCP. Context7 also speaks MCP (context7.liam.sh/mcp), and we deliberately do
 * not. The protocol costs an `initialize` + `notifications/initialized` handshake and an SSE
 * transport to keep alive on EVERY turn, a `resolve` call before every `fetch`, and — the part
 * nobody counts — ~700 tokens of its two tool descriptions injected into the prompt whether or not
 * the agent ever looks anything up. The same index is served over plain HTTP: one GET, ~0.6s, no
 * dependency, no session in the path of a turn that already has a 300s ceiling, and a remote
 * outage that degrades to "not found" instead of taking the turn with it.
 */
const CONTEXT7_API = 'https://context7.com/api/v2';
/** The one library these agents actually write. Skips a resolve round-trip on the common case. */
const REMOTION_LIBRARY_ID = '/remotion-dev/remotion';
const DOC_TOKENS = 2500;
const DOC_MAX_CHARS = 12_000;

async function context7(path: string): Promise<Response> {
	// Anonymous works today; a key (set in the environment, never in code) only lifts rate limits.
	const key = process.env.CONTEXT7_API_KEY;
	const res = await fetch(`${CONTEXT7_API}${path}`, {
		headers: key ? { Authorization: `Bearer ${key}` } : undefined,
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`Context7 ${res.status}`);
	return res;
}

/**
 * The one line that decides whether this tool gets used, and — more important — that it never
 * outranks how WE make videos. Injected into the two agents that write source (agents.ts).
 */
export const LIBRARY_DOCS_PROMPT =
	'- search_library_docs (Context7): the real, current Remotion API on demand. Call it BEFORE using an API you are not sure of, and when a render or compile fails with an error that smells like the API (unknown prop, missing export, changed signature). Not on every edit — it is a lookup, not a habit. It answers HOW THE LIBRARY WORKS; everything else in this prompt answers HOW WE MAKE THINGS, and ours always wins: never trade one of our patterns, transitions or brand rules for a generic example out of the documentation.';

export function createMotionVideoChatTools(opts: {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
}) {
	const { supabase, brandId, userId } = opts;

	return {
		list_motion_videos: tool({
			description:
				'List Remotion kinetic motion videos in the brand gallery (id, title, size, duration). Not UGC reels / social posts. Then grep_motion_source / replace_motion_source with video_id, or create_motion_video.',
			inputSchema: z.object({}),
			execute: async () => {
				const videos = await listMotionVideos(supabase, brandId);
				return {
					videos: videos.map((v) => ({
						video_id: v.id,
						title: v.title,
						width: v.width,
						height: v.height,
						fps: v.fps,
						duration_in_frames: v.duration_in_frames,
						preview_url: v.preview_url,
						updated_at: v.updated_at
					})),
					hint: MOTION_SOURCE_HINT
				};
			}
		}),

		create_motion_video: tool({
			description: [
				'Create a Remotion kinetic motion ad in the Motion video gallery (not a talking UGC reel — that is create_post content_type:video).',
				'Omit source to start from the branded seed TSX, then patch with grep_motion_source / replace_motion_source.',
				'Pass source only when you already have a full valid Remotion file (import React + remotion, export fps/durationInFrames/width/height, export default function).',
				'Need photos inside the composition? read_media first. If a library image fits, use_library_image then replace_motion_source <Img src="https://..." />. generate_image only when nothing fits. Never invent URLs.'
			].join('\n'),
			inputSchema: z.object({
				title: z.string().min(1).max(80).optional().describe('Gallery label'),
				source: z
					.string()
					.min(1)
					.max(MOTION_SOURCE_MAX_CHARS)
					.optional()
					.describe('Full Remotion TSX. Omit to use the branded seed and patch it.')
			}),
			execute: async ({ title, source }) => {
				const blocked = await requireMotionCredits(brandId);
				if (blocked) return blocked;
				const seed = await loadSeedSource(supabase, brandId);
				const tsx = source?.trim() ? source : seed.source;
				const label = title?.trim() || `${seed.brandName} motion`;
				const saved = await persistCompiled(supabase, brandId, userId, { title: label, source: tsx });
				if (!('error' in saved)) noteRead('motion', String(saved.video_id), saved.updated_at);
				return saved;
			}
		}),

		grep_motion_source: tool({
			description:
				'Find a word or snippet in a motion video Remotion TSX. Returns char indexes for read_motion_source. Literal match by default. Not for social-post graphics (use grep_source + post_id).',
			inputSchema: z.object({
				video_id: z.string().describe('Id from list_motion_videos / create_motion_video'),
				query: z.string().min(1).max(500),
				regex: z.boolean().optional(),
				ignore_case: z.boolean().optional()
			}),
			execute: async ({ video_id, query, regex, ignore_case }) => {
				const blocked = await requireMotionCredits(brandId);
				if (blocked) return blocked;
				const loaded = await loadOwned(supabase, brandId, video_id);
				if ('error' in loaded) return loaded;
				try {
					const found = grepSource(loaded.row.source, query, {
						regex: regex === true,
						ignoreCase: ignore_case === true
					});
					return {
						video_id,
						title: loaded.row.title,
						query,
						...found
					};
				} catch (e) {
					return { error: e instanceof Error ? e.message : String(e) };
				}
			}
		}),

		read_motion_source: tool({
			description: `Read a slice of a motion video Remotion TSX. Default ${MOTION_READ_DEFAULT_CHARS} chars from start_from. If next_start is set, call again. Cap ${MOTION_READ_MAX_CHARS}. Not for social-post graphics (use read_source + post_id).`,
			inputSchema: z.object({
				video_id: z.string().describe('Id from list_motion_videos / create_motion_video'),
				start_from: z.number().int().min(0).optional(),
				max_chars: z.number().int().min(1).max(MOTION_READ_MAX_CHARS).optional()
			}),
			execute: async ({ video_id, start_from, max_chars }) => {
				const blocked = await requireMotionCredits(brandId);
				if (blocked) return blocked;
				const loaded = await loadOwned(supabase, brandId, video_id);
				if ('error' in loaded) return loaded;
			const page = sliceSource(
				loaded.row.source,
				start_from ?? 0,
				max_chars ?? MOTION_READ_DEFAULT_CHARS
			);
			noteRead('motion', video_id, loaded.row.updated_at);
			return {
				video_id,
				title: loaded.row.title,
				updated_at: loaded.row.updated_at,
				...page
			};
			}
		}),

		replace_motion_source: tool({
			description:
				'Replace substring(s) in a motion video Remotion TSX and persist. First match by default; count=N for the first N; replace_all=true for every occurrence. After use_library_image or generate_image, put the URL in <Img src="https://..." />. Does not return the full file. Not for social-post graphics (use replace_source + post_id). Refused unless read_motion_source ran first — and refused again if the source changed since.',
			inputSchema: z.object({
				video_id: z.string(),
				old_str: z.string().min(1).max(MOTION_SOURCE_MAX_CHARS),
				new_str: z.string().max(MOTION_SOURCE_MAX_CHARS),
				replace_all: z.boolean().optional(),
				count: z.number().int().min(1).max(500).optional()
			}),
			execute: async ({ video_id, old_str, new_str, replace_all, count }) => {
				const blocked = await requireMotionCredits(brandId);
				if (blocked) return blocked;
				const loaded = await loadOwned(supabase, brandId, video_id);
				if ('error' in loaded) return loaded;
				const stale = requireFreshRead(
					'motion',
					video_id,
					loaded.row.updated_at,
					'The motion source',
					'read_motion_source({ video_id })'
				);
				if (stale) return stale;
				try {
					const { source: next, replaced } = applyReplace(loaded.row.source, old_str, new_str, {
						replaceAll: replace_all === true,
						count
					});
					const saved = await persistCompiled(supabase, brandId, userId, {
						id: video_id,
						title: loaded.row.title,
						source: next
					});
					if ('error' in saved) return saved;
					noteRead('motion', video_id, saved.updated_at);
					return { ...saved, replaced };
				} catch (e) {
					return { error: e instanceof Error ? e.message : String(e) };
				}
			}
		}),

		write_motion_source: tool({
			description:
				'Replace the entire Remotion TSX of an existing motion video. Use only when replace_motion_source cannot express the change. Does not return the full file. Refused unless read_motion_source ran first — and refused again if the source changed since.',
			inputSchema: z.object({
				video_id: z.string(),
				source: z.string().min(1).max(MOTION_SOURCE_MAX_CHARS)
			}),
			execute: async ({ video_id, source }) => {
				const blocked = await requireMotionCredits(brandId);
				if (blocked) return blocked;
				const loaded = await loadOwned(supabase, brandId, video_id);
				if ('error' in loaded) return loaded;
				const stale = requireFreshRead(
					'motion',
					video_id,
					loaded.row.updated_at,
					'The motion source',
					'read_motion_source({ video_id })'
				);
				if (stale) return stale;
				const saved = await persistCompiled(supabase, brandId, userId, {
					id: video_id,
					title: loaded.row.title,
					source
				});
				if (!('error' in saved)) noteRead('motion', video_id, saved.updated_at);
				return saved;
			}
		}),

		search_library_docs: tool({
			description: [
				'Up-to-date documentation for a code library — Remotion by default. Returns real snippets from the current docs, not memory.',
				'Use it BEFORE calling an API you are not certain of, and when a render or compile error smells like the API (unknown prop, missing export, changed signature). Not on every edit.',
				'It tells you how the LIBRARY works. How WE make videos — transitions, easing, brand rules, the craft specs — comes from this prompt and outranks any generic example the docs return.'
			].join(' '),
			inputSchema: z.object({
				topic: z
					.string()
					.min(3)
					.describe('What you need to know, 1-10 words: "spring config damping", "Audio component volume", "staticFile vs remote src"'),
				library: z
					.string()
					.optional()
					.describe('Only when the question is NOT about Remotion (e.g. "react", "zod"). Defaults to Remotion.')
			}),
			// ponytail: no per-turn cap — the call is free and ~0.6s. Add one if a loop ever shows up.
			execute: async ({ topic, library }) => {
				try {
					let libraryId = REMOTION_LIBRARY_ID;
					if (library && !/remotion/i.test(library)) {
						const found = await context7(`/libs/search?libraryName=${encodeURIComponent(library)}`);
						const first = (await found.json())?.results?.[0]?.id;
						if (typeof first !== 'string' || !first)
							return { error: `No documented library matches "${library}"`, topic };
						libraryId = first;
					}
					const res = await context7(
						`/context?libraryId=${encodeURIComponent(libraryId)}&query=${encodeURIComponent(topic)}&tokens=${DOC_TOKENS}`
					);
					const docs = (await res.text()).slice(0, DOC_MAX_CHARS);
					if (!docs.trim()) return { error: 'No documentation found for that topic', library: libraryId, topic };
					return { library: libraryId, topic, docs };
				} catch (e) {
					// The docs service being down must never end the turn: it degrades to "not found".
					return {
						error: `Documentation lookup unavailable (${e instanceof Error ? e.message : String(e)})`,
						topic,
						hint: 'Do not retry more than once. Carry on from what you know and from the patterns in this project.'
					};
				}
			}
		})
	};
}
