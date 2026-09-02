/**
 * IL PLUGIN MOTION — porta il mestiere vero (render nella VM, MP4, fotogrammi) dentro il kit.
 *
 * Riusa il percorso di produzione esistente, non lo ricostruisce:
 *  - `compileMotionSource` (motion-video/compile.ts) per il gate sugli import;
 *  - GLI STESSI controlli statici di craft che `agent.ts` fa girare a `finish` — dead entrance,
 *    movimento lineare, aritmetica della durata, fondale congelato, stasi (motion-video/easing.ts) —
 *    stesso ordine: la causa (entrata morta) prima del sintomo (stasi);
 *  - `persistCompiled` (chat/motion-video-tools.ts) per la riga in `motion_videos` — lo stesso
 *    hotlink wall e lo stesso compile di `create_motion_video`/`write_motion_source` in chat;
 *  - `renderMotionMp4` / `renderMotionStills` (server/motion-video/render-tools.ts) per la VM.
 *
 * La differenza dal percorso chat: qui non c'è un tool `finish` separato che accumula i rifiuti
 * — `motion_write` è insieme scrittura e controllo, quindi i gate girano ad ogni salvataggio
 * invece che a un passo finale. Zero storyboard-first, zero QC di craft asincrona, zero limiti
 * di budget per turno: quella coreografia vive nell'agente della chat (`output-tools.ts`) e
 * resta lì — qui c'è il render vero e basta, onesto sul suo esito.
 *
 * Namespace `motion_*`: i 12 builtin (kit/tools/builtin.ts) non hanno niente con quel prefisso.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import { compileMotionSource } from '$lib/motion-video/compile';
import {
	MOTION_EXPO_IN_OUT,
	findDeadEntrances,
	findDurationMismatch,
	findFrozenBackplate,
	findLinearMotion,
	findStaticTails,
	formatDeadEntrances,
	formatDurationMismatch,
	formatEasingViolations,
	formatFrozenBackplate,
	formatStasisViolations
} from '$lib/motion-video/easing';
import { motionMp4Scale, parseMotionMp4Quality } from '$lib/motion-video/mp4-render';
import { compactMotionPersist, persistCompiled } from '$lib/agent/tools/motion-video-tools';
import { chatTurnDeadline } from '$lib/server/chat/turn-limits';
import type { DesignerSliceEnd } from '$lib/designer-limits';
import { getMotionVideo, listMotionVideos, updateMotionPreviewUrl } from '$lib/server/motion-video/persist';
import {
	defaultStillFrames,
	framesFromSeconds,
	readSourceMeta,
	renderMotionMp4,
	renderMotionStills
} from '$lib/server/motion-video/render-tools';
import { MotionVoiceGateError } from '$lib/server/motion-video/voice-gate';
import { createChatTools } from '$lib/agent/tools/index';
import { execChatTool, jsonSchemaOf, type ChatToolsRecord } from './chat-bridge';

/** `e instanceof Error ? e.message : String(e)` a un posto solo — non vale importare gemini-audio.ts (rete, chiavi) per una riga pura. */
function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function ok(payload: Record<string, unknown>, images: Array<{ mimeType: string; base64: string }> = []): ToolResult {
	return {
		content: [
			{ type: 'text', text: JSON.stringify(payload) },
			...images.map((img) => ({ type: 'image' as const, mimeType: img.mimeType, base64: img.base64 }))
		]
	};
}

