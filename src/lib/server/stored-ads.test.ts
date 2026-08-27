import { describe, expect, it } from 'vitest';
import { mergeStoredAdDrafts, storedAdFromUnknown } from './stored-ads';

describe('storedAdFromUnknown', () => {
	it('maps a harvested competitor ad', () => {
		const d = storedAdFromUnknown({
			adArchiveId: '111',
			pageName: 'Acme',
			body: 'Run farther.',
			archivedPath: 'u/b/competitors/ads/abc.jpg',
			libraryUrl: 'https://www.facebook.com/ads/library/?id=111'
		});
		expect(d).toEqual({
			id: '111',
			pageName: 'Acme',
			body: 'Run farther.',
			thumb: 'u/b/competitors/ads/abc.jpg',
			libraryUrl: 'https://www.facebook.com/ads/library/?id=111'
		});
	});

	it('maps a remix brief row', () => {
		const d = storedAdFromUnknown({
			source_ad_id: '222',
			source_page_name: 'Rival',
			source_body: 'Hello',
			source_thumbnail: 'https://cdn.example/thumb.jpg',
			source_library_url: 'https://www.facebook.com/ads/library/?id=222'
		});
		expect(d?.id).toBe('222');
		expect(d?.thumb).toBe('https://cdn.example/thumb.jpg');
		expect(d?.pageName).toBe('Rival');
	});

	it('returns null without an id', () => {
		expect(storedAdFromUnknown({ pageName: 'x' })).toBeNull();
	});
});

describe('mergeStoredAdDrafts', () => {
	it('dedupes by ad id, first group wins', () => {
		const merged = mergeStoredAdDrafts([
			[{ adArchiveId: '1', pageName: 'A', thumbnailUrl: 'https://a.example/1.jpg' }],
			[
				{ adArchiveId: '1', pageName: 'A-dup', thumbnailUrl: 'https://a.example/dup.jpg' },
				{ source_ad_id: '2', source_page_name: 'B', source_thumbnail: 'https://b.example/2.jpg' }
			]
		]);
		expect(merged.map((d) => d.id)).toEqual(['1', '2']);
		expect(merged[0].pageName).toBe('A');
	});
});
