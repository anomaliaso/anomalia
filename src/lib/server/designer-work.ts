import type { SupabaseClient } from '@supabase/supabase-js';
import { withBrandContext } from '$lib/server/ai-log';
import {
	CHAT_PENDING_STALE_MS,
	CHAT_TURN_ABORT_MS,
	chatTurnDeadline
} from '$lib/server/chat/turn-limits';
import {
	attachDesignerStreamMirror,
	DESIGNER_TOOL_MOTION,
	DESIGNER_TOOL_UGC,
	designerContinuePrompt,
	designerTurnNeedsContinuation,
	enqueueDesignerContinuation,
	finishDesignerJob,
	isDesignerTool,
	kickDesignerWork,
	reapStaleDesignerJobs,
	type DesignerToolName
} from '$lib/server/designer-jobs';
import { shouldContinueDesignerSlice, mergeDesignerSliceEnd, type DesignerSliceEnd } from '$lib/designer-limits';
import { runMotionVideoTurn } from '$lib/server/motion-video/run-turn';
import { parseMotionAspectRatio, parseMotionDuration } from '$lib/motion-video/source';
import { streamUgcBatchResponse, type UgcClipPlan } from '$lib/server/media-generator/ugc-batch';
import { closeSurfaceTurn } from '$lib/server/chat/surface-turn';
import { isUgcFormatId, isUgcPlatformId } from '$lib/ugc-formats';

export async function drainDesignerQueue(opts: {
	admin: SupabaseClient;
	origin: string;
	maxJobs?: number;
	reap?: boolean;
}): Promise<{ processed: number; reaped: number }> {
	const reaped = opts.reap
		? await reapStaleDesignerJobs(opts.admin, opts.origin).catch((e) => {
				console.error('[designer-work] reap failed', e);
				return 0;
			})
		: 0;
	const max = Math.max(1, opts.maxJobs ?? 1);
	let processed = 0;
	for (let i = 0; i < max; i++) {
		const r = await processNextDesignerJob(opts.admin, opts.origin);
		if (!r.processed) break;
		processed += 1;
	}
	if (processed > 0) void kickDesignerWork(opts.origin);
	return { processed, reaped };
}

export async function processNextDesignerJob(
	admin: SupabaseClient,
	origin: string
): Promise<{ processed: boolean; jobId?: string; error?: string }> {
	const { data: candidates } = await admin
		.from('chat_jobs')
		.select('id, brand_id, user_id, tool_name, input_params, created_at')
		.in('tool_name', [DESIGNER_TOOL_MOTION, DESIGNER_TOOL_UGC])
		.eq('status', 'pending')
		.order('created_at', { ascending: true })
		.limit(10);

	if (!candidates?.length) return { processed: false };

	for (const c of candidates) {
		if (Date.now() - Date.parse(c.created_at as string) > CHAT_PENDING_STALE_MS) continue;
		const { data: claimed } = await admin
			.from('chat_jobs')
			.update({
				status: 'running',
				partial: { text: '', tools: [], reasoning: '', at: Date.now() }
			})
			.eq('id', c.id)
			.eq('status', 'pending')
			.select('id, brand_id, user_id, tool_name, input_params')
			.maybeSingle();
		if (!claimed) continue;
		return runClaimedDesignerJob(admin, origin, claimed as ClaimedJob);
	}
	return { processed: false };
}

type ClaimedJob = {
	id: string;
	brand_id: string;
	user_id: string;
	tool_name: string;
	input_params: unknown;
};

