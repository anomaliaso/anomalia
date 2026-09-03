import { tool } from 'ai';
import { z } from 'zod';
import { GRAPHIC_SOURCE_MAX_CHARS, unwrapGraphicSource } from '$lib/design/graphic-source';
import {
	MOTION_READ_DEFAULT_CHARS,
	MOTION_READ_MAX_CHARS,
	applyReplace,
	grepSource,
	sliceSource
} from '$lib/motion-video/source-ops';
import type { EditorTarget, EditorContext } from '$lib/agent/tools/post-editor-tools';
import type { SupabaseClient } from '@supabase/supabase-js';
import { noteRead, requireFreshRead } from './read-guards';

/**
 * DUE POSTI DOVE PUÒ VIVERE UNA GRAFICA, e un solo modo di modificarla.
 *
 * Il sorgente sta in `graphic_designs`, che indirizza `{ kind, id }` — un post o un asset di
 * libreria — da sempre. Questi strumenti però conoscevano solo il post, quindi una grafica
 * standalone si poteva rifare a parole e non correggere di una parola: aveva il codice e nessuno
 * sapeva aprirlo.
 */
export type StandaloneTarget = {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	ctx: EditorContext;
	mediaId: string;
};

export type GraphicEditTarget = EditorTarget | StandaloneTarget;

const isStandalone = (t: GraphicEditTarget): t is StandaloneTarget => 'mediaId' in t;

/** Il risultato nomina il bersaglio VERO: `post_id: undefined` su un asset era una risposta rotta. */
const targetEcho = (t: GraphicEditTarget) =>
	isStandalone(t) ? { media_id: t.mediaId } : { post_id: t.postId };

const graphicTarget = (t: GraphicEditTarget, slideIndex?: number | null) =>
	isStandalone(t)
		? ({ kind: 'media_item' as const, id: t.mediaId })
		: ({ kind: 'post' as const, id: t.postId, slideIndex: slideIndex ?? null });

export { MOTION_READ_DEFAULT_CHARS as GRAPHIC_READ_DEFAULT_CHARS, MOTION_READ_MAX_CHARS as GRAPHIC_READ_MAX_CHARS };

type SlideArgs = { slide_index?: number };

/** La chiave del receipt: stessa derivazione da args in lettura e in scrittura. */
const receiptId = (t: GraphicEditTarget, slideIndex?: number | null) =>
	isStandalone(t) ? `media:${t.mediaId}` : `${t.postId}|${slideIndex ?? ''}`;

const SOURCE_READ_TOOL = 'read_source({ slide_index })';

async function loadWorkingGraphicSource(t: GraphicEditTarget, slideIndex?: number | null) {
	const { latestGraphic, versionSource } = await import('$lib/server/design-store');
	let graphic = await latestGraphic(t.supabase, graphicTarget(t, slideIndex));
	// Le carousel indirizzano uno slot; una cover puo` essere salvata con `null` o con `0`, e le
	// due scritture convivono da prima che lo slot esistesse. Non vale per un asset standalone.
	if (!graphic && !isStandalone(t) && (slideIndex == null || slideIndex === 0)) {
		graphic = await latestGraphic(t.supabase, graphicTarget(t, slideIndex == null ? 0 : null));
	}
	if (!graphic) {
		return {
			error: isStandalone(t)
				? 'No graphic source on this library asset. Compose one with design_graphic first.'
				: 'No graphic source on this post. Compose one with design_graphic first.'
		};
	}
	return {
		source: versionSource(graphic),
		kind: graphic.sourceKind,
		version: graphic.version,
		aspect: graphic.aspect
	};
}

/**
 * IL GATE, prima che il PNG esista.
 *
 * Le due tool che scrivono sorgente (write_source / replace_source) sono le SOLE porte da cui un
 * modello cambia una grafica; l'editor del browser passa da `applyPostGraphicSource` e non da qui,
 * perché rifiutare il salvataggio di una persona che sta guardando la tela sarebbe assurdo.
 *
 * Solo `text_below_feed_floor` blocca: il px è letterale nel sorgente e si corregge alzandolo.
 * Il resto torna come `design_warnings` nel risultato — vedi l'intestazione di graphic-check.ts.
 */
async function inspectSource(t: GraphicEditTarget, source: string) {
	try {
		const [{ sourceToSatoriTree }, { inspectGraphicTree }] = await Promise.all([
			import('$lib/server/design-render'),
			import('$lib/design/graphic-check')
		]);
		const { tree, width, height } = await sourceToSatoriTree(source);
		return inspectGraphicTree(tree, { width, height, brandColors: t.ctx.brandColors });
	} catch {
		// Sorgente illeggibile: il render lo dirà con l'errore vero. Il gate non inventa il suo.
		return [];
	}
}

