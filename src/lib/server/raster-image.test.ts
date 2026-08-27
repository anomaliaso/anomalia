import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { jpegIfHeic } from './raster-image';

const heicPath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/youtube-thumb.heic');

describe('jpegIfHeic', () => {
	it('leaves PNG (including transparency) untouched', async () => {
		const png = await sharp({
			create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 180, b: 80, alpha: 0 } }
		})
			.png()
			.toBuffer();
		const out = await jpegIfHeic(png, { mime: 'image/png', filename: 'logo.png' });
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.converted).toBe(false);
		expect(out.mime).toBe('image/png');
		expect(out.filename).toBe('logo.png');
		expect(out.bytes.equals(png)).toBe(true);
		const meta = await sharp(out.bytes).metadata();
		expect(meta.format).toBe('png');
		expect(meta.hasAlpha).toBe(true);
	});

	it('leaves a small JPEG untouched', async () => {
		const jpeg = await sharp({ create: { width: 12, height: 8, channels: 3, background: 'navy' } })
			.jpeg()
			.toBuffer();
		const out = await jpegIfHeic(jpeg, { mime: 'image/jpeg', filename: 'shot.jpg' });
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.converted).toBe(false);
		expect(out.mime).toBe('image/jpeg');
		expect(out.bytes.equals(jpeg)).toBe(true);
	});

	it('converts a real HEIC to JPEG', async () => {
		const heic = readFileSync(heicPath);
		const out = await jpegIfHeic(heic, { mime: 'image/heic', filename: 'IMG_0002.heic' });
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		expect(out.converted).toBe(true);
		expect(out.mime).toBe('image/jpeg');
		expect(out.filename).toBe('IMG_0002.jpg');
		const meta = await sharp(out.bytes).metadata();
		expect(meta.format).toBe('jpeg');
		expect(meta.width).toBe(1440);
		expect(meta.height).toBe(960);
	});

	it('rejects non-images', async () => {
		const out = await jpegIfHeic(Buffer.from('%PDF-1.4'), {
			mime: 'application/pdf',
			filename: 'doc.pdf'
		});
		expect(out).toEqual({ ok: false, error: 'not_image' });
	});
});
