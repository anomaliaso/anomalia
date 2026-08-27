/**
 * Shared Motion-video turn: load brand kit, run the Remotion agent, persist TSX.
 * Used by the interactive POST and by background continuation jobs.
 */
import { env } from '$env/dynamic/private';
import { swallow } from '$lib/server/swallow';
import { loadDesignDoc } from '$lib/server/brand-design-doc';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UIMessage } from 'ai';
import { runMotionVideoAgent } from '$lib/server/motion-video/agent';
import { formatReferenceCandidates, searchMotionReferences } from '$lib/server/motion-references';
import { getMotionVideosByIds, saveMotionVideo } from '$lib/server/motion-video/persist';
import {
	defaultMotionSource,
	MOTION_SOURCE_MAX_CHARS,
	type MotionAspectRatio,
	type MotionDurationPreset
} from '$lib/motion-video/source';
import { formatMotionUserTargetingPrefix } from '$lib/motion-video/session-targets';
import { resolveTypography } from '$lib/design/typography';
import { compileMotionSource } from '$lib/motion-video/compile';
import {
	extractVisualPlaybook,
	formatMotionBrandBrief,
	kitColorHexes,
	kitLogoUrl
} from '$lib/motion-video/brand';
import type { ChatTurnDeadline } from '$lib/server/chat/turn-limits';
import type { DesignerSliceEnd } from '$lib/designer-limits';

export type MotionTurnAds = Array<{
	id: string;
	pageName?: string;
	body?: string | null;
	thumbnailUrl: string;
	libraryUrl?: string | null;
}>;

async function logoDataUrl(url: string | null): Promise<string | null> {
	if (!url) return null;
	if (url.startsWith('data:image/') && !url.startsWith('data:image/svg')) return url;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) return null;
		const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
		if (!mime.startsWith('image/') || mime.includes('svg')) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		if (!buf.length || buf.length > 1_500_000) return null;
		return `data:${mime};base64,${buf.toString('base64')}`;
	} catch {
		return null;
	}
}

/** A slow third-party site must never hold a creative turn open. */
const REFERENCE_PREFETCH_MS = 6000;

/**
 * Search the wall for this brief before the agent starts, on CREATE turns only.
 *
 * An edit turn already has a composition; references are for deciding what to build, not for
 * re-deciding it mid-patch. Free (no clip fetched, no model call), ~2s warm, and it fails to an
 * empty string — a wall that is down, slow or disabled costs the turn nothing.
 */
async function referenceCandidatesFor(prompt: string): Promise<string> {
	try {
		const found = await Promise.race([
			searchMotionReferences({ query: prompt, limit: 6 }),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), REFERENCE_PREFETCH_MS))
		]);
		if (!found?.references?.length) return '';
		return formatReferenceCandidates(found.references);
	} catch {
		return '';
	}
}

export async function loadMotionTurnKit(
	supabase: SupabaseClient,
	brand: { id: string; name: string },
	aspectRatio?: MotionAspectRatio,
	duration?: MotionDurationPreset
) {
	const { data: kit } = await supabase
		.from('brand_kit')
		.select('fonts, brand_colors, logos, favicon_url, visual_style, graphic_style, ai_context')
		.eq('brand_id', brand.id)
		.maybeSingle();
	const colors = kitColorHexes(kit?.brand_colors);
	// The SAME resolver the graphics, the post editor and the media generator use: the typography
	// chosen in Studio wins, then the font detected on the site, then Inter. Motion was the only
	// surface reading `fonts` directly — the raw list of families found while crawling, in discovery
	// order — so a brand that had explicitly picked Inter got its FIRST detected face instead, and
	// for Anomalia that is Halant, a serif. The agent then obeyed the brief perfectly and shipped
	// serif headlines nobody asked for.
	//
	// The list is positional and only two slots are read: [0] is the display face, [1] the body one.
	// Deduping across them looks tidy and is a bug — a brand that picked Inter for both collapses to
	// one entry and the body slot silently falls through to the next detected family.
	const typography = resolveTypography(kit);
	const fonts = [typography.display, typography.body].filter(Boolean);
	const logoUrl = kitLogoUrl(kit?.logos, kit?.favicon_url as string | null);
	const logoImage = await logoDataUrl(logoUrl);
	const seedSource = defaultMotionSource({
		brandName: brand.name,
		ctaText: env.MOTION_AD_CTA,
		accent: colors[0] ?? null,
		colors,
		displayFont: fonts[0] ?? null,
		bodyFont: fonts[1] ?? fonts[0] ?? null,
		logoUrl,
		aspectRatio,
		duration
	});
	const motionBrief = formatMotionBrandBrief({
		brandName: brand.name,
		colors,
		fonts,
		logoUrl,
		visualStyle: typeof kit?.visual_style === 'string' ? kit.visual_style : null,
		graphicStyle: typeof kit?.graphic_style === 'string' ? kit.graphic_style : null,
		playbook: extractVisualPlaybook(kit?.ai_context)
	});
	// The Remotion brief above is instructions — use ONLY these hexes, set style.fontFamily to these
	// names, never redraw the mark. The document below is the brand itself: who it is, how it
	// sounds, what it sells, whose face can appear. A motion video is the brand made visible, so it
	// gets the whole thing; the knowledge index is the one part it cannot act on.
	const designDoc = await loadDesignDoc(supabase, brand.id, {
		brandName: brand.name,
		toolHints: false,
		include: { documents: false }
	}).catch((error) => { swallow('load design doc', error); return ''; });
	const brandBrief = [motionBrief, designDoc].filter(Boolean).join('\n\n');
	return { seedSource, brandBrief, logoImage };
}

