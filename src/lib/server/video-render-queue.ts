/**
 * Out-of-band clip renders.
 *
 * Submitting to kie returns a task id and nothing else is needed: the job lives on kie's side and
 * its result stays fetchable from any process, forever. So instead of holding an invocation open
 * to watch it — which is what made clip generation the longest thing in this codebase, and what
 * capped every clip at POLL_TIMEOUT_MS regardless of what it actually needed — the task id is
 * written down and a cron picks the result up whenever it lands.
 *
 * The practical consequence: a render is no longer limited by anything on our side. A clip that
 * takes twenty minutes finishes; before, one that took over ten could not finish at all.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	finishVideoRender,
	type RenderVideoOpts,
	type SubmittedVideoRender,
	type VideoPersistOpts
} from '$lib/server/video';
import { withBrandContext } from '$lib/server/ai-log';

/** Give up on a task kie never resolves. Generous: each check costs one cheap HTTP call. */
export const VIDEO_RENDER_MAX_AGE_MS = 60 * 60_000;
/**
 * A claim older than this belonged to a process that died mid-finish.
 *
 * Must exceed the reconciler route's own maxDuration (300s), or a tick still legitimately working
 * gets its claim swept by the next tick and the non-idempotent half — downloading the mp4 and
 * billing kie's charge — runs twice.
 */
export const VIDEO_RENDER_CLAIM_STALE_MS = 15 * 60_000;
/**
 * Stop retrying a render that keeps throwing. Age alone is not enough: a row that fails in
 * persistMp4 comes straight back to a per-minute cron, so without a count it burns sixty attempts
 * inside the age window — and every one of them is a download from kie.
 *
 * Counts FAILURES only, never the "kie is still working" checks. Counting those would make this a
 * second, far tighter deadline than VIDEO_RENDER_MAX_AGE_MS: at one tick a minute, eight checks is
 * eight minutes, so every clip needing longer would be declared dead while kie rendered and billed
 * it — defeating the entire point of moving the render out-of-band.
 */
export const VIDEO_RENDER_MAX_ATTEMPTS = 8;

export type VideoRenderRow = {
	id: string;
	brand_id: string;
	user_id: string;
	post_id: string | null;
	thread_id: string | null;
	task_id: string;
	model: string;
	status: string;
	duration_seconds: number | null;
	resolution: string | null;
	cover_url: string | null;
	prompt: string | null;
	persist_opts: VideoPersistOpts;
	submitted_at: string;
	attempts: number;
	/** Last failure seen, kept so giving up can say what kept going wrong. */
	error: string | null;
};

/** Write the handle down. Everything after this can happen in another process, later. */
export async function enqueueVideoRender(
	admin: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		postId?: string | null;
		threadId?: string | null;
		submitted: SubmittedVideoRender;
	}
): Promise<string | null> {
	const { submitted } = opts;
	const { data, error } = await admin
		.from('video_renders')
		.insert({
			brand_id: opts.brandId,
			user_id: opts.userId,
			post_id: opts.postId ?? null,
			thread_id: opts.threadId ?? null,
			task_id: submitted.taskId,
			model: submitted.model,
			prompt: submitted.prompt,
			duration_seconds: submitted.durationSeconds,
			resolution: submitted.resolution,
			cover_url: submitted.coverUrl ?? null,
			persist_opts: submitted.persistOpts,
			submitted_at: new Date(submitted.submittedAt).toISOString()
		})
		.select('id')
		.maybeSingle();

	if (error) {
		console.error('[video-render] enqueue failed:', error.message);
		return null;
	}
	return (data?.id as string) ?? null;
}

/**
 * Submit a clip and record the handle in one step — the pair every caller needs, kept together so
 * nobody can do the first without the second. A submitted render whose id was never written down
 * is the exact failure this whole table exists to prevent: kie renders it, charges for it, and no
 * process on our side knows it happened.
 *
 * Returns the submission so the caller can write duration/resolution onto its own row, or null if
 * kie refused the job — in which case the caller falls back to shipping the cover, as before.
 */
