import sharp from 'sharp';
import {
	RASTER_JPEG_MAX_EDGE,
	RASTER_SOURCE_MAX_BYTES,
	isRasterImageSource,
	jpegFilename,
	mimeForRasterKind,
	sniffRasterKind
} from '$lib/raster-image';

export type RasterJpegError = 'not_image' | 'too_large' | 'convert_failed';

const JPEG_QUALITIES = [86, 78, 70, 62, 52];

async function decodeHeicRgba(buf: Buffer): Promise<{ width: number; height: number; data: Buffer }> {
	const { default: decode } = await import('heic-decode');
	const img = await decode({ buffer: buf });
	return { width: img.width, height: img.height, data: Buffer.from(img.data) };
}

async function encodeJpeg(
	pipeline: sharp.Sharp,
	opts: { maxEdge: number; maxBytes?: number }
): Promise<Buffer | null> {
	const fitted = pipeline.resize({
		width: opts.maxEdge,
		height: opts.maxEdge,
		fit: 'inside',
		withoutEnlargement: true
	});
	const qualities = opts.maxBytes ? JPEG_QUALITIES : [86];
	for (const quality of qualities) {
		const out = await fitted.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
		if (!opts.maxBytes || out.length <= opts.maxBytes) return out;
	}
	const smaller = await fitted
		.clone()
		.resize({ width: Math.min(1280, opts.maxEdge), height: Math.min(1280, opts.maxEdge), fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality: 68, mozjpeg: true })
		.toBuffer();
	if (!opts.maxBytes || smaller.length <= opts.maxBytes) return smaller;
	return null;
}

export type RasterToJpegOpts = {
	mime?: string;
	filename?: string;
	/** Convert PNG/WebP/GIF too (YouTube thumbs). Default: HEIC/AVIF only. */
	always?: boolean;
	maxBytes?: number;
	maxEdge?: number;
	sourceMaxBytes?: number;
};

/** Decode HEIC (and optionally any raster) to a JPEG buffer. */
export async function rasterToJpeg(
	buf: Buffer,
	opts?: RasterToJpegOpts
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: RasterJpegError }> {
	if (!buf.length) return { ok: false, error: 'not_image' };
	const sourceMax = opts?.sourceMaxBytes ?? RASTER_SOURCE_MAX_BYTES;
	if (buf.length > sourceMax) return { ok: false, error: 'too_large' };
	const kind = sniffRasterKind(buf, opts?.mime, opts?.filename);
	if (kind === 'unknown') return { ok: false, error: 'not_image' };

	const mustConvert = opts?.always || kind === 'heic' || kind === 'avif';
	if (!mustConvert) return { ok: true, bytes: buf };

	try {
		let pipeline: sharp.Sharp;
		if (kind === 'heic') {
			const rgba = await decodeHeicRgba(buf);
			pipeline = sharp(rgba.data, {
				raw: { width: rgba.width, height: rgba.height, channels: 4 }
			});
		} else {
			pipeline = sharp(buf, { failOn: 'none' }).rotate();
		}
		const bytes = await encodeJpeg(pipeline, {
			maxEdge: opts?.maxEdge ?? RASTER_JPEG_MAX_EDGE,
			maxBytes: opts?.maxBytes
		});
		if (!bytes) return { ok: false, error: 'too_large' };
		return { ok: true, bytes };
	} catch {
		return { ok: false, error: 'convert_failed' };
	}
}

/**
 * HEIC/HEIF → JPEG; other rasters pass through. Use this on every image upload.
 * PNG logos keep transparency.
 */
export async function jpegIfHeic(
	buf: Buffer,
	opts?: { mime?: string; filename?: string; maxBytes?: number; maxEdge?: number; sourceMaxBytes?: number }
): Promise<
	| { ok: true; bytes: Buffer; mime: string; filename: string; converted: boolean }
	| { ok: false; error: RasterJpegError }
> {
	const kind = sniffRasterKind(buf, opts?.mime, opts?.filename);
	const heic = kind === 'heic' || kind === 'avif';
	const recompress =
		!heic &&
		(kind === 'jpeg' || kind === 'webp') &&
		opts?.maxBytes != null &&
		buf.length > opts.maxBytes;
	const converted = heic || recompress;
	const out = await rasterToJpeg(buf, { ...opts, always: converted });
	if (!out.ok) return out;
	if (!converted) {
		return {
			ok: true,
			bytes: out.bytes,
			mime: mimeForRasterKind(kind),
			filename: opts?.filename || 'image',
			converted: false
		};
	}
	return {
		ok: true,
		bytes: out.bytes,
		mime: 'image/jpeg',
		filename: jpegFilename(opts?.filename || 'image'),
		converted: true
	};
}

/** Read a picker File, convert HEIC to JPEG, reject non-images. */
export async function readUploadImage(
	file: File,
	opts?: { maxSourceBytes?: number; maxOutBytes?: number; maxEdge?: number }
): Promise<
	| { ok: true; bytes: Buffer; mime: string; filename: string }
	| { ok: false; error: RasterJpegError }
> {
	if (!isRasterImageSource({ mime: file.type, filename: file.name })) {
		return { ok: false, error: 'not_image' };
	}
	const maxSource = opts?.maxSourceBytes ?? RASTER_SOURCE_MAX_BYTES;
	if (file.size > maxSource) return { ok: false, error: 'too_large' };
	const buf = Buffer.from(await file.arrayBuffer());
	const out = await jpegIfHeic(buf, {
		mime: file.type,
		filename: file.name,
		maxBytes: opts?.maxOutBytes,
		maxEdge: opts?.maxEdge,
		sourceMaxBytes: maxSource
	});
	if (!out.ok) return out;
	return { ok: true, bytes: out.bytes, mime: out.mime, filename: out.filename };
}

/** Gemini / generator inline part from a picker file (HEIC becomes JPEG). */
export async function fileToInlineImagePart(
	file: File,
	maxOutBytes = 6_000_000
): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
	const out = await readUploadImage(file, {
		maxOutBytes,
		maxSourceBytes: RASTER_SOURCE_MAX_BYTES
	});
	if (!out.ok) return null;
	return { inlineData: { mimeType: out.mime, data: out.bytes.toString('base64') } };
}