function fail(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

/**
 * GLI STESSI 5 controlli di `finish` in agent.ts, stesso ordine — vedi il commento lì per il
 * perché di quell'ordine (entrata morta prima di tutto: è la causa che produce la stasi
 * apparente, non un sintomo indipendente). Qui girano una volta per `motion_write`, non a un
 * passo finale separato: il plugin non ha un tool `finish`, quindi il salvataggio stesso è il
 * punto in cui un difetto verificabile deve fermarsi.
 */
function staticGateViolation(source: string): string | null {
	const dead = findDeadEntrances(source);
	if (dead.length) return formatDeadEntrances(dead);
	const linear = findLinearMotion(source);
	if (linear.length) {
		return [
			`Linear motion — ${formatEasingViolations(linear)}`,
			`Every interpolate needs easing: ${MOTION_EXPO_IN_OUT}.`
		].join(' ');
	}
	const arith = findDurationMismatch(source);
	if (arith) return formatDurationMismatch(arith);
	const frozen = findFrozenBackplate(source);
	if (frozen.length) return formatFrozenBackplate(frozen);
	const stalls = findStaticTails(source);
	if (stalls.length) return formatStasisViolations(stalls);
	return null;
}

export const MOTION_PLUGIN_TOOLS: ToolSpec[] = [
	{
		name: 'motion_write',
		effectful: true,
		requiresMode: 'agent',
		consequential: true,
		description: [
			'Build a kinetic motion video from a brief in prose. You do NOT write Remotion source: the motion agent does, and it is the one that carries the craft — the transition recipes, the easing rules, the reference wall, and the gates that refuse a composition written in one shot.',
			'Say what the video must do: the angle, the beats, the copy that matters, the proof, the CTA. Name products, people and features by their real names — vague in, vague out.',
			'It QUEUES the build and returns a job_id straight away — building takes minutes, so you keep working instead of waiting. Read where it got to with motion_check; the user sees it under background jobs. Pass id to keep working on an existing composition; omit it to start a new one. For a one-line surgical change to saved code, motion_edit is cheaper.'
		].join(' '),
		inputSchema: {
			type: 'object',
			properties: {
				brief: {
					type: 'string',
					description: 'What the video must say and do, in prose. Beats, copy, proof, CTA, tone.'
				},
				id: { type: 'string', description: 'Existing motion video id to keep building on. Omit to create a new one.' }
			},
			required: ['brief']
		}
	},
	{
		name: 'motion_check',
		effectful: false,
		requiresMode: 'agent',
		consequential: false,
		description: [
			'Where a queued motion build got to: its status, the tools it is running now, and what it has said so far.',
			'Do NOT poll it in a loop — check, then do other work or tell the user where it is, and come back later. A composition is still not a video when the build is done: motion_render makes the MP4.'
		].join(' '),
		inputSchema: {
			type: 'object',
			properties: { job_id: { type: 'string', description: 'The id motion_write returned.' } },
			required: ['job_id']
		}
	},
	{
		name: 'motion_edit',
		effectful: true,
		requiresMode: 'agent',
		consequential: true,
		description: [
			'The PREFERRED way to change an existing composition: targeted search-and-replace on the saved source instead of resending it whole — full motion_write with id+force stays for total rewrites only.',
			"op 'grep' lists every saved-source line containing pattern as numbered lines (plain text, case-insensitive) — run it first to find exact text.",
			"op 'replace' swaps old_string for new_string and saves through the SAME compile and craft gates as motion_write: zero matches is refused (grep first), an ambiguous match is refused with its occurrence count unless replace_all:true, and a gate violation on the RESULTING source saves nothing."
		].join(' '),
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Motion video id, from motion_write or motion_list.' },
				op: { type: 'string', enum: ['replace', 'grep'], description: "'grep' reads numbered lines, 'replace' edits and saves." },
				pattern: { type: 'string', description: "op 'grep': plain text to find, case-insensitive." },
				old_string: { type: 'string', description: "op 'replace': exact text to swap out." },
				new_string: { type: 'string', description: "op 'replace': text swapped in." },
				replace_all: { type: 'boolean', description: "op 'replace': change every occurrence instead of refusing an ambiguous match." }
			},
			required: ['id', 'op']
		}
	},
	{
		name: 'motion_render',
		effectful: true,
		requiresMode: 'agent',
		consequential: true,
		description: [
			'Render the REAL MP4 in a VM from the saved source, and attach it to the gallery as its preview.',
			'This is the only way to produce a file someone can actually watch — motion_write only saves code. Costs VM time.',
			'On failure this returns the renderer’s real error in full, never a guess.'
		].join(' '),
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Motion video id, from motion_write or motion_list.' },
				quality: { type: 'string', enum: ['2k', '4k'], description: 'Supersampling target. Default 2k.' }
			},
			required: ['id']
		}
	},
	{
		name: 'motion_stills',
		effectful: true,
		requiresMode: 'agent',
		consequential: true,
		description:
			'Render a few real frames of the saved source — cheap, no audio, no MP4 — so you can look at the composition before spending a full render. Frames come back attached as images FOR YOU, and are ALSO published as chat artifacts so the user sees them in the conversation. Do not re-publish or show_media the same frames.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: 'Motion video id, from motion_write or motion_list.' },
				frames: {
					type: 'array',
					items: { type: 'number' },
					description: 'Timestamps in seconds to render. Omit to spread frames across the clip.'
				}
			},
			required: ['id']
		}
	},
	{
		name: 'motion_list',
		effectful: false,
		consequential: false,
		description: [
			'List this brand’s motion videos — id, title, created_at/updated_at, status (rendered or source only), preview_url when it exists, and source_path. Use it to find the one to keep editing (“the one from the 4th” is a date, and the date is here), or to check what already exists before making something new.',
			'source_path is artifacts/motion/<id>.md: brand_read opens it and gives you the whole TSX plus its meta. That file is a projection of the row, so it exists the moment motion_write saves — there is no extra step. It is NOT writable: to change the code, call motion_edit (targeted search-and-replace) or motion_write with that id and a brief of what must change.'
		].join('\n'),
		inputSchema: { type: 'object', properties: {} }
	}
];

