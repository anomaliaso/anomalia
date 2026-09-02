/**
 * I due tool che partono da un video gia' esistente, dichiarati UNA volta e montati da ogni
 * mestiere che tocca video.
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
	refine_video: {
		source: 'refine_video',
		requiresMode: 'agent',
		effectful: true,
		consequential: true,
		description:
			"Rewrite a finished clip keeping its motion and camera: swap the subject, change the setting, restyle it. Takes an existing video as the base (post_id or video_url) and returns a NEW video_url — the post is never modified. NOT for rewriting a spoken script or removing burned-in subtitles: those live in the audio and the pixels, and remaking the reel is the video path of content_create_post / ugc_generate_video. Refused when the brand has no video refine model set in Settings, naming the empty setting instead of falling back."
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