async function runClaimedDesignerJob(
	admin: SupabaseClient,
	origin: string,
	job: ClaimedJob
): Promise<{ processed: boolean; jobId: string; error?: string }> {
	const jobId = job.id;
	const params = (job.input_params ?? {}) as Record<string, unknown>;
	const locale = params.locale === 'en' ? 'en' : 'it';
	const depth = Math.max(0, Math.trunc(Number(params.continuation_depth)) || 0);
	const toolName = job.tool_name as DesignerToolName;
	if (!isDesignerTool(toolName)) {
		await finishDesignerJob(admin, jobId, { status: 'failed', error: 'unknown designer tool' });
		return { processed: true, jobId, error: 'unknown tool' };
	}

	const { data: brand } = await admin
		.from('brands')
		.select('id, name')
		.eq('id', job.brand_id)
		.maybeSingle();
	if (!brand) {
		await finishDesignerJob(admin, jobId, { status: 'failed', error: 'Brand not found' });
		return { processed: true, jobId, error: 'brand not found' };
	}

	const deadline = chatTurnDeadline(Date.now());
	const abort = new AbortController();
	const hardStop = setTimeout(() => abort.abort(), CHAT_TURN_ABORT_MS);
	const mirror = attachDesignerStreamMirror(admin, jobId);
	let continued = false;

	try {
		await withBrandContext(brand.id, async () => {
			if (toolName === DESIGNER_TOOL_MOTION) {
				const prompt =
					String(params.prompt ?? '').trim() || designerContinuePrompt(locale, 'motion', depth);
				const selectedIds = Array.isArray(params.selectedIds)
					? params.selectedIds.filter((id): id is string => typeof id === 'string')
					: [];
				const ads = Array.isArray(params.ads) ? (params.ads as never) : [];
				const aspectRatio = parseMotionAspectRatio(params.aspectRatio);
				const duration = parseMotionDuration(params.duration);
				const reflowAspect = params.reflowAspect === true;
				let mirrored = Promise.resolve();
				const slice: DesignerSliceEnd = { finished: false, steps: 0 };
				const response = await runMotionVideoTurn({
					supabase: admin,
					userId: job.user_id,
					brand: { id: brand.id, name: brand.name as string },
					prompt: params.continuation
						? designerContinuePrompt(locale, 'motion', depth)
						: prompt,
					selectedIds,
					ads,
					aspectRatio,
					duration,
					reflowAspect,
					// La slice di continuazione scrive nello stesso thread della prima: senza,
					// `publish_artifact` smetterebbe di funzionare a metà lavoro.
					threadId: typeof params.threadId === 'string' ? params.threadId : null,
					abortSignal: abort.signal,
					deadline,
					onSaved: (id) => {
						if (!selectedIds.includes(id)) selectedIds.push(id);
					},
					onSliceEnd: (info) => {
						slice.finished = info.finished;
						slice.steps = info.steps;
					},
					consumeSseStream: ({ stream }) => {
						mirrored = mirror.consumeSseStream({ stream });
						return mirrored;
					}
				});
				await response.arrayBuffer().catch(() => {});
				await mirrored.catch(() => {});
				if (
					shouldContinueDesignerSlice({
						...mergeDesignerSliceEnd(slice, mirror.state().tools),
						timedOut: designerTurnNeedsContinuation(deadline),
						tools: mirror.state().tools
					})
				) {
					const child = await enqueueDesignerContinuation(admin, {
						brandId: brand.id,
						userId: job.user_id,
						toolName,
						parentJobId: jobId,
						inputParams: { ...params, selectedIds, origin, locale },
						origin,
						locale,
						depth
					});
					continued = !!child;
				}
			} else {
				const { clampUgcVideoCount } = await import('$lib/server/media-generator/ugc-batch');
				const videoCount = clampUgcVideoCount(params.videoCount ?? 1);
				const resumePlans = Array.isArray(params.resumePlans)
					? (params.resumePlans as UgcClipPlan[])
					: undefined;
				let mirrored = Promise.resolve();
				const response = streamUgcBatchResponse({
					supabase: admin,
					userId: job.user_id,
					brandId: brand.id,
					prompt: String(params.prompt ?? ''),
					videoCount,
					products: Array.isArray(params.products) ? (params.products as never) : [],
					models: Array.isArray(params.models) ? (params.models as never) : [],
					referenceUrls: Array.isArray(params.referenceUrls)
						? (params.referenceUrls as string[])
						: [],
					referenceVideoUrls: Array.isArray(params.referenceVideoUrls)
						? (params.referenceVideoUrls as string[])
						: [],
					firstFrameUrl: typeof params.firstFrameUrl === 'string' ? params.firstFrameUrl : null,
					lastFrameUrl: typeof params.lastFrameUrl === 'string' ? params.lastFrameUrl : null,
					referenceAudioUrls: Array.isArray(params.referenceAudioUrls)
						? (params.referenceAudioUrls as string[])
						: [],
					// La continuazione lavora nello stesso thread della prima slice: senza, il
					// produttore ripartirebbe senza sapere quali criteri gli restano aperti.
					threadId: typeof params.threadId === 'string' ? params.threadId : null,
					aspectRatio: params.aspectRatio === '16:9' ? '16:9' : '9:16',
					// Format and platform must survive the continuation: a resumed job that forgets them
					// renders the tail of the batch in a different shape than its head.
					format: isUgcFormatId(params.format) ? params.format : null,
					platform: isUgcPlatformId(params.platform) ? params.platform : null,
					useBrandStyle: params.useBrandStyle !== false,
					promptId: typeof params.promptId === 'string' ? params.promptId : null,
					videoModel: typeof params.videoModel === 'string' ? params.videoModel : null,
					abortSignal: abort.signal,
					deadline,
					locale,
					resumePlans,
					onTruncated: async (remaining) => {
						const child = await enqueueDesignerContinuation(admin, {
							brandId: brand.id,
							userId: job.user_id,
							toolName,
							parentJobId: jobId,
							inputParams: { ...params, resumePlans: remaining, origin, locale },
							origin,
							locale,
							depth
						});
						continued = !!child;
					},
					consumeSseStream: ({ stream }) => {
						mirrored = mirror.consumeSseStream({ stream });
						return mirrored;
					}
				});
				await response.arrayBuffer().catch(() => {});
				await mirrored.catch(() => {});
				if (!continued && designerTurnNeedsContinuation(deadline)) {
					const child = await enqueueDesignerContinuation(admin, {
						brandId: brand.id,
						userId: job.user_id,
						toolName,
						parentJobId: jobId,
						inputParams: { ...params, origin, locale },
						origin,
						locale,
						depth
					});
					continued = !!child;
				}
			}
		});

		// La risposta nel thread la scriveva SOLO la richiesta originale, dentro il suo
		// consumeSseStream. Un batch che supera la slice viene troncato e prosegue qui, in un'altra
		// invocazione: quella prima richiesta è già morta, quindi il thread restava col solo
		// messaggio dell'utente e tutto il lavoro — piano, tool, rese, QC — spariva dalla chat pur
		// essendo nel job. Ogni slice adesso scrive la propria parte.
		const threadId = typeof params.threadId === 'string' ? params.threadId : null;
		if (threadId) {
			await closeSurfaceTurn(
				admin,
				{ id: threadId } as never,
				{ brandId: brand.id, userId: job.user_id, state: mirror.state() }
			);
		}

		if (!continued) {
			await finishDesignerJob(admin, jobId, {
				status: 'done',
				partial: mirror.snapshot()
			});
		}
		return { processed: true, jobId };
	} catch (e) {
		const credits = e instanceof Error && e.name === 'CreditsExhaustedError';
		const msg = credits
			? 'credits_exhausted'
			: e instanceof Error
				? e.message
				: String(e);
		await finishDesignerJob(admin, jobId, {
			status: 'failed',
			error: msg.slice(0, 2000),
			partial: mirror.snapshot()
		});
		return { processed: true, jobId, error: msg };
	} finally {
		clearTimeout(hardStop);
		mirror.stopHeartbeat();
	}
}