export const MOTION_AUDIO_MAP: Record<string, { source: string; description: string; effectful: boolean; consequential: boolean }> = {
	motion_voiceover: {
		source: 'generate_voiceover',
		effectful: true,
		consequential: true,
		description:
			'Record the spoken voice-over for the video: ONE take of the whole script, cut afterwards into one clip per line with motion_cut_voiceover. It is a single recording on purpose — a clip per beat gives a slightly different voice in every beat. Returns one https URL with its real duration in seconds and in frames, plus the pauses to cut at. Bills AI credits. Does NOT change the TSX.'
	},
	motion_cut_voiceover: {
		source: 'cut_voiceover',
		effectful: true,
		consequential: true,
		description:
			'Cut the take from motion_voiceover into one clip per line, at timestamps taken from its `pauses` list — never guessed. N cuts give N+1 clips, each with its real duration in seconds and frames; put each inside the <Sequence> of the beat that speaks it. Free: it slices a file that already exists. Cuts falling outside the take come back in dropped_cuts instead of silently shifting the labels.'
	},
	motion_music: {
		source: 'generate_music',
		effectful: true,
		consequential: true,
		description:
			'Generate an instrumental music bed and get back an https URL. Describe the music, not the video: tempo, instruments, mood, energy. It is a bed — it sits under the voice, it does not compete with it. The clip always comes back short: a longer composition repeats it with `loop` on the <Audio>. Bills AI credits. Does NOT change the TSX.'
	}
};

export interface MotionPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	locale?: 'en' | 'it';
	/** Tempo residuo del turno kit: senza, un render parte anche quando la function sta per morire. */
	remainingMs?: () => number;
	/** L'origine HTTP con cui si sveglia il drain: senza, un job accodato non lo esegue nessuno. */
	origin?: string;
}

