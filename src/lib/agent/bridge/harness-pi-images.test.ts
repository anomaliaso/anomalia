import { describe, expect, it, vi } from 'vitest';

const { extractUserText, extractUserImages } = await import('@ai-sdk/harness-pi');

describe('harness-pi multimodal user prompt', () => {
	it('does not throw on an image part — the text rides alone', () => {
		const text = extractUserText({
			role: 'user',
			content: [
				{ type: 'text', text: 'guarda questa foto' },
				{ type: 'image', image: new URL('https://cdn.example/a.png') }
			]
		} as never);
		expect(text).toBe('guarda questa foto');
	});

	it('turns a data-URL upload into a pi ImageContent', async () => {
		const images = await extractUserImages({
			role: 'user',
			content: [{ type: 'image', image: 'data:image/jpeg;base64,AAAA' }]
		} as never);
		expect(images).toEqual([{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }]);
	});

	it('downloads a remote reference image', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(new Uint8Array([1, 2, 3]).buffer, {
						status: 200,
						headers: { 'content-type': 'image/png' }
					})
			)
		);
		try {
			const images = await extractUserImages({
				role: 'user',
				content: [{ type: 'image', image: new URL('https://cdn.example/a.png') }]
			} as never);
			expect(images).toEqual([
				{ type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/png' }
			]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('keeps raw bytes as they are', async () => {
		const images = await extractUserImages({
			role: 'user',
			content: [{ type: 'image', image: new Uint8Array([9, 9, 9]) }]
		} as never);
		expect(images).toEqual([
			{ type: 'image', data: Buffer.from([9, 9, 9]).toString('base64'), mimeType: 'image/png' }
		]);
	});

	it('drops an unreachable remote image instead of killing the turn', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 403 }))
		);
		try {
			const images = await extractUserImages({
				role: 'user',
				content: [{ type: 'image', image: new URL('https://cdn.example/gone.png') }]
			} as never);
			expect(images).toEqual([]);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