export async function runMotionVideoTurn(opts: {
	supabase: SupabaseClient;
	userId: string;
	brand: { id: string; name: string };
	prompt: string;
	selectedIds: string[];
	uploads?: string[];
	ads?: MotionTurnAds;
	aspectRatio?: MotionAspectRatio;
	duration?: MotionDurationPreset;
	reflowAspect?: boolean;
	abortSignal?: AbortSignal;
	/**
	 * Il thread che `openSurfaceTurn` apre per questo giro. Serve ai tool che consegnano un file:
	 * un artefatto appartiene a una conversazione, e senza questo `publish_artifact` — che è già
	 * montato qui dentro perché sta nei tool condivisi della chat — rifiuta ogni chiamata.
	 */
	threadId?: string | null;
	deadline?: ChatTurnDeadline;
	consumeSseStream?: (args: { stream: ReadableStream<string | Uint8Array> }) => Promise<void>;
	onSaved?: (id: string) => void;
	onSliceEnd?: (info: DesignerSliceEnd) => void;
}): Promise<Response> {
	const { gateCredits } = await import('$lib/server/credits');
	await gateCredits(opts.brand.id);

	const selected = await getMotionVideosByIds(opts.supabase, opts.brand.id, opts.selectedIds);
	const kit = await loadMotionTurnKit(opts.supabase, opts.brand, opts.aspectRatio, opts.duration);

	const uploadImages = (opts.uploads ?? []).filter(
		(u) => u.startsWith('data:image/') && !u.startsWith('data:image/svg')
	);
	const ads = opts.ads ?? [];
	const adThumbs = (await Promise.all(ads.map((ad) => logoDataUrl(ad.thumbnailUrl)))).filter(
		(u): u is string => !!u
	);
	const referenceImages = [...uploadImages, ...adThumbs].slice(0, 6);
	const referenceBits: string[] = [];
	if (uploadImages.length) {
		referenceBits.push(
			`${uploadImages.length} photo(s) from the user's device are attached. Visual reference only — do not paste data: URLs into the TSX. Recreate with generate_image / use_library_image if the still must appear in the composition.`
		);
	}
	if (ads.length) {
		referenceBits.push(
			`Ads Library creatives attached (structure/pacing inspiration — remake in OUR brand; never copy their logo, product, or copy verbatim):\n${ads
				.map((a, i) => {
					const body = a.body?.trim() ? ` — "${a.body.trim().slice(0, 180)}"` : '';
					const href = a.libraryUrl ? ` (${a.libraryUrl})` : '';
					return `${i + 1}. ${a.pageName || 'Ad'}${body}${href}`;
				})
				.join('\n')}`
		);
	}

	const selectedTargets = selected.map((v) => ({
		id: v.id,
		title: v.title,
		source: v.source,
		width: v.width,
		height: v.height,
		fps: v.fps,
		durationInFrames: v.duration_in_frames,
		// Per marcare l'anteprima come stantia dopo un edit (vedi persistResolved in agent.ts).
		previewUrl: v.preview_url ?? null
	}));
	const targetingPrefix = formatMotionUserTargetingPrefix(selectedTargets);
	const referenceCandidates = selected.length ? '' : await referenceCandidatesFor(opts.prompt);
	const messages: UIMessage[] = [
		{
			id: crypto.randomUUID(),
			role: 'user',
			parts: [
				{
					type: 'text',
					text: `${targetingPrefix}\n\n${opts.prompt.slice(0, 8000)}`
				}
			]
		}
	];

	return runMotionVideoAgent({
		messages,
		referenceCandidates,
		brandName: opts.brand.name,
		seedSource: kit.seedSource,
		brandBrief: kit.brandBrief,
		logoImage: kit.logoImage ?? undefined,
		referenceImages: referenceImages.length ? referenceImages : undefined,
		referenceNote: referenceBits.join('\n\n') || undefined,
		aspectRatio: opts.aspectRatio,
		duration: opts.duration,
		reflowAspect: opts.reflowAspect,
		selected: selectedTargets,
		brandId: opts.brand.id,
		userId: opts.userId,
		supabase: opts.supabase,
		abortSignal: opts.abortSignal,
		threadId: opts.threadId ?? undefined,
		deadlineReached: opts.deadline ? () => opts.deadline!.reached() : undefined,
		// I sotto-agenti devono sapere quanto tempo resta PRIMA di partire, non scoprirlo a metà.
		remainingMs: opts.deadline ? () => opts.deadline!.remainingMs() : undefined,
		consumeSseStream: opts.consumeSseStream,
		onSliceEnd: opts.onSliceEnd,
		persist: async ({ id, title, source }) => {
			if (source.length > MOTION_SOURCE_MAX_CHARS) {
				throw new Error(`Source exceeds ${MOTION_SOURCE_MAX_CHARS} characters`);
			}
			const compiled = compileMotionSource(source);
			const result = await saveMotionVideo(opts.supabase, {
				brandId: opts.brand.id,
				userId: opts.userId,
				id,
				title,
				source,
				meta: {
					fps: compiled.fps,
					durationInFrames: compiled.durationInFrames,
					width: compiled.width,
					height: compiled.height
				}
			});
			if (!result.ok) throw new Error(result.error);
			opts.onSaved?.(result.row.id);
			return { id: result.row.id, title: result.row.title };
		}
	});
}