export function createMotionPlugin(deps: MotionPluginDeps): ToolPlugin {
	const { supabase, brandId, userId, threadId, locale, remainingMs, origin } = deps;
	const chatTools = createChatTools(
		supabase,
		brandId,
		'Europe/Rome',
		userId,
		'',
		locale ?? 'en',
		threadId ?? undefined
	) as ChatToolsRecord;
	const audioTools: ToolSpec[] = Object.entries(MOTION_AUDIO_MAP).map(([name, m]) => ({
		name,
		description: m.description,
		effectful: m.effectful,
		consequential: m.consequential,
		inputSchema: jsonSchemaOf(chatTools[m.source])
	}));

	async function saveComposition(id: string | undefined, title: string, source: string): Promise<ToolResult> {
		try {
			compileMotionSource(source);
		} catch (e) {
			return fail(errMsg(e));
		}
		const gateMsg = staticGateViolation(source);
		if (gateMsg) return fail(gateMsg);

		const persisted = await persistCompiled(supabase, brandId, userId, { id, title, source });
		if ('error' in persisted) return fail(persisted.error);
		return ok({
			...persisted,
			hint:
				persisted.status === 'rendered'
					? 'A preview already exists for this composition — render again only after changing the source.'
					: 'Source saved. No preview exists yet: nothing to show or link. Call motion_render to produce the real MP4.'
		});
	}

	function grepLines(id: string, source: string, rawPattern: unknown): ToolResult {
		const pattern = typeof rawPattern === 'string' ? rawPattern : '';
		if (!pattern) return fail("op 'grep' requires 'pattern'");
		const needle = pattern.toLowerCase();
		const lines = source
			.split('\n')
			.map((line, i) => ({ n: i + 1, line }))
			.filter(({ line }) => line.toLowerCase().includes(needle))
			.map(({ n, line }) => `${String(n).padStart(3, ' ')}: ${line}`);
		return ok({ id, matches: lines.length, lines });
	}

	/**
	 * IL BRIEF ENTRA, LA COMPOSIZIONE ESCE.
	 *
	 * Questo tool non scrive TSX: passa il brief a `runMotionVideoTurn`, l'agente motion che ha il
	 * mestiere INTERO nel proprio system a ogni turno — craft specs, ricettario delle transizioni,
	 * muro dei riferimenti cercato prima di partire, brand brief con la tipografia risolta — e che
	 * rifiuta di chiudere una composizione scritta in una botta sola.
	 *
	 * Prima lo scriveva l'agente di chat, con sei righe di spec e il ricettario dietro un file che
	 * nessun cancello lo obbligava ad aprire. Delegare non sposta il costo di quel mestiere: lo
	 * mette dove ci sta, cioe` nel turno del sotto-agente, invece che moltiplicato per ogni step
	 * del turno di chat.
	 */
	/**
	 * IL BRIEF ENTRA, UN JOB ESCE.
	 *
	 * Costruire una composizione e` lungo per natura: un turno delegato misurato il 26/8 ci ha
	 * messo 37 minuti per UNA chiamata. Tenerci dentro l'agente significa nessun avanzamento
	 * visibile, nessun modo di intervenire, e un turno di chat che muore contro il muro mentre il
	 * lavoro e` a meta`.
	 *
	 * Quindi si ACCODA sulla macchina che la pagina usa da sempre — `designer_motion`, eseguito
	 * dal drain, con l'avanzamento scritto in diretta su `chat_jobs.partial`. L'agente riprende
	 * subito il controllo e si rilegge con `motion_check`; l'utente lo vede sotto «background
	 * job». Il mestiere non cambia: dall'altra parte gira sempre `runMotionVideoTurn`, che ha le
	 * craft specs, il ricettario e il rifiuto della one-shot.
	 */
	async function motionWrite(args: Record<string, unknown>): Promise<ToolResult> {
		const brief = typeof args.brief === 'string' ? args.brief.trim() : '';
		if (!brief) {
			return fail(
				"motion_write requires 'brief' — describe the video in prose (angle, beats, copy, proof, CTA). The motion agent writes the Remotion source."
			);
		}

		const id = typeof args.id === 'string' && args.id.trim() ? args.id.trim() : undefined;
		if (id && !(await getMotionVideo(supabase, brandId, id))) {
			return fail(`motion video '${id}' not found — call motion_list for the ids that exist`);
		}

		// Accodare senza sapere chi svegliera` il drain vuol dire promettere un lavoro che nessuno
		// eseguira`: meglio dirlo adesso che lasciarlo pendente per sempre.
		if (!origin) {
			return fail(
				'motion_write cannot queue the build: this turn has no origin to wake the job runner with. Nothing was queued — say so instead of promising a video.'
			);
		}

		const { queueDesignerJob, kickDesignerWork, DESIGNER_TOOL_MOTION } = await import(
			'$lib/server/designer-jobs'
		);
		const jobId = await queueDesignerJob(supabase, {
			brandId,
			userId,
			toolName: DESIGNER_TOOL_MOTION,
			threadId,
			inputParams: {
				prompt: brief,
				selectedIds: id ? [id] : [],
				threadId: threadId ?? null,
				origin,
				locale: locale ?? 'en'
			}
		});
		if (!jobId) return fail('could not queue the motion build — nothing is running, say so plainly');

		void kickDesignerWork(origin);

		return ok({
			status: 'queued' as const,
			job_id: jobId,
			...(id ? { video_id: id } : {}),
			building:
				'The motion agent is building this in the background. It is NOT a video yet, and there is nothing to show or link.',
			next_step: 'motion_check',
			hint: `Call motion_check with job_id "${jobId}" to see where it is. Do other work meanwhile, or tell the user it is building — do not wait in silence, and do not claim a video exists until motion_check says done and motion_render has run.`
		});
	}

	/**
	 * L'AVANZAMENTO SI LEGGE, NON SI INDOVINA. Senza questo, accodare sarebbe promettere un
	 * lavoro e non rivederlo mai: l'agente saprebbe solo di averlo ordinato.
	 */
	async function motionCheck(args: Record<string, unknown>): Promise<ToolResult> {
		const jobId = typeof args.job_id === 'string' ? args.job_id.trim() : '';
		if (!jobId) return fail("motion_check requires 'job_id', from motion_write");

		const { data } = await supabase
			.from('chat_jobs')
			.select('id, status, input_params, partial, result, error, created_at, completed_at')
			.eq('id', jobId)
			.eq('brand_id', brandId)
			.maybeSingle();
		const job = data as Record<string, unknown> | null;
		if (!job) return fail(`motion job '${jobId}' not found for this brand`);

		const partial = (job.partial ?? {}) as { text?: string; tools?: Array<{ toolName?: string; status?: string }> };
		const tools = (partial.tools ?? []).map((t) => `${t.toolName ?? '?'}:${t.status ?? '?'}`);
		const done = job.status === 'done' || job.status === 'failed';
		const videoId = (job.result as { video_id?: string } | null)?.video_id;

		return ok({
			job_id: jobId,
			status: String(job.status ?? 'unknown'),
			// La prosa del turno delegato, non il sorgente: il TSX resta dove e` stato scritto.
			progress: String(partial.text ?? '').slice(-1200),
			tools,
			...(videoId ? { video_id: videoId } : {}),
			...(job.error ? { error: String(job.error) } : {}),
			next_step: done
				? job.status === 'done'
					? 'motion_render'
					: 'report the failure to the user'
				: 'motion_check',
			hint: done
				? 'The build finished. A saved composition is still not a video: motion_render makes the MP4, and only then is there something to show.'
				: 'Still building. Do not wait in a loop: do other work or tell the user where it is, and check again later.'
		});
	}

	async function motionEdit(args: Record<string, unknown>): Promise<ToolResult> {
		const id = typeof args.id === 'string' ? args.id.trim() : '';
		if (!id) return fail("motion_edit requires 'id'");
		if (args.op !== 'grep' && args.op !== 'replace') return fail("motion_edit requires op 'grep' or 'replace'");

		const row = await getMotionVideo(supabase, brandId, id);
		if (!row) return fail(`motion video '${id}' not found — call motion_list for the ids that exist`);
		const source = String(row.source ?? '');

		if (args.op === 'grep') return grepLines(id, source, args.pattern);

		const oldString = typeof args.old_string === 'string' ? args.old_string : '';
		const newString = typeof args.new_string === 'string' ? args.new_string : '';
		if (!oldString || !newString) return fail("op 'replace' requires both 'old_string' and 'new_string'");

		const parts = source.split(oldString);
		const hits = parts.length - 1;
		if (!hits) {
			return fail(
				`old_string not found in the source of '${id}'. Run motion_edit with op:'grep' to read the exact text first.`
			);
		}
		if (hits > 1 && args.replace_all !== true) {
			return fail(`old_string matched ${hits} times — narrow it with surrounding context, or pass replace_all:true.`);
		}

		return saveComposition(id, row.title, parts.join(newString));
	}

	async function motionRender(args: Record<string, unknown>, ctx: AdapterContext): Promise<ToolResult> {
		const id = typeof args.id === 'string' ? args.id.trim() : '';
		if (!id) return fail("motion_render requires 'id'");
		const row = await getMotionVideo(supabase, brandId, id);
		if (!row) return fail(`motion video '${id}' not found — call motion_list for the ids that exist`);
		const source = String(row.source ?? '');
		if (!source.trim()) return fail('this motion video has no source yet — call motion_write first');

		const width = row.width || 1080;
		const height = row.height || 1080;
		const quality = parseMotionMp4Quality(args.quality);
		try {
			const out = await renderMotionMp4({
				supabase,
				brandId,
				userId,
				videoId: id,
				source,
				scale: motionMp4Scale(width, height, quality),
				remainingMs,
				abortSignal: ctx.signal
			});
			const saved = await updateMotionPreviewUrl(supabase, brandId, id, out.url);
			return ok({
				id,
				preview_url: out.url,
				attached_to_gallery: saved.ok,
				render_seconds: Math.round(out.seconds),
				mb: Number((out.bytes / 1_000_000).toFixed(1)),
				quality,
				hint: saved.ok
					// La frase vecchia («hand it over as media, not as a link») ha fatto SCARICARE il
					// video nella VM per «consegnarlo»: nasceva una copia orfana, senza id né
					// sorgente. L'istruzione ora è operativa e nomina il tool e l'argomento.
					? `Attach it to the chat with attach({ path: "<preview_url>" }) — pass the URL as it is, never download it first: a downloaded copy loses the id and the source.`
					: 'The file rendered but could not be attached to the gallery row — say so, and hand the clip over as media anyway.'
			});
		} catch (e) {
			// L'errore VERO del renderer, intero — mai una versione riassunta o indovinata.
			if (e instanceof MotionVoiceGateError) {
				return fail(`${e.message} — ${e.remedy}`);
			}
			return fail(errMsg(e));
		}
	}

	async function motionStills(args: Record<string, unknown>, ctx: AdapterContext, toolCallId?: string): Promise<ToolResult> {
		const id = typeof args.id === 'string' ? args.id.trim() : '';
		if (!id) return fail("motion_stills requires 'id'");
		const row = await getMotionVideo(supabase, brandId, id);
		if (!row) return fail(`motion video '${id}' not found — call motion_list for the ids that exist`);
		const source = String(row.source ?? '');
		if (!source.trim()) return fail('this motion video has no source yet — call motion_write first');

		const meta = readSourceMeta(source, {
			fps: row.fps || 30,
			durationInFrames: row.duration_in_frames || 180
		});
		const rawFrames = Array.isArray(args.frames)
			? (args.frames as unknown[]).filter((n): n is number => typeof n === 'number')
			: [];
		const frames = rawFrames.length
			? framesFromSeconds(rawFrames, meta.fps, meta.durationInFrames)
			: defaultStillFrames(meta.durationInFrames, 4);

		try {
			const { rendered, failures } = await renderMotionStills({
				brandId,
				userId,
				source,
				frames,
				remainingMs,
				abortSignal: ctx.signal
			});
			const images = rendered.map((r) => ({ mimeType: 'image/png', base64: r.png.toString('base64') }));
			const { publishMotionStillArtifacts } = await import('$lib/server/motion-video/still-artifacts');
			const artifacts = await publishMotionStillArtifacts({
				supabase,
				brandId,
				userId,
				threadId,
				toolCallId: toolCallId ?? null,
				title: String(row.title ?? 'Motion video'),
				frames: rendered
			});
			return ok(
				{
					id,
					rendered_frames: rendered.map((r) => r.frame),
					...(failures.length ? { failed_frames: failures } : {}),
					did_not_change_source: true,
					shown_in_chat: artifacts.length > 0,
					artifacts: artifacts.map((a) => ({ id: a.id, url: a.url, title: a.title })),
					media: artifacts
						.filter((a): a is typeof a & { url: string } => typeof a.url === 'string' && !!a.url)
						.map((a) => ({ url: a.url, caption: a.title })),
					hint: artifacts.length
						? 'The frames are already visible in the chat as artifacts. Look at them yourself, then answer. Do not re-publish or show_media the same frames.'
						: 'Look at the frames attached to this result. They could not be published into the chat — say so if the user needed to see them.'
				},
				images
			);
		} catch (e) {
			return fail(errMsg(e));
		}
	}

	async function motionList(): Promise<ToolResult> {
		const videos = await listMotionVideos(supabase, brandId);
		return ok({
			videos: videos.map((v) => ({
				id: v.id,
				title: v.title,
				created_at: v.created_at,
				updated_at: v.updated_at,
				status: v.preview_url ? ('rendered' as const) : ('source_saved_not_rendered' as const),
				preview_url: v.preview_url ?? null,
				source_path: `artifacts/motion/${v.id}.md`
			}))
		});
	}

	return {
		name: 'motion',
		tools: [...MOTION_PLUGIN_TOOLS, ...audioTools],
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			const audio = MOTION_AUDIO_MAP[call.name];
			if (audio) return execChatTool(chatTools[audio.source], call.name, call.args, ctx.runId, ctx.signal);
			switch (call.name) {
				case 'motion_write':
					return motionWrite(call.args);
				case 'motion_check':
					return motionCheck(call.args);
				case 'motion_edit':
					return motionEdit(call.args);
				case 'motion_render':
					return motionRender(call.args, ctx);
				case 'motion_stills':
					return motionStills(call.args, ctx, call.id);
				case 'motion_list':
					return motionList();
				default:
					return fail(`motion plugin: unknown tool '${call.name}'`);
			}
		}
	};
}
