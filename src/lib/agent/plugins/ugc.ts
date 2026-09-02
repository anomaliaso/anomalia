/**
 * IL PLUGIN UGC — la generazione video reale che la chat già fa dentro `create_post` quando
 * `content_type` è "video": non esiste un tool `create_video` separato in `chat/tools.ts`, quel
 * ramo (submitVideoRender → enqueueVideoRender → cover come stand-in) VIVE dentro `create_post`.
 * `ugc_generate_video` avvolge esattamente quello, con `content_type` forzato a "video" e lo
 * schema ridotto ai soli campi video (presi di peso dallo schema derivato di `create_post`, mai
 * ridigitati — vedi `pickJsonSchema` in `chat-bridge.ts`).
 *
 * `ugc_list_people` / `ugc_list_talents` avvolgono `read_people` / `read_talents` as-is.
 * `ugc_review_video` avvolge il `review_video` di chat (QC Gemini su un mp4 finito).
 * `ugc_check_video` NON esiste in chat/tools.ts (il mestiere ugc non monta content_list_posts,
 * quindi non ha altro modo di rileggere un post): una lettura diretta e scoped-brand della riga,
 * che dice lo stato ONESTO — `rendering` non è un video, `video_note` spiega perché.
 *
 * Gate ereditato: il consenso AI-Act. `create_post` usa `resolvePeopleVisualRefs` (droppa in
 * silenzio i volti reali senza consenso, non rifiuta) — stesso comportamento qui, perché è lo
 * stesso codice. Non è un buco introdotto da questo plugin: è quello che `create_post` fa già.
 *
 * Namespace `ugc_*`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import { createChatTools } from '$lib/server/chat/tools';
import { execChatTool, jsonSchemaOf, pickJsonSchema, type ChatToolsRecord } from './chat-bridge';

export interface UgcPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	locale?: 'en' | 'it';
}

/** Campi video di `create_post` che `ugc_generate_video` espone — `content_type` è FORZATO, non un parametro. */
const VIDEO_FIELDS = [
	'brief',
	'platform',
	'script',
	'ugc',
	'ugc_ad',
	'video_prompt',
	'instructions',
	'video_model',
	'duration',
	'people_ids',
	'talent_ids',
	'media_ids',
	'image_urls'
];

const PASSTHROUGH: Record<string, { source: string; description: string; requiresMode?: ToolSpec['requiresMode']; effectful: boolean; consequential: boolean }> = {
	ugc_list_people: {
		source: 'read_people',
		effectful: false,
		consequential: false,
		description:
			'List brand people (real team + AI personas) with ids and signed preview URLs. Pass ids into ugc_generate_video.people_ids as face references. Real people need recorded consent (Studio → People) before their face can appear in a generated clip — this list does not show consent status, ugc_generate_video applies the gate.'
	},
	ugc_list_talents: {
		source: 'read_talents',
		effectful: false,
		consequential: false,
		description: 'List the AI talent library (global synthetic models — no consent needed, they depict nobody). Pass ids into ugc_generate_video.talent_ids as face/body references.'
	},
	ugc_refine_video: {
		source: 'refine_video',
		requiresMode: 'agent',
		effectful: true,
		consequential: true,
		description:
			"Rewrite a finished clip keeping its motion: swap the subject, change the setting, restyle it. Takes an existing video as the base (post_id or video_url) and returns a NEW video_url — the post is never modified. NOT for rewriting a spoken script or removing burned-in subtitles: those live in the audio and the pixels, and remaking the reel is ugc_generate_video. Refused when the brand has no video refine model set in Settings."
	},
	ugc_motion_control: {
		source: 'motion_control_video',
		requiresMode: 'agent',
		effectful: true,
		consequential: true,
		description:
			"Apply the MOVEMENT of a reference clip to the subject of an image. The two inputs are not interchangeable: image_url is who moves, video_url is how they move — swapping them returns a plausible wrong clip and no error. Returns a video_url and touches no post. This is NOT a motion video: those are Remotion compositions rendered from code (motion_write) and use no generative model. Refused when the brand has no video motion model set in Settings."
	},
	ugc_review_video: {
		source: 'review_video',
		effectful: true,
		requiresMode: 'plan',
		consequential: false,
		description:
			'Review a FINISHED video against organic UGC or paid-ads standards (Gemini watches the clip): hook, doomscroll stop, sound-off, hold, authenticity, CTA. Use before calling a post ready, or on a competitor URL for research. Bills credits only, never the monthly video budget.'
	}
};

