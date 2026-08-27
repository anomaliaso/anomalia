/** Incoming iPhone HEIC can exceed typical upload caps; convert first, then enforce output size. */
export const RASTER_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/** Longest edge when encoding a converted JPEG (not YouTube-specific). */
export const RASTER_JPEG_MAX_EDGE = 4096;

/** File pickers that take photos (includes HEIC so desktop dialogs show iPhone files). */
export const RASTER_IMAGE_ACCEPT = 'image/*,image/heic,image/heif,.heic,.heif';

/** File pickers that take photos or video. */
export const RASTER_OR_VIDEO_ACCEPT = 'image/*,video/*,image/heic,image/heif,.heic,.heif';

export type RasterKind = 'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'unknown';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(buf: Uint8Array, start: number, end: number): string {
	let s = '';
	for (let i = start; i < end && i < buf.length; i++) s += String.fromCharCode(buf[i]);
	return s;
}

function brandAt(buf: Uint8Array, offset: number): string {
	return ascii(buf, offset, offset + 4).replace(/\0/g, ' ').trim();
}

/** ISO BMFF HEIC/HEIF vs AVIF, from the ftyp box (major + compatible brands). */
export function sniffHeifBrand(buf: Uint8Array): 'heic' | 'avif' | null {
	if (buf.length < 12) return null;
	if (ascii(buf, 4, 8) !== 'ftyp') return null;
	const boxSize = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
	const end = Math.min(buf.length, boxSize > 8 ? boxSize : 32);
	const brands: string[] = [brandAt(buf, 8)];
	for (let i = 16; i + 4 <= end; i += 4) brands.push(brandAt(buf, i));
	if (brands.some((b) => AVIF_BRANDS.has(b))) return 'avif';
	if (brands.some((b) => HEIC_BRANDS.has(b))) return 'heic';
	return null;
}

export function sniffRasterKind(buf: Uint8Array, mime = '', filename = ''): RasterKind {
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
	if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
		return 'png';
	}
	if (buf.length >= 6 && ascii(buf, 0, 3) === 'GIF') return 'gif';
	if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'webp';
	const heif = sniffHeifBrand(buf);
	if (heif) return heif;

	const m = mime.toLowerCase().split(';')[0].trim();
	if (m === 'image/jpeg' || m === 'image/jpg') return 'jpeg';
	if (m === 'image/png') return 'png';
	if (m === 'image/gif') return 'gif';
	if (m === 'image/webp') return 'webp';
	if (m === 'image/avif') return 'avif';
	if (m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence') {
		return 'heic';
	}

	const name = filename.split('?')[0].split('#')[0].toLowerCase();
	if (/\.jpe?g$/.test(name)) return 'jpeg';
	if (name.endsWith('.png')) return 'png';
	if (name.endsWith('.gif')) return 'gif';
	if (name.endsWith('.webp')) return 'webp';
	if (name.endsWith('.avif')) return 'avif';
	if (/\.hei[cf]$/.test(name)) return 'heic';
	return 'unknown';
}

export function isRasterImageSource(opts: { mime?: string; filename?: string; bytes?: Uint8Array }): boolean {
	if (opts.bytes?.length) {
		return sniffRasterKind(opts.bytes, opts.mime, opts.filename) !== 'unknown';
	}
	return sniffRasterKind(new Uint8Array(), opts.mime ?? '', opts.filename ?? '') !== 'unknown';
}

export function isHeicSource(opts: { mime?: string; filename?: string; bytes?: Uint8Array }): boolean {
	if (opts.bytes?.length) return sniffRasterKind(opts.bytes, opts.mime, opts.filename) === 'heic';
	return sniffRasterKind(new Uint8Array(), opts.mime ?? '', opts.filename ?? '') === 'heic';
}

export function isRasterOrVideoFile(file: { type?: string; name?: string }): boolean {
	const mime = (file.type ?? '').toLowerCase();
	if (mime.startsWith('video/')) return true;
	return isRasterImageSource({ mime: file.type, filename: file.name });
}

export function jpegFilename(name: string): string {
	const base = (name.replace(/\.[^.]+$/, '') || 'image').slice(0, 80);
	return `${base}.jpg`;
}

export function filenameFromUrl(url: string): string {
	try {
		const path = new URL(url).pathname;
		return decodeURIComponent(path.split('/').pop() ?? '');
	} catch {
		return (url.split('?')[0].split('/').pop() ?? '').split('#')[0];
	}
}

export function mimeForRasterKind(kind: RasterKind): string {
	switch (kind) {
		case 'jpeg':
			return 'image/jpeg';
		case 'png':
			return 'image/png';
		case 'gif':
			return 'image/gif';
		case 'webp':
			return 'image/webp';
		case 'heic':
			return 'image/heic';
		case 'avif':
			return 'image/avif';
		default:
			return 'application/octet-stream';
	}
}