export async function submitAndTrackVideoRender(opts: {
	admin: SupabaseClient;
	brandId: string;
	userId: string;
	postId?: string | null;
	threadId?: string | null;
	imagePrompt: string;
	render: RenderVideoOpts;
}): Promise<SubmittedVideoRender | null> {
	const { submitVideoRender } = await import('$lib/server/video');
	const submitted = await submitVideoRender(opts.imagePrompt, opts.render).catch((e) => {
		// CreditsExhaustedError must reach the caller — it is a message for the user, not a failure
		// to swallow into a silent photo fallback.
		if (e instanceof Error && e.name === 'CreditsExhaustedError') throw e;
		console.error('[video-render] submit failed:', e instanceof Error ? e.message : e);
		return undefined;
	});
	if (!submitted) return null;

	const id = await enqueueVideoRender(opts.admin, {
		brandId: opts.brandId,
		userId: opts.userId,
		postId: opts.postId ?? null,
		threadId: opts.threadId ?? null,
		submitted
	});
	if (!id) {
		// kie is rendering something nobody will collect. Say so loudly: it is billable work lost.
		console.error(`[video-render] submitted task ${submitted.taskId} but could not record it`);
		return null;
	}
	return submitted;
}

/**
 * Renders this brand has in flight, so a quota gate can see them.
 *
 * The monthly video count is only charged when a clip LANDS — charging at submit would let a run of
 * rejected renders eat the month. But that leaves a window where usage says zero and N submissions
 * have already happened, so a one-video allowance can be spent many times over. Callers must gate
 * on remaining budget MINUS this.
 */
export async function countOutstandingVideoRenders(
	admin: SupabaseClient,
	brandId: string
): Promise<number> {
	const { count, error } = await admin
		.from('video_renders')
		.select('id', { count: 'exact', head: true })
		.eq('brand_id', brandId)
		.in('status', ['rendering', 'finishing']);
	// Fail closed on error: treating an unknown number of in-flight renders as zero is exactly the
	// over-spend this function exists to prevent.
	if (error) {
		console.error('[video-render] outstanding count failed:', error.message);
		return Number.MAX_SAFE_INTEGER;
	}
	return count ?? 0;
}

function rowToSubmitted(row: VideoRenderRow): SubmittedVideoRender {
	return {
		taskId: row.task_id,
		model: row.model,
		prompt: row.prompt ?? '',
		durationSeconds: row.duration_seconds ?? 0,
		resolution: row.resolution ?? '480p',
		coverUrl: row.cover_url ?? undefined,
		persistOpts: (row.persist_opts ?? { captions: false, tighten: false }) as VideoPersistOpts,
		submittedAt: Date.parse(row.submitted_at) || Date.now()
	};
}

/**
 * Release claims whose holder died. Without this a process killed between claiming and finishing
 * strands the render at `finishing` forever — the clip exists on kie and nobody ever collects it.
 */
async function releaseStaleClaims(admin: SupabaseClient): Promise<void> {
	await admin
		.from('video_renders')
		.update({ status: 'rendering', claimed_at: null })
		.eq('status', 'finishing')
		.lt('claimed_at', new Date(Date.now() - VIDEO_RENDER_CLAIM_STALE_MS).toISOString())
		.then(undefined, () => {});
}

async function settle(
	admin: SupabaseClient,
	row: VideoRenderRow,
	patch: Record<string, unknown>
): Promise<void> {
	await admin
		.from('video_renders')
		.update({ ...patch, completed_at: new Date().toISOString() })
		.eq('id', row.id)
		.then(undefined, () => {});
}

/**
 * Attach the finished clip to its post, replacing the cover that stood in for it.
 *
 * Returns whether it worked, and the caller only settles the render `done` once it has: a render
 * marked done whose post never got the url is a clip that exists, is paid for, and is reachable by
 * nothing — and no query in this module looks at `done` rows again.
 */
