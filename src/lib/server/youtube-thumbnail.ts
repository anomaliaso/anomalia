import type { SupabaseClient } from '@supabase/supabase-js';
import { isUrlSafe } from '$lib/server/brand-analysis';
import { rasterToJpeg } from '$lib/server/raster-image';
import {
	YOUTUBE_THUMBNAIL_MAX_BYTES,
	YOUTUBE_THUMBNAIL_MAX_EDGE,
	YOUTUBE_THUMBNAIL_SOURCE_MAX_BYTES,
	filenameFromUrl
} from '$lib/youtube-thumbnail-format';

export {
	YOUTUBE_THUMBNAIL_MAX_BYTES,
	YOUTUBE_THUMBNAIL_SOURCE_MAX_BYTES
} from '$lib/youtube-thumbnail-format';

export type YoutubeThumbNormalizeError = 'not_image' | 'too_large' | 'convert_failed';

export function youtubeThumbnailPrompt(opts: {
	title: string;
	caption?: string | null;
	brief?: string | null;
	hasCoverRef?: boolean;
}): string {
	const title = opts.title.trim() || 'this video';
	const brief = (opts.brief ?? '').trim();
	const caption = (opts.caption ?? '').trim().replace(/\s+/g, ' ').slice(0, 280);
	const lines = [
		`YouTube custom thumbnail, landscape 16:9 (1280×720). High-CTR clickable cover for a video titled "${title}".`,
		brief ? `User direction: ${brief}` : '',
		caption ? `Video description (context only, do not typeset the whole caption): ${caption}` : '',
		'Bold, high-contrast, one clear subject filling the frame. Faces or product large. Fill the entire 16:9 frame — no letterboxing, no black bars, no YouTube UI chrome (no play button, no timestamp, no subscriber count).',
		'Optional: 3–6 punchy words in large readable type using the brand colours/fonts — only if it increases click-through. No paragraphs, no watermarks, no fake UI.',
		opts.hasCoverRef
			? "The attached BASE photo is the video's cover frame — keep the subject identity (person/product), reframe and restyle it as a 16:9 YouTube thumbnail."
			: ''
	];
	return lines.filter(Boolean).join('\n');
}

export async function persistYoutubeThumbnail(
	supabase: SupabaseClient,
	opts: { postId: string; brandId: string; url: string | null }
): Promise<{ error?: string }> {
	const { error } = await supabase
		.from('posts')
		.update({ youtube_thumbnail_url: opts.url })
		.eq('id', opts.postId)
		.eq('brand_id', opts.brandId);
	return error ? { error: error.message } : {};
}

/** Decode HEIC/WebP/PNG/GIF/JPEG and emit a JPEG YouTube will accept (≤ 2 MB). */
export async function normalizeYoutubeThumbnailJpeg(
	buf: Buffer,
	opts?: { mime?: string; filename?: string }
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: YoutubeThumbNormalizeError }> {
	return rasterToJpeg(buf, {
		mime: opts?.mime,
		filename: opts?.filename,
		always: true,
		maxBytes: YOUTUBE_THUMBNAIL_MAX_BYTES,
		maxEdge: YOUTUBE_THUMBNAIL_MAX_EDGE,
		sourceMaxBytes: YOUTUBE_THUMBNAIL_SOURCE_MAX_BYTES
	});
}

export type YoutubeThumbUploadResult =
	| { url: string }
	| { error: YoutubeThumbNormalizeError | 'upload_failed' };

/** Convert to JPEG and upload into the public media bucket (no 9:16 crop — YouTube thumbs are 16:9). */
export async function uploadYoutubeThumbnailBytes(
	supabase: SupabaseClient,
	userId: string,
	buf: Buffer,
	mime: string,
	filename?: string
): Promise<YoutubeThumbUploadResult> {
	const norm = await normalizeYoutubeThumbnailJpeg(buf, { mime, filename });
	if (!norm.ok) return { error: norm.error };
	const path = `${userId}/youtube-thumbs/${crypto.randomUUID()}.jpg`;
	const { error } = await supabase.storage.from('media').upload(path, norm.bytes, {
		contentType: 'image/jpeg',
		upsert: false
	});
	if (error) return { error: 'upload_failed' };
	return { url: supabase.storage.from('media').getPublicUrl(path).data.publicUrl };
}

/** Copy an existing https image (library pick / video cover) into a durable public URL. */
export async function copyImageAsYoutubeThumbnail(
	supabase: SupabaseClient,
	userId: string,
	url: string
): Promise<string | null> {
	if (!url || !isUrlSafe(url)) return null;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
		if (!res.ok) return null;
		const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		const buf = Buffer.from(await res.arrayBuffer());
		const result = await uploadYoutubeThumbnailBytes(
			supabase,
			userId,
			buf,
			mime,
			filenameFromUrl(url)
		);
		return 'url' in result ? result.url : null;
	} catch {
		return null;
	}
}

export async function generateYoutubeThumbnail(opts: {
	supabase: SupabaseClient;
	userId: string;
	brandId: string;
	title: string;
	caption?: string | null;
	brief?: string | null;
	referenceUrls?: string[];
}): Promise<{ imageUrl?: string; error?: string }> {
	const refs = (opts.referenceUrls ?? []).filter((u) => typeof u === 'string' && !!u).slice(0, 4);
	const { generateStandaloneImage } = await import('$lib/server/content-preview');
	try {
		const gen = await generateStandaloneImage({
			supabase: opts.supabase,
			userId: opts.userId,
			brandId: opts.brandId,
			prompt: youtubeThumbnailPrompt({
				title: opts.title,
				caption: opts.caption,
				brief: opts.brief,
				hasCoverRef: refs.length > 0
			}),
			// aspectRatioFor('youtube') is 9:16 (Shorts). Custom thumbs are 16:9 — must override.
			platform: 'youtube',
			aspectRatio: '16:9',
			referenceUrls: refs
		});
		if (!gen.imageUrl) return { error: 'Image generation failed' };
		return { imageUrl: gen.imageUrl };
	} catch (e) {
		return { error: e instanceof Error ? e.message : 'generate_failed' };
	}
}
