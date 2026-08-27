import { describe, it, expect } from 'vitest';
import { mapMetaAd } from './competitor-ads';

describe('mapMetaAd', () => {
	it('maps a Meta Ad Library row with image creative', () => {
		const ad = mapMetaAd({
			ad_archive_id: '615470338018648',
			page_id: '115531458627129',
			page_name: 'Acme Shoes',
			is_active: true,
			start_date: 1740729600,
			publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
			snapshot: {
				body: { text: 'Run farther. Feel better.' },
				cta_text: 'Shop now',
				link_url: 'https://example.com/run',
				display_format: 'IMAGE',
				images: [
					{
						original_image_url: 'https://cdn.example/orig.jpg',
						resized_image_url: 'https://cdn.example/resized.jpg'
					}
				]
			}
		});
		expect(ad).toMatchObject({
			adArchiveId: '615470338018648',
			pageName: 'Acme Shoes',
			pageId: '115531458627129',
			body: 'Run farther. Feel better.',
			cta: 'Shop now',
			linkUrl: 'https://example.com/run',
			platforms: ['FACEBOOK', 'INSTAGRAM'],
			displayFormat: 'IMAGE',
			thumbnailUrl: 'https://cdn.example/resized.jpg',
			isActive: true,
			libraryUrl: 'https://www.facebook.com/ads/library/?id=615470338018648'
		});
		expect(ad?.startDate).toBeTruthy();
	});

	it('falls back to video preview thumb and card body', () => {
		const ad = mapMetaAd({
			ad_archive_id: '99',
			page_name: 'Brand',
			publisher_platform: ['INSTAGRAM'],
			snapshot: {
				display_format: 'VIDEO',
				videos: [{ video_preview_image_url: 'https://cdn.example/preview.jpg' }],
				cards: [{ body: 'Card copy' }]
			}
		});
		expect(ad?.thumbnailUrl).toBe('https://cdn.example/preview.jpg');
		expect(ad?.body).toBe('Card copy');
	});

	it('returns null without ad_archive_id', () => {
		expect(mapMetaAd({ page_name: 'x' })).toBeNull();
	});
});
