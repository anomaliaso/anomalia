import { describe, expect, it } from 'vitest';
import {
	RASTER_IMAGE_ACCEPT,
	RASTER_OR_VIDEO_ACCEPT,
	isHeicSource,
	isRasterImageSource,
	isRasterOrVideoFile,
	jpegFilename,
	sniffRasterKind
} from './raster-image';

describe('raster picker helpers', () => {
	it('lists HEIC in every image picker accept string', () => {
		expect(RASTER_IMAGE_ACCEPT).toContain('image/heic');
		expect(RASTER_IMAGE_ACCEPT).toContain('.heic');
		expect(RASTER_OR_VIDEO_ACCEPT).toContain('image/heic');
		expect(RASTER_OR_VIDEO_ACCEPT).toContain('video/*');
	});

	it('treats iPhone HEIC filenames as rasters even with an empty mime', () => {
		expect(isRasterImageSource({ mime: '', filename: 'IMG_0002.HEIC' })).toBe(true);
		expect(isHeicSource({ mime: '', filename: 'photo.heif' })).toBe(true);
		expect(sniffRasterKind(new Uint8Array(), 'image/heic', '')).toBe('heic');
		expect(isRasterImageSource({ mime: 'image/png', filename: 'logo.png' })).toBe(true);
		expect(isRasterImageSource({ mime: 'application/pdf', filename: 'x.pdf' })).toBe(false);
	});

	it('accepts video files alongside rasters', () => {
		expect(isRasterOrVideoFile({ type: 'video/mp4', name: 'clip.mp4' })).toBe(true);
		expect(isRasterOrVideoFile({ type: '', name: 'IMG_1.heic' })).toBe(true);
		expect(isRasterOrVideoFile({ type: 'application/pdf', name: 'a.pdf' })).toBe(false);
	});

	it('rewrites HEIC names to .jpg', () => {
		expect(jpegFilename('IMG_0002.HEIC')).toBe('IMG_0002.jpg');
		expect(jpegFilename('logo.png')).toBe('logo.jpg');
	});
});