function errText(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

export function createUgcPlugin(deps: UgcPluginDeps): ToolPlugin {
	const { supabase, brandId, userId, threadId, locale } = deps;
	const chatTools = createChatTools(
		supabase,
		brandId,
		'Europe/Rome',
		userId,
		'',
		locale ?? 'en',
		threadId ?? undefined
	) as ChatToolsRecord;

	const tools: ToolSpec[] = [
	{
			name: 'ugc_generate_video',
			effectful: true,
			requiresMode: 'agent',
			consequential: true,
			description:
				'Generate an AI video clip as a new post draft (UGC-style, product shot, or talking-head — the real submission path create_post uses for content_type "video"). Renders in the BACKGROUND: the result carries video_render_status ("rendering" while the clip is in flight) and video_note — call ugc_check_video with the returned post_id later, do not claim a finished video from this call alone. ugc defaults to true (handheld UGC genre, no burned-in captions) unless set false for silent/cinematic b-roll. Real people in people_ids without recorded consent are silently dropped from the reference set (server-logged), not refused.',
			inputSchema: pickJsonSchema(chatTools['create_post'], VIDEO_FIELDS, ['brief'])
		},
		...Object.entries(PASSTHROUGH).map(([name, m]) => ({
			name,
			description: m.description,
			requiresMode: m.requiresMode,
			effectful: m.effectful,
			consequential: m.consequential,
			inputSchema: jsonSchemaOf(chatTools[m.source])
		})),
		{
			name: 'ugc_check_video',
			effectful: false,
			consequential: false,
			description:
				"Check a post's real video state — the honest status ugc_generate_video points you back to. video_render_status \"rendering\" means the clip has NOT landed yet (media_url/video_thumbnail_url is still the cover frame); null/absent means the clip either finished or was never in flight — check content_type (\"generated_video\" = done) and media_url.",
			inputSchema: {
				type: 'object',
				properties: { post_id: { type: 'string', description: 'Post id returned by ugc_generate_video.' } },
				required: ['post_id']
			}
		}
	];

	async function ugcGenerateVideo(args: Record<string, unknown>, ctx: AdapterContext): Promise<ToolResult> {
		if (!args.brief || typeof args.brief !== 'string') return errText("ugc_generate_video requires 'brief'");
		const fullArgs: Record<string, unknown> = {
			...args,
			content_type: 'video',
			ugc: typeof args.ugc === 'boolean' ? args.ugc : true
		};
		return execChatTool(chatTools['create_post'], 'ugc_generate_video', fullArgs, ctx.runId, ctx.signal);
	}

	async function ugcCheckVideo(args: Record<string, unknown>): Promise<ToolResult> {
		const postId = typeof args.post_id === 'string' ? args.post_id.trim() : '';
		if (!postId) return errText("ugc_check_video requires 'post_id'");
		const { data, error } = await supabase
			.from('posts')
			.select('id, status, content_type, video_render_status, media_url, video_thumbnail_url, video_duration_seconds')
			.eq('id', postId)
			.eq('brand_id', brandId)
			.maybeSingle();
		if (error) return errText(error.message);
		if (!data) return errText(`post '${postId}' not found`);
		const rendering = data.video_render_status === 'rendering';
		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify({
						...data,
						is_video_ready: !rendering && data.content_type === 'generated_video',
						hint: rendering
							? 'Still rendering — media_url is the cover frame, not the clip. Check again later, do not re-submit.'
							: data.content_type === 'generated_video'
								? 'The clip landed — media_url is the real video.'
								: 'No clip in flight and content_type is not generated_video — the render likely fell back to a photo (video_fallback in the original ugc_generate_video result).'
					})
				}
			]
		};
	}

	return {
		name: 'ugc',
		tools,
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			switch (call.name) {
				case 'ugc_generate_video':
					return ugcGenerateVideo(call.args, ctx);
				case 'ugc_check_video':
					return ugcCheckVideo(call.args);
				default: {
					const m = PASSTHROUGH[call.name];
					if (!m) return errText(`ugc plugin: unknown tool '${call.name}'`);
					return execChatTool(chatTools[m.source], call.name, call.args, ctx.runId, ctx.signal);
				}
			}
		}
	};
}
