/**
 * I tool sui media che non appartengono a un mestiere solo, dichiarati UNA volta e montati da ogni
 * mestiere che tocca immagini o video.
 *
 * Non appartengono a un mestiere solo: chi crea un post video (`content`) e chi gira una clip
 * (`ugc`) hanno entrambi motivo di rifinirla o di applicarle un movimento. Copiare le due righe
 * nei due plugin sarebbe stato piu' corto oggi e divergente al primo cambio di descrizione.
 *
 * I nomi sono IDENTICI a quelli della chat, come `search_knowledge` e `message_agent`: il prefisso
 * di mestiere serve a dire a chi appartiene un tool, e questi non appartengono a nessuno.
 */
import type { ToolSpec } from '../kit';

export type PassthroughSpec = {
	source: string;
	description: string;
	requiresMode?: ToolSpec['requiresMode'];
	effectful: boolean;
	consequential: boolean;
};

export const MEDIA_TRANSFORM_TOOLS: Record<string, PassthroughSpec> = {
	generate_video: {
		source: 'generate_video',
		requiresMode: 'agent',
		effectful: true,
		consequential: true,
		description:
			"Generate a video from a brief with NO post: the clip lands in the brand Media library and you get a media_id. Rendering takes minutes, so it QUEUES and returns a job_id — read it with check_job_status, never poll in a loop. Publish it afterwards with create_post_from_asset(type:\"video\"). For a clip that IS a post from the start, content_create_post(content_type:\"video\") is one step instead of two. Bills the video budget."
	},
	read_media: {
		source: 'read_media',
		effectful: false,
		consequential: false,
		description:
			"List and search the brand's uploaded Media library — ids, what each asset shows, and how often it has been used. This is where media_ids come from: every tool here that composes a visual takes them, and reusing an asset the brand already owns costs nothing while generating a new one is billed. Call it BEFORE minting a photo, and prefer assets that are unused or least recently used over the same one every time."
	},
	use_library_image: {
		source: 'use_library_image',
		effectful: false,
		consequential: false,
		description:
			"Turn a library asset id into a durable https url you can paste into graphic HTML/TSX or a Remotion composition. read_media gives you the id; this gives you a url that outlives the turn. Prefer it over generating a new photo whenever read_media found one that fits."
	},
	refine_video: {
		source: 'refine_video',
		requiresMode: 'agent',
		effectful: true,
		consequential: true,
		description:
			"Rewrite a finished clip keeping its motion and camera: swap the subject, change the setting, restyle it. Takes an existing video as the base (post_id or video_url) and returns a NEW video_url — the post is never modified. NOT for rewriting a spoken script or removing burned-in subtitles: those live in the audio and the pixels, and remaking the reel is the video path of content_create_post / ugc_generate_video. Refused when the brand has no video refine model set in Settings, naming the empty setting instead of falling back."
	},
	create_post_from_asset: {
		source: 'create_post_from_asset',
		requiresMode: 'agent',
		effectful: true,
		consequential: true,
		description:
			"Turn media that ALREADY EXISTS into a post draft: a clip from refine_video / motion_control_video, or anything in the brand Media library (read_media for the ids). Generating and posting are two steps on purpose — a post that fails to write does not cost the render twice, and nothing is minted behind your back. type \"video\" takes one clip, \"image\" one photo, \"carousel\" two or more in slide order. A typographic graphic is NOT an asset — it is editable source, so it stays on content_create_post(graphic_brief) / content_design_graphic. Spends no credits."
	},
	motion_control_video: {
		source: 'motion_control_video',
		requiresMode: 'agent',
		effectful: true,
		consequential: true,
		description:
			"Apply the MOVEMENT of a reference clip to the subject of an image. The two inputs are not interchangeable: image_url is who moves, video_url is how they move — swapping them returns a plausible wrong clip and no error to catch it. Returns a video_url and touches no post. This is NOT a motion video: those are Remotion compositions rendered from code (motion_write) and use no generative model. Refused when the brand has no video motion model set in Settings."
	}
};
