import { describe, expect, it } from 'vitest';
import {
	mediaPartsFor,
	mediaUrlsIn,
	reachableMediaParts,
	userTurnMediaParts
} from './media-parts';

describe('mediaUrlsIn', () => {
	it('picks image and video URLs out of prose and drops other links', () => {
		const text =
			'replica fedelmente https://media.x.ai/v1/website/final-vid.mp4 come questa https://cdn.co/a.png, vedi https://example.com/page';
		expect(mediaUrlsIn(text)).toEqual([
			'https://media.x.ai/v1/website/final-vid.mp4',
			'https://cdn.co/a.png'
		]);
	});

	it('keeps query strings but trims trailing punctuation, and dedupes', () => {
		const text = 'a https://cdn.co/a.mp4?v=2. b https://cdn.co/a.mp4?v=2.';
		expect(mediaUrlsIn(text)).toEqual(['https://cdn.co/a.mp4?v=2']);
	});
});

describe('mediaPartsFor', () => {
	it('maps images to image parts and videos to file parts with the right media type', () => {
		const parts = mediaPartsFor([
			'https://cdn.co/a.png',
			'https://cdn.co/b.mov',
			'https://cdn.co/c.webm'
		]);
		expect(parts.map((p) => p.type)).toEqual(['image', 'file', 'file']);
		expect(parts[0]).toMatchObject({ image: new URL('https://cdn.co/a.png') });
		expect(parts[1]).toMatchObject({ mediaType: 'video/quicktime' });
		expect(parts[2]).toMatchObject({ mediaType: 'video/webm' });
	});

	it('drops unusable links and caps the attachment count', () => {
		expect(mediaPartsFor(['https://example.com/page', 'not a url'])).toEqual([]);
		const many = Array.from({ length: 9 }, (_, i) => `https://cdn.co/${i}.png`);
		expect(mediaPartsFor(many)).toHaveLength(4);
	});
});

describe('userTurnMediaParts', () => {
	it('combines stored attachments with URLs typed in the message', () => {
		const parts = userTurnMediaParts('guarda https://cdn.co/clip.mp4', ['https://cdn.co/up.jpg']);
		expect(parts.map((p) => p.type)).toEqual(['image', 'file']);
	});
});

describe('reachableMediaParts', () => {
	it('keeps parts that load and drops the ones that do not', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async (input: URL | RequestInfo) =>
			String(input).includes('dead')
				? new Response('', { status: 403 })
				: new Response('x', { status: 206 })) as typeof fetch;
		try {
			const parts = mediaPartsFor(['https://cdn.co/ok.png', 'https://cdn.co/dead.mp4']);
			const live = await reachableMediaParts(parts);
			expect(live).toEqual([parts[0]]);
		} finally {
			globalThis.fetch = original;
		}
	});

	it('drops a part when the fetch itself throws', async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error('ENOTFOUND');
		}) as typeof fetch;
		try {
			expect(await reachableMediaParts(mediaPartsFor(['https://cdn.co/a.png']))).toEqual([]);
		} finally {
			globalThis.fetch = original;
		}
	});
});
