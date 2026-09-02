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
import type { EditorTarget } from '$lib/agent/tools/post-editor-tools';
import { noteRead, requireFreshRead } from './read-guards';

export { MOTION_READ_DEFAULT_CHARS as GRAPHIC_READ_DEFAULT_CHARS, MOTION_READ_MAX_CHARS as GRAPHIC_READ_MAX_CHARS };

type SlideArgs = { slide_index?: number };

/** La chiave del receipt: stessa derivazione da args in lettura e in scrittura. */
const receiptId = (t: EditorTarget, slideIndex?: number | null) => `${t.postId}|${slideIndex ?? ''}`;

const SOURCE_READ_TOOL = 'read_source({ slide_index })';

async function loadWorkingGraphicSource(t: EditorTarget, slideIndex?: number | null) {
	const { latestGraphic, versionSource } = await import('$lib/server/design-store');
	const load = (idx: number | null) =>
		latestGraphic(t.supabase, { kind: 'post', id: t.postId, slideIndex: idx });
	let graphic = await load(slideIndex ?? null);
	if (!graphic && (slideIndex == null || slideIndex === 0)) {
		graphic = await load(slideIndex == null ? 0 : null);
	}
	if (!graphic) {
		return { error: 'No graphic source on this post. Compose one with design_graphic first.' };
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
async function inspectSource(t: EditorTarget, source: string) {
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
	const { graphic_source, graphic_spec: _spec, ...rest } = rec;
	return {
		ok: true as const,
		...rest,
		...(typeof graphic_source === 'string' ? { source_chars: graphic_source.length } : {}),
		...extra
	};
}

export async function grepPostGraphicSource(
	t: EditorTarget,
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
			post_id: t.postId,
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
	t: EditorTarget,
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
		post_id: t.postId,
		slide_index: args.slide_index ?? null,
		kind: working.kind,
		...page
	};
}

export async function replacePostGraphicSource(
	t: EditorTarget,
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
	const { applyPostGraphicSource } = await import('$lib/agent/tools/post-editor-tools');
	const saved = await applyPostGraphicSource(t, {
		source: next,
		slide_index: args.slide_index,
		brief: 'replace_source'
	});
	const out = compactGraphicPersist(saved, { replaced, ...warnings(issues) });
	if ('success' in saved && typeof saved.version !== 'undefined') {
		noteRead('graphic', receiptId(t, args.slide_index), saved.version);
	}
	return out;
}

export async function writePostGraphicSource(t: EditorTarget, args: SlideArgs & { source: string }) {
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
	const { applyPostGraphicSource } = await import('$lib/agent/tools/post-editor-tools');
	const saved = await applyPostGraphicSource(t, {
		source,
		slide_index: args.slide_index,
		brief: 'write_source'
	});
	const out = compactGraphicPersist(saved, warnings(issues));
	if ('success' in saved && typeof saved.version !== 'undefined') {
		noteRead('graphic', receiptId(t, args.slide_index), saved.version);
	}
	return out;
}

type ResolveTarget = (args: {
	post_id?: string;
	slide_index?: number;
}) => Promise<EditorTarget | { error: string }>;

/**
 * grep_source / read_source / replace_source / write_source — same contract as motion-video.
 * Post editor: resolve ignores post_id. Brand chat: requirePostId.
 */
export function createGraphicSourceEditTools(resolve: ResolveTarget, opts: { requirePostId?: boolean } = {}) {
	const postId = opts.requirePostId
		? {
				post_id: z.string().describe('Post id from read_posts')
			}
		: {
				post_id: z.string().optional()
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
				'Find a word or snippet in this post\'s graphic HTML/TSX. Returns char indexes for read_source start_from. Literal match by default. Max 40 hits.',
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
			description: `Read a slice of this post's graphic HTML/TSX. Default ${MOTION_READ_DEFAULT_CHARS} chars from start_from (0-based). If next_start is set, call again with start_from=next_start. Cap ${MOTION_READ_MAX_CHARS}.`,
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