/** L'unica differenza fra i due posti: dove il PNG viene scritto. */
async function applyGraphicSource(
	t: GraphicEditTarget,
	source: string,
	slideIndex: number | undefined,
	brief: string
) {
	if (isStandalone(t)) {
		const { applyStandaloneGraphicSource } = await import('$lib/agent/tools/post-editor-tools');
		return applyStandaloneGraphicSource(t, { source, brief });
	}
	const { applyPostGraphicSource } = await import('$lib/agent/tools/post-editor-tools');
	return applyPostGraphicSource(t, { source, slide_index: slideIndex, brief });
}

function refusal(issues: Array<{ blocking: boolean; detail: string }>) {
	const blocking = issues.filter((i) => i.blocking);
	if (!blocking.length) return null;
	return {
		error: `Refused — text that would not survive the feed. A graphic is composed at canvas size and seen at about a third of it:\n${blocking
			.map((i) => `- ${i.detail}`)
			.join('\n')}\nFix those and call the tool again.`
	};
}

const warnings = (issues: Array<{ blocking: boolean; detail: string }>) => {
	const soft = issues.filter((i) => !i.blocking).map((i) => i.detail);
	return soft.length ? { design_warnings: soft } : {};
};

/** Drop the full HTML/TSX from a persist result so chat tools never echo the file. */
export function compactGraphicPersist(result: object, extra: Record<string, unknown> = {}) {
	const rec = result as Record<string, unknown>;
	if (rec.error && rec.success !== true) return { error: String(rec.error) };
	// `_images` sopravvive al compattamento: e' il render, non un dettaglio di implementazione, ed
	// e' la sola cosa che permette al modello di vedere quello che ha appena composto.
	const { graphic_source, graphic_spec: _spec, ...rest } = rec;
	return {
		ok: true as const,
		...rest,
		...(typeof graphic_source === 'string' ? { source_chars: graphic_source.length } : {}),
		...extra
	};
}

