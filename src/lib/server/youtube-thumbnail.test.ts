import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
	filenameFromUrl,
	isYoutubeThumbnailSource,
	sniffHeifBrand,
	sniffYoutubeThumbKind
} from '$lib/youtube-thumbnail-format';
import {
	YOUTUBE_THUMBNAIL_MAX_BYTES,
	normalizeYoutubeThumbnailJpeg,
	youtubeThumbnailPrompt
} from './youtube-thumbnail';

describe('youtubeThumbnailPrompt', () => {
	it('asks for a 16:9 YouTube cover and includes the title', () => {
		const p = youtubeThumbnailPrompt({ title: 'How we brew espresso' });
		expect(p).toContain('16:9');
		expect(p).toContain('How we brew espresso');
		expect(p).not.toContain('BASE photo');
	});

	it('weaves in a user brief and caption context', () => {
		const p = youtubeThumbnailPrompt({
			title: 'Hook',
			brief: 'close-up of the red machine',
			caption:
				'A longer description that should be truncated if it goes on and on about nothing in particular and then some more words to exceed two hundred and eighty characters of caption context so the prompt stays bounded for the image model and does not dump the entire YouTube description into the thumbnail brief which would drown the visual direction.'
		});
		expect(p).toContain('close-up of the red machine');
		expect(p).toContain('Video description');
		expect(p.length).toBeLessThan(1200);
	});

	it('tells the model to reframe the video cover when a still is attached', () => {
		const p = youtubeThumbnailPrompt({ title: 'Hook', hasCoverRef: true });
		expect(p).toMatch(/cover frame/i);
		expect(p).toMatch(/16:9 YouTube thumbnail/);
	});
});

const heicPath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/youtube-thumb.heic');

function ftypBox(major: string, compatible: string[] = []): Uint8Array {
	const size = 16 + compatible.length * 4;
	const buf = new Uint8Array(size);
	buf[0] = (size >> 24) & 0xff;
	buf[1] = (size >> 16) & 0xff;
	buf[2] = (size >> 8) & 0xff;
	buf[3] = size & 0xff;
	buf.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
	for (let i = 0; i < 4; i++) buf[8 + i] = major.charCodeAt(i);
	for (let b = 0; b < compatible.length; b++) {
		for (let i = 0; i < 4; i++) buf[16 + b * 4 + i] = compatible[b].charCodeAt(i);
	}
	return buf;
}

describe('sniffYoutubeThumbKind', () => {
	it('reads JPEG / PNG / GIF / WebP magic bytes', async () => {
		const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
			.jpeg()
			.toBuffer();
		const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
			.png()
			.toBuffer();
		const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
			.webp()
			.toBuffer();
		expect(sniffYoutubeThumbKind(jpeg)).toBe('jpeg');
		expect(sniffYoutubeThumbKind(png)).toBe('png');
		expect(sniffYoutubeThumbKind(webp)).toBe('webp');
		expect(sniffYoutubeThumbKind(Buffer.from('GIF89a....'))).toBe('gif');
	});

	it('treats ftyp mif1/heic as HEIC and avif as AVIF', () => {
		expect(sniffHeifBrand(ftypBox('mif1', ['heic', 'hevc']))).toBe('heic');
		expect(sniffYoutubeThumbKind(ftypBox('heic'))).toBe('heic');
		expect(sniffYoutubeThumbKind(ftypBox('avif'))).toBe('avif');
	});

	it('falls back to mime and filename when bytes are empty (iOS often omits type)', () => {
		expect(sniffYoutubeThumbKind(new Uint8Array(), 'image/heic', '')).toBe('heic');
		expect(sniffYoutubeThumbKind(new Uint8Array(), 'application/octet-stream', 'IMG_001.HEIC')).toBe(
			'heic'
		);
		expect(sniffYoutubeThumbKind(new Uint8Array(), '', 'photo.heif')).toBe('heic');
		expect(isYoutubeThumbnailSource({ mime: '', filename: 'cover.HEIC' })).toBe(true);
		expect(isYoutubeThumbnailSource({ mime: 'application/pdf', filename: 'x.pdf' })).toBe(false);
	});

	it('parses the filename from a library URL', () => {
		expect(filenameFromUrl('https://cdn.example/a/IMG_9.heic?token=1')).toBe('IMG_9.heic');
	});
});

describe('normalizeYoutubeThumbnailJpeg', () => {
	it('converts PNG to a JPEG under the YouTube cap', async () => {
		const png = await sharp({ create: { width: 64, height: 36, channels: 3, background: '#3366ff' } })
			.png()
			.toBuffer();
		const out = await normalizeYoutubeThumbnailJpeg(png, { mime: 'image/png', filename: 'a.png' });
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.bytes[0]).toBe(0xff);
		expect(out.bytes[1]).toBe(0xd8);
		expect(out.bytes.length).toBeLessThanOrEqual(YOUTUBE_THUMBNAIL_MAX_BYTES);
		const meta = await sharp(out.bytes).metadata();
		expect(meta.format).toBe('jpeg');
	});

	it('converts WebP to JPEG', async () => {
		const webp = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'green' } })
			.webp()
			.toBuffer();
		const out = await normalizeYoutubeThumbnailJpeg(webp, { mime: 'image/webp' });
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect((await sharp(out.bytes).metadata()).format).toBe('jpeg');
	});

	it('compresses a noisy large JPEG to ≤ 2 MB', async () => {
		const { randomBytes } = await import('node:crypto');
		const w = 2200;
		const h = 2200;
		const jpeg = await sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } })
			.jpeg({ quality: 95 })
			.toBuffer();
		expect(jpeg.length).toBeGreaterThan(YOUTUBE_THUMBNAIL_MAX_BYTES);
		const out = await normalizeYoutubeThumbnailJpeg(jpeg, { mime: 'image/jpeg' });
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.bytes.length).toBeLessThanOrEqual(YOUTUBE_THUMBNAIL_MAX_BYTES);
		expect((await sharp(out.bytes).metadata()).format).toBe('jpeg');
	});

	it('converts a real HEIC (iPhone-style mif1) to JPEG', async () => {
		const heic = readFileSync(heicPath);
		expect(sniffYoutubeThumbKind(heic, '', 'IMG_0002.heic')).toBe('heic');
		const out = await normalizeYoutubeThumbnailJpeg(heic, {
			mime: 'image/heic',
			filename: 'IMG_0002.heic'
		});
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.bytes.length).toBeGreaterThan(1000);
		expect(out.bytes.length).toBeLessThanOrEqual(YOUTUBE_THUMBNAIL_MAX_BYTES);
		const meta = await sharp(out.bytes).metadata();
		expect(meta.format).toBe('jpeg');
		expect(meta.width).toBe(1440);
		expect(meta.height).toBe(960);
	});

	it('converts HEIC even when the browser sent an empty mime and octet-stream name', async () => {
		const heic = readFileSync(heicPath);
		const out = await normalizeYoutubeThumbnailJpeg(heic, {
			mime: 'application/octet-stream',
			filename: 'IMG_0002.HEIC'
		});
		expect(out.ok).toBe(true);
	});

	it('rejects random bytes', async () => {
		const out = await normalizeYoutubeThumbnailJpeg(Buffer.from('not an image'), {
			mime: 'application/octet-stream',
			filename: 'x.bin'
		});
		expect(out).toEqual({ ok: false, error: 'not_image' });
	});
});
