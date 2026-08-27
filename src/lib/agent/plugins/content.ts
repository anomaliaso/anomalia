/**
 * IL PLUGIN CONTENT — dà al Content Creator (i 14 primitivi soli producono zero) la strada VERA
 * con cui la chat crea post: gli stessi `create_post` / `design_graphic` / `generate_image` /
 * `approve_post` / `read_posts` di `chat/tools.ts`, avvolti da `chat-bridge.ts` (vedi lì per il
 * perché: `tool()` è un'identità, quindi lo stesso schema Zod e la stessa `execute` di sempre).
 *
 * Gate ereditati, non riscritti:
 *  - crediti/quota: dentro `create_post`/`generate_image` (`remaining`/`creditsExhaustedResult`);
 *  - "un post senza media non si approva": `approve_post` → `publishApprovedPost` → il prepublish
 *    gate in `publish.ts` (`requiresVisualMedia`) — è la stessa approvazione della chat, non una
 *    copia;
 *  - consenso AI-Act sulle persone reali: `create_post`/`design_graphic` usano
 *    `resolvePeopleVisualRefs` (droppa in silenzio, logga), `generate_image` usa la variante
 *    `…Detailed` che RIFIUTA — la differenza è nel codice vero, quindi resta anche qui.
 *
 * Namespace `content_*`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdapterContext, ToolCall, ToolPlugin, ToolResult, ToolSpec } from '../kit';
import { createChatTools } from '$lib/server/chat/tools';
import { execChatTool, jsonSchemaOf, type ChatToolsRecord } from './chat-bridge';

export interface ContentPluginDeps {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
	threadId?: string | null;
	locale?: 'en' | 'it';
}

/** Nome nel kit → tool reale in `createChatTools` (stesso schema, stessa execute, stessi gate). */
const MAP: Record<string, { source: string; description: string; requiresMode?: ToolSpec['requiresMode'] }> = {
	content_create_post: {
		source: 'create_post',
		requiresMode: 'agent',
		description:
			'Create a social post (caption + visual) as a pending_user draft — image, carousel, or video. MEDIA FIRST: pass media_ids to reuse a library asset instead of minting a new AI image (free). content_type "video" submits the clip in the BACKGROUND and ships the QC\'d cover as a stand-in — the result carries video_render_status/video_note honestly, never claims a finished video that has not landed. Real people in people_ids without recorded consent are silently DROPPED from the visual (server-logged, not refused) — content_generate_image refuses instead. Runs out of AI credits or monthly post quota → an error naming which, not a retry loop. Naming a `platform` the brand has NOT connected is REFUSED before any generation (error platform_not_connected, nothing spent) — tell the user to connect it, or pass allow_unconnected if they want a draft anyway.'
	},
	content_design_graphic: {
		source: 'design_graphic',
		requiresMode: 'agent',
		description:
			"Compose or revise a post's typographic graphic (words on a brand-coloured canvas, optional embedded photos) as HTML/TSX, via the same composer + render gate the post editor uses. Needs an existing post_id — create the post first. Real people without recorded consent are silently dropped from the canvas (same as content_create_post, not a refusal)."
	},
	content_generate_image: {
		source: 'generate_image',
		requiresMode: 'agent',
		description:
			'Mint or edit an AI photo (Nano Banana). Standalone (no post_id): returns image_url, does not touch a post. With post_id on an ai_generated post: regenerates that image using the prompt as feedback. Real people in people_ids/talent_ids without recorded consent make this REFUSE outright (AI Act gate, error names who is blocked) — unlike content_create_post. Reference images are capped by the renderer\'s real input limit; past it, extras are dropped oldest-priority-last, never an error.'
	},
	content_schedule: {
		source: 'approve_post',
		requiresMode: 'agent',
		description:
			"Approve a pending_user draft and schedule it for publishing (Zernio). The prepublish gate REFUSES a post with no image/video — a visual post cannot go out empty — and refuses while a video render for it is still in flight. Only approved/pending_user posts qualify; omit scheduled_for to keep the post's existing slot. With no connected account for the post's platform the result is success:false + noAccount:true: the post stays approved and does NOT go out — say so, never call it scheduled."
	},
	content_update_post: {
		source: 'update_post',
		description:
			"Edit an existing post in place: caption, first comment, platform(s), pillar, slot. Only the fields passed change. On an already-scheduled post the old Zernio schedule is cancelled and the post re-sent, so the published copy stays in sync with the row — the result says so with rescheduled: true. To move the time use content_reschedule_post; to add a platform use content_cross_post."
	},
	content_reschedule_post: {
		source: 'reschedule_post',
		description:
			"Move an approved or scheduled post to a new time (brand timezone). REFUSED on a pending_user draft — rescheduling one would publish it without approval; approve it with content_schedule instead. The old Zernio schedule is cancelled before the new one is sent, so a moved post never goes out twice."
	},
	content_cross_post: {
		source: 'cross_post',
		description:
			"Add platforms to an existing post. pending_user: the platform list is widened on the draft. scheduled: the schedule is cancelled and re-sent with the wider list. published: a CLONE is created for the new platforms only — the live post is never touched. Refused when the post already covers every platform asked for."
	},
	content_list_posts: {
		source: 'read_posts',
		description:
			'List brand posts, optionally filtered by status (pending_user/approved/scheduled/published/failed). Each post carries media_origin (typographic_graphic/ai_generated/user_uploaded/video/none) and, when reviewed, a media_review verdict (ship/fix/kill) — honor fix/kill, do not approve as-is.'
	}
};

export function createContentPlugin(deps: ContentPluginDeps): ToolPlugin {
	const { supabase, brandId, userId, threadId, locale } = deps;
	// Stessa costruzione di motion-video/agent.ts per un mestiere fuori dalla chat: tz fisso
	// (ogni tool rilegge brands.timezone da sé, tz qui è solo il fallback), locale dal run.
	const chatTools = createChatTools(
		supabase,
		brandId,
		'Europe/Rome',
		userId,
		'',
		locale ?? 'it',
		threadId ?? undefined
	) as ChatToolsRecord;

	const tools: ToolSpec[] = Object.entries(MAP).map(([name, m]) => ({
		name,
		description: m.description,
		requiresMode: m.requiresMode,
		inputSchema: jsonSchemaOf(chatTools[m.source])
	}));

	return {
		name: 'content',
		tools,
		async execute(call: ToolCall, ctx: AdapterContext): Promise<ToolResult> {
			const m = MAP[call.name];
			if (!m) return { content: [{ type: 'text', text: `content plugin: unknown tool '${call.name}'` }], isError: true };
			return execChatTool(chatTools[m.source], call.name, call.args, ctx.runId, ctx.signal);
		}
	};
}
