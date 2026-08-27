import type { SupabaseClient } from '@supabase/supabase-js';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { withBrandContext } from '$lib/server/ai-log';
import { CreditsExhaustedError } from '$lib/server/credits';
import { runMotionVideoTurn } from '$lib/server/motion-video/run-turn';
import { scoreAndMaybeRewriteMotion } from '$lib/server/motion-video/qc';
import {
	deleteMotionVideo,
	getMotionVideo,
	insertMotionVideoPrompt,
	saveMotionVideo
} from '$lib/server/motion-video/persist';
import { MOTION_ASPECTS, MOTION_DURATION_PRESETS, MOTION_SOURCE_MAX_CHARS } from '$lib/motion-video/source';
import { compileMotionSource } from '$lib/motion-video/compile';
import {
	attachDesignerStreamMirror,
	DESIGNER_TOOL_MOTION,
	designerTurnNeedsContinuation,
	enqueueDesignerContinuation,
	finishDesignerJob,
	insertDesignerJob,
	scheduleDesignerKick
} from '$lib/server/designer-jobs';
import { shouldContinueDesignerSlice, mergeDesignerSliceEnd } from '$lib/designer-limits';
import {
	CHAT_TURN_ABORT_MS,
	chatTurnDeadline
} from '$lib/server/chat/turn-limits';
import {
	closeSurfaceTurn,
	keySurfaceTurn,
	openSurfaceTurn
} from '$lib/server/chat/surface-turn';

// Must match CHAT_MAX_DURATION_MS: this route builds its deadline from chatTurnDeadline() and its
// hard stop from CHAT_TURN_ABORT_MS, so a smaller wall here means both fire long after the platform
// has already killed the function — taking the designer continuation chain with it.
export const config = { maxDuration: 1800 };

const chatSchema = z.object({
	action: z.literal('chat'),
	prompt: z.string().min(1).max(8000),
	selectedIds: z.array(z.string().uuid()).max(6).default([]),
	aspectRatio: z.enum(MOTION_ASPECTS).optional().default('1:1'),
	duration: z.enum(MOTION_DURATION_PRESETS).optional().default('auto'),
	reflowAspect: z.boolean().optional().default(false),
	uploads: z.array(z.string().startsWith('data:image/').max(1_500_000)).max(4).default([]),
	ads: z
		.array(
			z.object({
				id: z.string().min(1).max(80),
				pageName: z.string().max(120).optional(),
				body: z.string().max(400).nullable().optional(),
				thumbnailUrl: z.string().url().max(2000),
				libraryUrl: z.string().url().max(400).nullable().optional()
			})
		)
		.max(6)
		.default([])
});

const saveSchema = z.object({
	action: z.literal('save'),
	id: z.string().uuid().nullable().optional(),
	title: z.string().min(1).max(120),
	source: z.string().min(1).max(MOTION_SOURCE_MAX_CHARS),
	fps: z.number().int().positive().max(60),
	durationInFrames: z.number().int().positive().max(3600),
	width: z.number().int().positive().max(4096),
	height: z.number().int().positive().max(4096),
	previewUrl: z.string().url().nullable().optional()
});

const deleteSchema = z.object({
	action: z.literal('delete'),
	id: z.string().uuid()
});

const getSchema = z.object({
	action: z.literal('get'),
	id: z.string().uuid()
});

const qcSchema = z.object({
	action: z.literal('qc'),
	id: z.string().uuid(),
	/** When false, only score the current preview — never patch TSX. */
	apply: z.boolean().optional().default(true),
	/** Passes already remade this encode — skip rewriting them again. */
	rewritten: z.array(z.enum(['craft', 'fidelity', 'ads'])).optional().default([])
});

async function loadBrand(supabase: SupabaseClient, slug: string) {
	const { data: brand } = await supabase
		.from('brands')
		.select('id, slug, name')
		.eq('slug', slug)
		.maybeSingle();
	return brand;
}