export async function grepPostGraphicSource(
	t: GraphicEditTarget,
	args: SlideArgs & { query: string; regex?: boolean; ignore_case?: boolean }
) {
	const working = await loadWorkingGraphicSource(t, args.slide_index);
	if ('error' in working) return working;
	try {
		const found = grepSource(working.source, args.query, {
			regex: args.regex === true,
			ignoreCase: args.ignore_case === true
		});
		return {
			...targetEcho(t),
			slide_index: args.slide_index ?? null,
			kind: working.kind,
			query: args.query,
			...found
		};
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

export async function readPostGraphicSource(
	t: GraphicEditTarget,
	args: SlideArgs & { start_from?: number; max_chars?: number }
) {
	const working = await loadWorkingGraphicSource(t, args.slide_index);
	if ('error' in working) return working;
	const page = sliceSource(
		working.source,
		args.start_from ?? 0,
		args.max_chars ?? MOTION_READ_DEFAULT_CHARS
	);
	noteRead('graphic', receiptId(t, args.slide_index), working.version);
	return {
		...targetEcho(t),
		slide_index: args.slide_index ?? null,
		kind: working.kind,
		...page
	};
}

export async function replacePostGraphicSource(
	t: GraphicEditTarget,
	args: SlideArgs & { old_str: string; new_str: string; replace_all?: boolean; count?: number }
) {
	const working = await loadWorkingGraphicSource(t, args.slide_index);
	if ('error' in working) return working;
	const stale = requireFreshRead(
		'graphic',
		receiptId(t, args.slide_index),
		working.version,
		'The graphic source',
		SOURCE_READ_TOOL
	);
	if (stale) return stale;
	let next: string;
	let replaced: number;
	try {
		({ source: next, replaced } = applyReplace(working.source, args.old_str, args.new_str, {
			replaceAll: args.replace_all === true,
			count: args.count
		}));
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
	const issues = await inspectSource(t, next);
	const refused = refusal(issues);
	if (refused) return refused;
	const saved = await applyGraphicSource(t, next, args.slide_index, 'replace_source');
	const out = compactGraphicPersist(saved, { replaced, ...warnings(issues) });
	if ('success' in saved && typeof saved.version !== 'undefined') {
		noteRead('graphic', receiptId(t, args.slide_index), saved.version);
	}
	return out;
}

export async function writePostGraphicSource(t: GraphicEditTarget, args: SlideArgs & { source: string }) {
	const staleGate = await loadWorkingGraphicSource(t, args.slide_index);
	if (!('error' in staleGate)) {
		const stale = requireFreshRead(
			'graphic',
			receiptId(t, args.slide_index),
			staleGate.version,
			'The graphic source',
			SOURCE_READ_TOOL
		);
		if (stale) return stale;
	}
	const source = unwrapGraphicSource(args.source);
	const issues = await inspectSource(t, source);
	const refused = refusal(issues);
	if (refused) return refused;
	const saved = await applyGraphicSource(t, source, args.slide_index, 'write_source');
	const out = compactGraphicPersist(saved, warnings(issues));
	if ('success' in saved && typeof saved.version !== 'undefined') {
		noteRead('graphic', receiptId(t, args.slide_index), saved.version);
	}
	return out;
}

type ResolveTarget = (args: {
	post_id?: string;
	media_id?: string;
	slide_index?: number;
}) => Promise<GraphicEditTarget | { error: string }>;

/**
 * grep_source / read_source / replace_source / write_source — same contract as motion-video.
 * Post editor: resolve ignores post_id. Brand chat: requirePostId.
 */
export function createGraphicSourceEditTools(resolve: ResolveTarget, opts: { requirePostId?: boolean } = {}) {
	// Nella chat il bersaglio va nominato, e ci sono due modi di nominarlo: il post che porta la
	// grafica, o l'asset di libreria quando la grafica non appartiene a nessun post. Nell'editor
	// il bersaglio è la pagina stessa, quindi restano entrambi opzionali e ignorati.
	const postId = opts.requirePostId
		? {
				post_id: z
					.string()
					.optional()
					.describe('Post id from read_posts. Give this OR media_id.'),
				media_id: z
					.string()
					.optional()
					.describe('Library asset id from read_media, for a graphic that belongs to no post. Give this OR post_id.')
			}
		: {
				post_id: z.string().optional(),
				media_id: z.string().optional()
			};
	const slide = {
		slide_index: z
			.number()
			.int()
			.optional()
			.describe('Carousel only: which slide (0 = cover). Omit for a single-image post.')
	};

	async function target(args: { post_id?: string; slide_index?: number }) {
		return resolve(args);
	}

	return {
		grep_source: tool({
			description:
				"Find a word or snippet in a graphic's HTML/TSX — the post's (post_id) or a standalone library asset's (media_id). Returns char indexes for read_source start_from. Literal match by default. Max 40 hits.",
			inputSchema: z.object({
				query: z.string().min(1).max(500),
				regex: z.boolean().optional(),
				ignore_case: z.boolean().optional(),
				...postId,
				...slide
			}),
			execute: async (args) => {
				const t = await target(args);
				if ('error' in t) return t;
				return grepPostGraphicSource(t, args);
			}
		}),
		read_source: tool({
			description: `Read a slice of a graphic's HTML/TSX — the post's (post_id) or a standalone library asset's (media_id). Default ${MOTION_READ_DEFAULT_CHARS} chars from start_from (0-based). If next_start is set, call again with start_from=next_start. Cap ${MOTION_READ_MAX_CHARS}.`,
			inputSchema: z.object({
				start_from: z.number().int().min(0).optional(),
				max_chars: z.number().int().min(1).max(MOTION_READ_MAX_CHARS).optional(),
				...postId,
				...slide
			}),
			execute: async (args) => {
				const t = await target(args);
				if ('error' in t) return t;
				return readPostGraphicSource(t, args);
			}
		}),
		replace_source: tool({
			description:
				'Replace substring(s) in the graphic HTML/TSX, then re-render the PNG. First match by default; count=N for the first N; replace_all=true for every occurrence. old_str must match exactly. Does not return the full file. Refused unless you read_source first — and refused again if the source changed since that read.',
			inputSchema: z.object({
				old_str: z.string().min(1).max(GRAPHIC_SOURCE_MAX_CHARS),
				new_str: z.string().max(GRAPHIC_SOURCE_MAX_CHARS),
				replace_all: z.boolean().optional(),
				count: z.number().int().min(1).max(500).optional(),
				...postId,
				...slide
			}),
			execute: async (args) => {
				const t = await target(args);
				if ('error' in t) return t;
				return replacePostGraphicSource(t, args);
			}
		}),
		write_source: tool({
			description:
				'Replace the entire graphic HTML/TSX and re-render. Use only when replace_source cannot express the change (new structure). Does not return the full file. Refused unless you read_source first — and refused again if the source changed since that read.',
			inputSchema: z.object({
				source: z.string().min(1).max(GRAPHIC_SOURCE_MAX_CHARS),
				...postId,
				...slide
			}),
			execute: async (args) => {
				const t = await target(args);
				if ('error' in t) return t;
				return writePostGraphicSource(t, args);
			}
		})
	};
}
