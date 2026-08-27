import type { SupabaseClient } from '@supabase/supabase-js';
import type { MotionVideoListItem, MotionVideoMeta, MotionVideoRow } from '$lib/motion-video/source';
import { MOTION_SOURCE_MAX_CHARS } from '$lib/motion-video/source';

export type { MotionVideoListItem, MotionVideoRow };

export async function listMotionVideos(
	supabase: SupabaseClient,
	brandId: string,
	limit = 60
): Promise<MotionVideoListItem[]> {
	const { data, error } = await supabase
		.from('motion_videos')
		.select(
			'id, title, preview_url, fps, duration_in_frames, width, height, updated_at, created_at'
		)
		.eq('brand_id', brandId)
		.order('updated_at', { ascending: false })
		.limit(limit);
	if (error) {
		console.error('[motion-videos] list', error.message);
		return [];
	}
	return (data ?? []) as MotionVideoListItem[];
}

export async function getMotionVideo(
	supabase: SupabaseClient,
	brandId: string,
	id: string
): Promise<MotionVideoRow | null> {
	const { data, error } = await supabase
		.from('motion_videos')
		.select('*')
		.eq('brand_id', brandId)
		.eq('id', id)
		.maybeSingle();
	if (error) {
		console.error('[motion-videos] get', error.message);
		return null;
	}
	return (data as MotionVideoRow | null) ?? null;
}

export async function getMotionVideosByIds(
	supabase: SupabaseClient,
	brandId: string,
	ids: string[]
): Promise<MotionVideoRow[]> {
	if (!ids.length) return [];
	const { data, error } = await supabase
		.from('motion_videos')
		.select('*')
		.eq('brand_id', brandId)
		.in('id', ids);
	if (error) {
		console.error('[motion-videos] getByIds', error.message);
		return [];
	}
	const rows = (data ?? []) as MotionVideoRow[];
	const order = new Map(ids.map((id, i) => [id, i]));
	return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function saveMotionVideo(
	supabase: SupabaseClient,
	opts: {
		brandId: string;
		userId: string;
		id?: string | null;
		title: string;
		source: string;
		meta: MotionVideoMeta;
		previewUrl?: string | null;
	}
): Promise<{ ok: true; row: MotionVideoRow } | { ok: false; error: string }> {
	const source = opts.source;
	if (!source.trim()) return { ok: false, error: 'Empty source' };
	if (source.length > MOTION_SOURCE_MAX_CHARS) {
		return { ok: false, error: `Source exceeds ${MOTION_SOURCE_MAX_CHARS} characters` };
	}

	const title = opts.title.trim() || 'Motion video';
	const payload: Record<string, unknown> = {
		brand_id: opts.brandId,
		user_id: opts.userId,
		title,
		source,
		fps: opts.meta.fps,
		duration_in_frames: opts.meta.durationInFrames,
		width: opts.meta.width,
		height: opts.meta.height,
		updated_at: new Date().toISOString()
	};
	if (opts.previewUrl !== undefined) payload.preview_url = opts.previewUrl;

	if (opts.id) {
		// A canvas change invalidates the stored preview: it was encoded at the old size, so the
		// gallery would show a 16:9 clip in a 9:16 cell until a re-render lands. Drop it; the
		// render route overwrites preview_url as soon as the new MP4 exists.
		//
		// Only a SIZE change is handled here, and that is deliberate: an edit that keeps the canvas
		// leaves the old url in place, so the gallery keeps showing the previous clip instead of an
		// empty tile while the new one renders. That was a real defect back when the render never
		// wrote preview_url at all — QC then scored the stale file — but the render route now
		// always overwrites it, so the stale window lasts exactly one render.
		if (opts.previewUrl === undefined) {
			const { data: prev } = await supabase
				.from('motion_videos')
				.select('width, height')
				.eq('id', opts.id)
				.eq('brand_id', opts.brandId)
				.maybeSingle();
			if (prev && (prev.width !== opts.meta.width || prev.height !== opts.meta.height)) {
				payload.preview_url = null;
			}
		}
		const { data, error } = await supabase
			.from('motion_videos')
			.update(payload)
			.eq('id', opts.id)
			.eq('brand_id', opts.brandId)
			.select('*')
			.maybeSingle();
		if (error || !data) return { ok: false, error: error?.message ?? 'Update failed' };
		return { ok: true, row: data as MotionVideoRow };
	}

	const { data, error } = await supabase.from('motion_videos').insert(payload).select('*').maybeSingle();
	if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed' };
	return { ok: true, row: data as MotionVideoRow };
}

export async function updateMotionPreviewUrl(
	supabase: SupabaseClient,
	brandId: string,
	id: string,
	previewUrl: string
): Promise<{ ok: true; row: MotionVideoRow } | { ok: false; error: string }> {
	const { data, error } = await supabase
		.from('motion_videos')
		.update({ preview_url: previewUrl, updated_at: new Date().toISOString() })
		.eq('id', id)
		.eq('brand_id', brandId)
		.select('*')
		.maybeSingle();
	if (error || !data) return { ok: false, error: error?.message ?? 'Preview update failed' };
	return { ok: true, row: data as MotionVideoRow };
}

export async function deleteMotionVideo(
	supabase: SupabaseClient,
	brandId: string,
	id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	const { error } = await supabase.from('motion_videos').delete().eq('id', id).eq('brand_id', brandId);
	if (error) return { ok: false, error: error.message };
	return { ok: true };
}

export type MotionVideoPromptRow = {
	id: string;
	brand_id: string;
	user_id: string;
	prompt: string;
	selected_count: number;
	created_at: string;
};

export async function insertMotionVideoPrompt(
	supabase: SupabaseClient,
	input: {
		brandId: string;
		userId: string;
		prompt: string;
		selectedCount?: number;
	}
): Promise<{ id: string } | { error: string }> {
	const { data, error } = await supabase
		.from('motion_video_prompts')
		.insert({
			brand_id: input.brandId,
			user_id: input.userId,
			prompt: input.prompt.slice(0, 8000),
			selected_count: Math.max(0, input.selectedCount ?? 0)
		})
		.select('id')
		.single();
	if (error || !data) return { error: error?.message ?? 'insert failed' };
	return { id: data.id as string };
}

export async function listMotionVideoPrompts(
	supabase: SupabaseClient,
	brandId: string,
	limit = 80
): Promise<MotionVideoPromptRow[]> {
	const capped = Math.min(Math.max(limit, 1), 200);
	const { data, error } = await supabase
		.from('motion_video_prompts')
		.select('*')
		.eq('brand_id', brandId)
		.order('created_at', { ascending: false })
		.limit(capped);
	if (error) {
		console.error('[motion-videos] list prompts', error.message);
		return [];
	}
	return (data ?? []) as MotionVideoPromptRow[];
}
