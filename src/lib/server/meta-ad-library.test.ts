import { describe, expect, it } from 'vitest';
import { collectAds, resolveMetaAdSortBy } from './meta-ad-library';

describe('resolveMetaAdSortBy', () => {
	it('maps UI impressions to ScrapeCreators total_impressions', () => {
		expect(resolveMetaAdSortBy('impressions')).toBe('total_impressions');
	});

	it('passes through supported ScrapeCreators values', () => {
		expect(resolveMetaAdSortBy('total_impressions')).toBe('total_impressions');
		expect(resolveMetaAdSortBy('relevancy_monthly_grouped')).toBe('relevancy_monthly_grouped');
	});

	it('defaults unknown or empty values to total_impressions', () => {
		expect(resolveMetaAdSortBy(undefined)).toBe('total_impressions');
		expect(resolveMetaAdSortBy(null)).toBe('total_impressions');
		expect(resolveMetaAdSortBy('')).toBe('total_impressions');
		expect(resolveMetaAdSortBy('date')).toBe('total_impressions');
		expect(resolveMetaAdSortBy('popularity')).toBe('total_impressions');
	});
});

describe('collectAds', () => {
	it('reads keyword searchResults as a top-level ad array', () => {
		const ads = collectAds({
			searchResults: [{ ad_archive_id: '1', page_name: 'Acme' }]
		});
		expect(ads).toHaveLength(1);
		expect(ads[0]?.id).toBe('1');
		expect(ads[0]?.pageName).toBe('Acme');
	});

	it('reads company results as a top-level ad array', () => {
		const ads = collectAds({
			results: [{ ad_archive_id: '2', page_name: 'Brand' }]
		});
		expect(ads).toHaveLength(1);
		expect(ads[0]?.id).toBe('2');
	});

	it('still supports nested { ads: [...] } wrappers', () => {
		const ads = collectAds({
			searchResults: { ads: [{ ad_archive_id: '3' }] }
		});
		expect(ads).toHaveLength(1);
		expect(ads[0]?.id).toBe('3');
	});

	it('falls back to data / ads roots', () => {
		expect(collectAds({ data: [{ ad_archive_id: '4' }] })[0]?.id).toBe('4');
		expect(collectAds({ ads: [{ ad_archive_id: '5' }] })[0]?.id).toBe('5');
	});

	it('parses snapshot.body.text into body', () => {
		const ads = collectAds({
			searchResults: [
				{
					ad_archive_id: '6',
					snapshot: { body: { text: 'Try our product today' } }
				}
			]
		});
		expect(ads[0]?.body).toBe('Try our product today');
	});
});

describe('collectAds — video creatives (regression)', () => {
	// Payload ScrapeCreators ridotto, ripreso da una risposta reale: per un annuncio VIDEO Meta
	// manda cards/images vuoti e mette l'mp4 in snapshot.videos[0]. Prima della fix questo
	// restituiva videoUrl null e la Ads Library non mostrava né player né review.
	const VIDEO_ROW = {
		ad_archive_id: '1234567890',
		page_name: 'Competitor Srl',
		is_active: true,
		publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
		snapshot: {
			body: { text: 'Stanco di rincorrere i clienti?' },
			cards: [],
			images: [],
			videos: [
				{
					video_hd_url: 'https://video.xx.fbcdn.net/v/t42.1790-2/hd.mp4',
					video_sd_url: 'https://video.xx.fbcdn.net/v/t42.1790-2/sd.mp4',
					video_preview_image_url: 'https://scontent.xx.fbcdn.net/v/t39/poster.jpg'
				}
			],
			display_format: 'video',
			cta_text: 'Learn more'
		}
	};

	it('reads the mp4 from snapshot.videos[0]', () => {
		const [ad] = collectAds({ searchResults: [VIDEO_ROW] });
		expect(ad?.videoUrl).toBe('https://video.xx.fbcdn.net/v/t42.1790-2/hd.mp4');
	});

	it('falls back to the video poster as the grid thumbnail', () => {
		const [ad] = collectAds({ searchResults: [VIDEO_ROW] });
		expect(ad?.imageUrl).toBe('https://scontent.xx.fbcdn.net/v/t39/poster.jpg');
		expect(ad?.mediaType).toBe('video');
		expect(ad?.body).toBe('Stanco di rincorrere i clienti?');
	});

	it('finds the video even when an image card comes first (mixed carousel)', () => {
		const [ad] = collectAds({
			searchResults: [
				{
					ad_archive_id: '42',
					snapshot: {
						images: [{ original_image_url: 'https://cdn/x.jpg' }],
						videos: [{ video_sd_url: 'https://cdn/y.mp4' }]
					}
				}
			]
		});
		expect(ad?.imageUrl).toBe('https://cdn/x.jpg');
		expect(ad?.videoUrl).toBe('https://cdn/y.mp4');
	});

	it('a card-level video still wins (carousel video ads)', () => {
		const [ad] = collectAds({
			searchResults: [
				{ ad_archive_id: '43', snapshot: { cards: [{ video_hd_url: 'https://cdn/c.mp4' }] } }
			]
		});
		expect(ad?.videoUrl).toBe('https://cdn/c.mp4');
	});
});
