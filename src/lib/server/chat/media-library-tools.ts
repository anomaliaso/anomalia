import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	copyLibraryImageToPublicUrl,
	listMediaForAgent,
	USE_LIBRARY_IMAGE_HINT
} from '$lib/server/brand-media';

/** Shared Media library tools: list/search uploaded assets, then mint a durable https URL to embed. */
export function createMediaLibraryTools(opts: {
	supabase: SupabaseClient;
	brandId: string;
	userId: string;
}) {
	const { supabase, brandId, userId } = opts;
	return {
		read_media: tool({
			description: [
				'Search the brand Media library (uploaded images/videos with AI catalog: description, tags, subjects, when/how/where to use).',
				'Call BEFORE generate_image / create_post / design_graphic / motion stills. Prefer catalog_status=ready images.',
				'If an asset fits: reuse it (use_library_image for a durable URL, or media_ids on create_post / design_graphic). When several fit, prefer unused or least-recently-used (times_used / last_used_at). generate_image only when nothing fits.'
			].join(' '),
			inputSchema: z.object({
				query: z
					.string()
					.optional()
					.describe('Search title, description, tags, subjects, usage fields (e.g. "product hero", "team photo", "logo")'),
				kind: z
					.enum(['image', 'video'])
					.optional()
					.describe('Filter by media kind (default: all; prefer image for feed posts / graphics / motion stills)'),
				status: z
					.enum(['pending', 'ready', 'failed'])
					.optional()
					.describe('Filter by catalog status (prefer ready)'),
				limit: z.number().min(1).max(50).optional().describe('Max rows (default 30)')
			}),
			execute: async ({
				query,
				kind,
				status,
				limit
			}: {
				query?: string;
				kind?: 'image' | 'video';
				status?: 'pending' | 'ready' | 'failed';
				limit?: number;
			}) => listMediaForAgent(supabase, brandId, { query, kind, status, limit })
		}),

		use_library_image: tool({
			description: [
				'Copy a Media library IMAGE into a durable public https URL for embedding.',
				'Does NOT bill credits and does NOT change the post or Remotion file.',
				'Then replace_source / replace_motion_source: <img src="https://..."> or <Img src="https://..." />.',
				'Prefer this over generate_image when read_media found a suitable uploaded photo.'
			].join(' '),
			inputSchema: z.object({
				media_id: z.string().describe('brand_media id from read_media / MEDIA LIBRARY')
			}),
			execute: async ({ media_id }: { media_id: string }) => {
				const copied = await copyLibraryImageToPublicUrl(supabase, {
					brandId,
					userId,
					mediaId: media_id
				});
				if ('error' in copied) return copied;
				return {
					success: true,
					...copied,
					from_library: true,
					did_not_change_post: true,
					hint: USE_LIBRARY_IMAGE_HINT
				};
			}
		})
	};
}
