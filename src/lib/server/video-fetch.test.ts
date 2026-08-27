import { describe, expect, it, vi } from 'vitest';
import { fetchVideoBytesDetailed, videoFetchError } from './video-review';

function stubFetch(impl: () => Promise<Response> | never) {
	const original = globalThis.fetch;
	globalThis.fetch = (async () => impl()) as typeof fetch;
	return () => {
		globalThis.fetch = original;
	};
}

describe('fetchVideoBytesDetailed', () => {
	it('reports a bot-protected host as blocked, not as an extraction failure', async () => {
		const restore = stubFetch(async () => new Response('cf', { status: 403 }));
		try {
			const r = await fetchVideoBytesDetailed('https://media.example/clip.mp4');
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(r.reason).toBe('blocked');
			// The message has to name the only way out, or it reads as "retry later".
			expect(videoFetchError(r)).toMatch(/uploaded, not linked/);
		} finally {
			restore();
		}
	});

	it('separates a missing file from a blocked one', async () => {
		const restore = stubFetch(async () => new Response('', { status: 404 }));
		try {
			const r = await fetchVideoBytesDetailed('https://media.example/gone.mp4');
			expect(r.ok === false && r.reason).toBe('not_found');
		} finally {
			restore();
		}
	});

	it('reports a network error rather than swallowing it', async () => {
		const restore = stubFetch(() => {
			throw new Error('ENOTFOUND');
		});
		try {
			const r = await fetchVideoBytesDetailed('https://nope.invalid/clip.mp4');
			expect(r.ok === false && r.reason).toBe('network');
			expect(r.ok === false && videoFetchError(r)).toMatch(/ENOTFOUND/);
		} finally {
			restore();
		}
	});

	it('passes a normal clip through', async () => {
		const body = new Uint8Array([0, 1, 2, 3]);
		const restore = stubFetch(async () => new Response(body, { status: 200 }));
		try {
			const r = await fetchVideoBytesDetailed('https://media.example/ok.mp4');
			expect(r.ok).toBe(true);
			expect(r.ok && r.bytes.length).toBe(4);
		} finally {
			restore();
		}
	});
});

describe('mp4 duration', () => {
	it('reads the length from the mvhd atom so the no-ffmpeg path can still be reviewed', async () => {
		const { mp4DurationSeconds } = await import('./video-review');
		// mvhd v0: 'mvhd' + version/flags(4) + created(4) + modified(4) + timescale(4) + duration(4)
		const buf = Buffer.alloc(32);
		buf.write('mvhd', 0, 'ascii');
		buf.writeUInt32BE(0, 4); // version 0 + flags
		buf.writeUInt32BE(600, 16); // timescale
		buf.writeUInt32BE(9000, 20); // duration units -> 15s
		expect(mp4DurationSeconds(buf)).toBeCloseTo(15, 5);
		expect(mp4DurationSeconds(Buffer.from('no atom here'))).toBe(0);
	});
});
