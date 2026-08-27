import { describe, expect, it, vi, beforeEach } from 'vitest';

const publishArtifact = vi.fn();
vi.mock('$lib/server/chat/artifacts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/chat/artifacts')>();
	return { ...actual, publishArtifact };
});

const { publishMotionStillArtifacts } = await import('./still-artifacts');

describe('publishMotionStillArtifacts', () => {
	beforeEach(() => {
		publishArtifact.mockReset();
		publishArtifact.mockImplementation(async (_sb: unknown, input: { fileName: string; title: string }) => ({
			artifact: {
				id: `art-${input.fileName}`,
				title: input.title,
				file_name: input.fileName,
				kind: 'image',
				bytes: 4,
				url: `https://cdn.test/${input.fileName}`
			}
		}));
	});

	it('senza thread non pubblica niente: un artefatto appartiene a una conversazione', async () => {
		const out = await publishMotionStillArtifacts({
			supabase: {} as never,
			brandId: 'b1',
			userId: 'u1',
			threadId: null,
			title: 'Launch',
			frames: [{ frame: 30, png: Buffer.from('png') }]
		});
		expect(out).toEqual([]);
		expect(publishArtifact).not.toHaveBeenCalled();
	});

	it('un artefatto per fotogramma, ancorato alla chiamata, visibile in chat', async () => {
		const png = Buffer.from('png-bytes');
		const out = await publishMotionStillArtifacts({
			supabase: {} as never,
			brandId: 'b1',
			userId: 'u1',
			threadId: 't1',
			toolCallId: 'call-stills',
			title: 'Launch',
			frames: [
				{ frame: 30, png },
				{ frame: 90, png }
			]
		});
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ id: 'art-still-f30.png', url: 'https://cdn.test/still-f30.png' });
		expect(publishArtifact).toHaveBeenCalledTimes(2);
		expect(publishArtifact.mock.calls[0][1]).toMatchObject({
			brandId: 'b1',
			userId: 'u1',
			threadId: 't1',
			toolCallId: 'call-stills',
			fileName: 'still-f30.png',
			mime: 'image/png',
			bytes: png,
			source: 'tool'
		});
	});
});
