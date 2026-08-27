/** YouTube Data API custom-thumbnail cap (Zernio forwards the file as-is). */
export const YOUTUBE_THUMBNAIL_MAX_BYTES = 2_000_000;

/** Incoming HEIC/PNG can exceed 2 MB; the cap applies to the JPEG we store. */
export const YOUTUBE_THUMBNAIL_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** Resize so the longest edge fits before JPEG encode. */
export const YOUTUBE_THUMBNAIL_MAX_EDGE = 1920;

export const YOUTUBE_THUMB_FILE_ACCEPT =
	'image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif';

export {
	filenameFromUrl,
	isRasterImageSource as isYoutubeThumbnailSource,
	sniffHeifBrand,
	sniffRasterKind as sniffYoutubeThumbKind
} from '$lib/raster-image';

export type { RasterKind as YoutubeThumbKind } from '$lib/raster-image';