async function applyToPost(
	admin: SupabaseClient,
	row: VideoRenderRow,
	url: string,
	thumbnailUrl?: string
): Promise<boolean> {
	if (!row.post_id) return true;
	// `.select('id')` so a zero-row match is visible: an UPDATE that hits nothing reports no error,
	// so without this an orphaned render — post insert rolled back, post since deleted — would be
	// billed, settled `done`, and reported to the user as attached to a post that does not exist.
	const { data: touched, error } = await admin
		.from('posts')
		.update({
			media_url: url,
			content_type: 'generated_video',
			// Set here, with media_url and content_type, so a post is never labelled a reel while
			// its media is still a still frame.
			format: 'video',
			video_task_id: row.task_id,
			video_resolution: row.resolution,
			video_duration_seconds: row.duration_seconds,
			video_render_status: 'done',
			...(thumbnailUrl ? { video_thumbnail_url: thumbnailUrl } : {})
		})
		.eq('id', row.post_id)
		.select('id');
	if (error) {
		console.error(`[video-render] could not attach clip to post ${row.post_id}:`, error.message);
		return false;
	}
	if (!touched?.length) {
		// Nothing to attach to and nothing to retry — the clip is stored, but its post is gone.
		console.error(`[video-render] post ${row.post_id} no longer exists; clip ${url} is orphaned`);
		return false;
	}

	// Only a clip that actually landed consumes the brand's monthly video budget. Charging at
	// submit time — as the callers used to, because that was when a clip existed — would let ten
	// rejected renders eat a month's headroom.
	try {
		const { addUsage, monthKey } = await import('$lib/server/usage');
		const { data: brand } = await admin
			.from('brands')
			.select('timezone')
			.eq('id', row.brand_id)
			.maybeSingle();
		await addUsage(admin, row.brand_id, monthKey((brand?.timezone as string) ?? 'Europe/Rome'), {
			videos: 1
		});
	} catch (e) {
		console.error('[video-render] usage accounting failed:', e);
	}

	return true;
}

/**
 * Tell the assistant its clip landed — a real turn, not a canned line written into the transcript
 * as if it had said it. The agent runs with the result in front of it, so it can relate the clip
 * to whatever the user actually asked for and carry on from there.
 */
async function notifyThread(
	admin: SupabaseClient,
	row: VideoRenderRow,
	outcome: string,
	origin: string
) {
	if (!row.thread_id) return;
	try {
		const { data: thread } = await admin
			.from('chat_threads')
			.select('post_id')
			.eq('id', row.thread_id)
			.maybeSingle();
		const { data: brand } = await admin
			.from('brands')
			.select('slug')
			.eq('id', row.brand_id)
			.maybeSingle();
		const slug = (brand?.slug as string) ?? '';
		const postScoped = !!(thread as { post_id?: string | null } | null)?.post_id;

		// A post-scoped editor thread is not a place to run the brand agent: it is a narrow
		// conversation about one post, hidden from the sidebar, and a queued chat_response there
		// would drop the full generalist agent into it and link the user to a thread they cannot
		// find. The card's own chip already reports the render, so the user just gets a push.
		if (postScoped) {
			const { sendPushToUser } = await import('$lib/server/web-push');
			await sendPushToUser(admin, row.user_id, {
				title: 'Anomalia',
				body: `Video: ${outcome}`,
				url: slug && row.post_id ? `/app/${slug}/content/${row.post_id}` : '/',
				tag: `video-render-${row.id}`,
				skipIfFocused: true
			});
			return;
		}

		const { enqueueQueuedChatTurn, kickChatQueueWork } = await import('$lib/server/chat/queue');
		await enqueueQueuedChatTurn(admin, {
			brandId: row.brand_id,
			userId: row.user_id,
			threadId: row.thread_id,
			userMessage: `[background] The video render you started has finished: ${outcome}. Report it to the user in one short line, referring to what they originally asked for. Do not re-run the render.`,
			// La nota `[background]` è per il MODELLO: inglese a prescindere. Il locale del job qui
			// sotto pilota le notice visibili della coda — e nessun profilo reale è in mano a questo
			// sweep: niente locale significa notice inglesi per tutti (il vecchio hardcoded 'it'
			// avrebbe parlato italiano con chiunque). La coda rifiuta stringhe vuote: 'en' esplicito.
			locale: 'en',
			origin,
			continuation: true
		});
		// Without the kick the reply waits for the */2 drain — minutes of silence after the clip is
		// already there. The queue picks it up either way; this just makes it prompt.
		if (origin) void kickChatQueueWork(origin);
	} catch (e) {
		console.error('[video-render] thread notify failed:', e);
	}
}

/**
 * One pass: check every outstanding render once and finish whichever kie has completed.
 *
 * No loop, no sleep, no per-render budget — a tick is a handful of HTTP calls, which is exactly
 * why the give-up window can be an hour instead of ten minutes.
 */
