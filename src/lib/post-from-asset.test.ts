import { describe, expect, it } from 'vitest';
import { POST_ASSET_TYPES, postAssetShape, checkAssetCount } from '$lib/post-from-asset';

describe('writing a post from an asset that already exists', () => {
	it('moves content_type, format and media_origin together for every type', () => {
		// The defect this table prevents: an mp4 in media_url with format 'image'. The editor opens
		// it as a photo, publishing breaks, and nothing errors — because the three fields were set
		// in three different places and only two of them knew it was a video.
		for (const type of POST_ASSET_TYPES) {
			const shape = postAssetShape(type)!;
			expect(shape.contentType, type).toBeTruthy();
			expect(shape.format, type).toBeTruthy();
			expect(shape.mediaOrigin, type).toBeTruthy();
		}
		expect(postAssetShape('video')).toMatchObject({ format: 'video', mediaKind: 'video' });
		expect(postAssetShape('image')).toMatchObject({ format: 'image', mediaKind: 'image' });
	});

	it('asks the library for the kind the type actually needs', () => {
		// A clip cannot be an image post and a photo cannot be a reel, so the type decides which
		// library kind is even looked up — the mismatch is refused at the query, not later.
		expect(postAssetShape('video')!.mediaKind).toBe('video');
		expect(postAssetShape('carousel')!.mediaKind).toBe('image');
	});

	it('does not answer for a type it does not write', () => {
		expect(postAssetShape('motion')).toBeUndefined();
		expect(postAssetShape('graphic')).toBeUndefined();
	});

	it('refuses a count the type cannot use, instead of dropping what was paid for', () => {
		expect(checkAssetCount('image', 3)).toBe('too_many');
		expect(checkAssetCount('carousel', 1)).toBe('too_few');
		expect(checkAssetCount('video', 0)).toBe('none');
		expect(checkAssetCount('motion', 1)).toBe('unknown_type');
	});

	it('accepts the counts that work', () => {
		expect(checkAssetCount('image', 1)).toBeNull();
		expect(checkAssetCount('video', 1)).toBeNull();
		expect(checkAssetCount('carousel', 4)).toBeNull();
	});
});