export const POST: RequestHandler = async ({
	request,
	params,
	locals: { supabase, safeGetSession },
	platform
}) => {
	const { user } = await safeGetSession();
	if (!user) throw error(401, 'Unauthorized');

	const brand = await loadBrand(supabase, params.brand);
	if (!brand) throw error(404, 'Brand not found');

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const action =
		raw && typeof raw === 'object' && 'action' in raw
			? String((raw as { action?: unknown }).action ?? '')
			: '';

	if (action === 'save') {
		const parsed = saveSchema.safeParse(raw);
		if (!parsed.success) throw error(400, 'Invalid save body');
		const result = await saveMotionVideo(supabase, {
			brandId: brand.id,
			userId: user.id,
			id: parsed.data.id,
			title: parsed.data.title,
			source: parsed.data.source,
			meta: {
				fps: parsed.data.fps,
				durationInFrames: parsed.data.durationInFrames,
				width: parsed.data.width,
				height: parsed.data.height
			},
			previewUrl: parsed.data.previewUrl
		});
		if (!result.ok) throw error(400, result.error);
		return json({ ok: true, video: result.row });
	}

	if (action === 'delete') {
		const parsed = deleteSchema.safeParse(raw);
		if (!parsed.success) throw error(400, 'Invalid delete body');
		const result = await deleteMotionVideo(supabase, brand.id, parsed.data.id);
		if (!result.ok) throw error(400, result.error);
		return json({ ok: true });
	}

	if (action === 'get') {
		const parsed = getSchema.safeParse(raw);
		if (!parsed.success) throw error(400, 'Invalid get body');
		const row = await getMotionVideo(supabase, brand.id, parsed.data.id);
		if (!row) throw error(404, 'Not found');
		return json({ ok: true, video: row });
	}

	if (action === 'qc') {
		const parsed = qcSchema.safeParse(raw);
		if (!parsed.success) throw error(400, 'Invalid qc body');
		const result = await scoreAndMaybeRewriteMotion({
			supabase,
			userId: user.id,
			brand: { id: brand.id, name: brand.name as string },
			videoId: parsed.data.id,
			apply: parsed.data.apply,
			rewritten: parsed.data.rewritten,
			abortSignal: request.signal
		});
		if (result.error === 'not_found') throw error(404, 'Not found');
		return json(result);
	}

	if (action !== 'chat') throw error(400, 'Unknown action');

	const parsed = chatSchema.safeParse(raw);
	if (!parsed.success) throw error(400, 'Invalid chat body');

	const promptRow = await insertMotionVideoPrompt(supabase, {
		brandId: brand.id,
		userId: user.id,
		prompt: parsed.data.prompt,
		selectedCount: parsed.data.selectedIds.length
	});
	const promptId = 'id' in promptRow ? promptRow.id : null;
	if (!promptId) {
		console.error(
			'[motion-video] prompt insert failed',
			'error' in promptRow ? promptRow.error : ''
		);
	}

	const origin = new URL(request.url).origin;
	const locale = (request.headers.get('accept-language') || '').toLowerCase().startsWith('en')
		? 'en'
		: 'it';
	const deadline = chatTurnDeadline(Date.now());
	const abortController = new AbortController();
	const hardStop = setTimeout(() => abortController.abort(), CHAT_TURN_ABORT_MS);

	const selectedIds = [...parsed.data.selectedIds];
	const jobId = await insertDesignerJob(supabase, {
		brandId: brand.id,
		userId: user.id,
		toolName: DESIGNER_TOOL_MOTION,
		inputParams: {
			prompt: parsed.data.prompt,
			selectedIds,
			ads: parsed.data.ads,
			aspectRatio: parsed.data.aspectRatio,
			duration: parsed.data.duration,
			reflowAspect: parsed.data.reflowAspect,
			origin,
			locale,
			continuation_depth: 0
		}
	});
	const mirror = jobId ? attachDesignerStreamMirror(supabase, jobId) : null;
	const slice = { finished: false, steps: 0 };

	// The turn also lives in a normal chat thread from here on: it shows up in the sidebar, it can
	// be reopened, and continuing it there hands the conversation to the `motion` agent — same
	// tools, same craft rules. Editing a composition continues that composition's thread; a brand
	// new one opens a thread that gets bound to the video the moment it is saved.
	const thread = await openSurfaceTurn(supabase, {
		brandId: brand.id,
		userId: user.id,
		surface: 'motion',
		agent: 'motion',
		key: selectedIds[0] ?? null,
		prompt: parsed.data.prompt,
		fallbackTitle: 'Motion video',
		attachments: parsed.data.uploads
	});

	try {
		const response = await withBrandContext(brand.id, () =>
			runMotionVideoTurn({
				supabase,
				userId: user.id,
				brand: { id: brand.id, name: brand.name as string },
				prompt: parsed.data.prompt,
				selectedIds,
				uploads: parsed.data.uploads,
				ads: parsed.data.ads,
				aspectRatio: parsed.data.aspectRatio,
				duration: parsed.data.duration,
				reflowAspect: parsed.data.reflowAspect,
				// Lo stesso thread in cui la risposta viene scritta: è quello a cui appartiene un
				// eventuale artefatto consegnato durante il giro.
				threadId: thread?.id ?? null,
				abortSignal: abortController.signal,
				deadline,
				onSaved: (id) => {
					if (!selectedIds.includes(id)) selectedIds.push(id);
					void keySurfaceTurn(supabase, thread, { brandId: brand.id, userId: user.id, key: id });
				},
				onSliceEnd: (info) => {
					slice.finished = info.finished;
					slice.steps = info.steps;
				},
				consumeSseStream: mirror
					? async ({ stream }) => {
							await mirror.consumeSseStream({ stream });
							// The reply the user just watched stream in is the reply the thread must
							// hold — a thread with a dangling user message reads as an unanswered
							// question when it is reopened.
							await closeSurfaceTurn(supabase, thread, {
								brandId: brand.id,
								userId: user.id,
								state: mirror.state()
							});
							if (!jobId) return;
							const keepGoing = shouldContinueDesignerSlice({
								...mergeDesignerSliceEnd(slice, mirror.state().tools),
								timedOut: designerTurnNeedsContinuation(deadline),
								tools: mirror.state().tools
							});
							if (keepGoing) {
								const child = await enqueueDesignerContinuation(supabase, {
									brandId: brand.id,
									userId: user.id,
									toolName: DESIGNER_TOOL_MOTION,
									parentJobId: jobId,
									inputParams: {
										prompt: parsed.data.prompt,
										selectedIds,
										ads: parsed.data.ads,
										aspectRatio: parsed.data.aspectRatio,
										duration: parsed.data.duration,
										reflowAspect: parsed.data.reflowAspect,
										// Senza il thread la slice di continuazione non sa dove scrivere la
										// propria parte della risposta: stessa perdita che aveva l'UGC.
										threadId: thread?.id ?? null,
										origin,
										locale
									},
									origin,
									locale,
									depth: 0
								});
								if (child) {
									scheduleDesignerKick(
										platform as { context?: { waitUntil?: (p: Promise<unknown>) => void } },
										origin
									);
								}
							} else {
								await finishDesignerJob(supabase, jobId, {
									status: 'done',
									partial: mirror.snapshot()
								});
							}
						}
					: undefined
			})
		);
		if (promptId) response.headers.set('X-Motion-Video-Prompt-Id', promptId);
		if (jobId) response.headers.set('X-Designer-Job-Id', jobId);
		return response;
	} catch (e) {
		if (jobId) {
			await finishDesignerJob(supabase, jobId, {
				status: 'failed',
				error: e instanceof Error ? e.message.slice(0, 2000) : 'motion turn failed',
				partial: mirror?.snapshot() ?? null
			});
		}
		if (e instanceof CreditsExhaustedError) {
			return json({ error: 'credits_exhausted' }, { status: 402 });
		}
		throw e;
	} finally {
		clearTimeout(hardStop);
	}
};