export async function reconcileVideoRenders(
	admin: SupabaseClient,
	opts: { limit?: number; origin?: string } = {}
): Promise<{ checked: number; done: number; failed: number; expired: number }> {
	// Used to build the links in notifications and to kick the chat queue, so a landed clip is
	// reported in seconds rather than whenever the */2 drain next runs.
	const origin = opts.origin ?? '';
	await releaseStaleClaims(admin);

	const { data: rows } = await admin
		.from('video_renders')
		.select(
			'id, brand_id, user_id, post_id, thread_id, task_id, model, status, duration_seconds, resolution, cover_url, prompt, persist_opts, submitted_at, attempts, error'
		)
		.eq('status', 'rendering')
		.order('submitted_at', { ascending: true })
		.limit(opts.limit ?? 20);

	let checked = 0;
	let done = 0;
	let failed = 0;
	let expired = 0;

	for (const raw of (rows ?? []) as VideoRenderRow[]) {
		const age = Date.now() - (Date.parse(raw.submitted_at) || Date.now());
		const exhausted = raw.attempts >= VIDEO_RENDER_MAX_ATTEMPTS;
		if (age > VIDEO_RENDER_MAX_AGE_MS || exhausted) {
			const why = exhausted
				? `gave up after ${raw.attempts} attempts (${raw.error ?? 'repeated failures'})`
				: 'kie never resolved this task';
			await settle(admin, raw, { status: 'expired', error: why });
			if (raw.post_id) {
				await admin
					.from('posts')
					.update({ video_render_status: 'failed' })
					.eq('id', raw.post_id)
					.then(undefined, () => {});
			}
			// Told, like every other outcome. This is the slowest one to detect — up to an hour —
			// so silence here is the longest a user can be left expecting a clip that is not coming.
			await notifyThread(admin, raw, `it did not complete — ${why}`, origin);
			expired += 1;
			continue;
		}

		// Claim before doing anything non-idempotent: persistMp4 writes a file and the billing call
		// charges the brand, and two overlapping ticks must not do either twice.
		// Note: attempts is NOT bumped here. Most claims are "is it done yet?" checks against a
		// perfectly healthy render, and counting those turns the retry cap into a deadline of
		// MAX_ATTEMPTS minutes. Only real failures below increment it.
		const { data: claimed } = await admin
			.from('video_renders')
			.update({ status: 'finishing', claimed_at: new Date().toISOString() })
			.eq('id', raw.id)
			.eq('status', 'rendering')
			.select('id')
			.maybeSingle();
		if (!claimed) continue;

		checked += 1;
		try {
			// Brand scope so the billing inside finishVideoRender lands on the right ledger — the
			// AsyncLocalStorage context every other AI entry point establishes.
			const outcome = await withBrandContext(raw.brand_id, () =>
				finishVideoRender(admin, raw.user_id, rowToSubmitted(raw))
			);

			if (outcome.status === 'pending') {
				// Not ready: hand it straight back so the next tick sees it.
				await admin
					.from('video_renders')
					.update({ status: 'rendering', claimed_at: null })
					.eq('id', raw.id)
					.then(undefined, () => {});
				continue;
			}

			if (outcome.status === 'failed') {
				await settle(admin, raw, { status: 'failed', error: outcome.error.slice(0, 2000) });
				if (raw.post_id) {
					await admin
						.from('posts')
						.update({ video_render_status: 'failed' })
						.eq('id', raw.post_id)
						.then(undefined, () => {});
				}
				await notifyThread(admin, raw, `it failed (${outcome.error})`, origin);
				failed += 1;
				continue;
			}

			// Post first, settle second. Settling `done` before the post has the url strands a paid
			// clip nowhere: nothing re-reads a done row. If the post write fails the row goes back
			// to the queue, where the attempt cap eventually stops it.
			const attached = await applyToPost(admin, raw, outcome.url, outcome.thumbnailUrl);
			if (!attached) {
				await admin
					.from('video_renders')
					.update({
						status: 'rendering',
						claimed_at: null,
						attempts: raw.attempts + 1,
						media_url: outcome.url,
						error: 'clip stored but the post could not be updated'
					})
					.eq('id', raw.id)
					.then(undefined, () => {});
				continue;
			}
			await settle(admin, raw, { status: 'done', media_url: outcome.url });
			await notifyThread(admin, raw, "the clip is ready and attached to the post", origin);
			done += 1;
		} catch (e) {
			// Unknown failure: give the row back rather than burying it. The age check above is what
			// stops a permanently broken task from being retried forever.
			const message = e instanceof Error ? e.message : String(e);
			console.error(`[video-render] reconcile failed id=${raw.id}:`, message);
			await admin
				.from('video_renders')
				.update({
					status: 'rendering',
					claimed_at: null,
					attempts: raw.attempts + 1,
					error: message.slice(0, 2000)
				})
				.eq('id', raw.id)
				.then(undefined, () => {});
		}
	}

	return { checked, done, failed, expired };
}
