import { describe, expect, it } from 'vitest';
import {
	MOTION_MP4_MAX_EDGE,
	motionMp4PixelSize,
	motionMp4Scale,
	parseMotionMp4Quality
} from './mp4-render';
import { motionSizeForAspect } from './source';

describe('motion-video mp4 render', () => {
	it('2K supersamples every allowed canvas to even 2× pixels', () => {
		for (const aspect of ['1:1', '9:16', '16:9'] as const) {
			const { width, height } = motionSizeForAspect(aspect);
			const out = motionMp4PixelSize(width, height, '2k');
			expect(out).toEqual({ width: width * 2, height: height * 2 });
			expect(out.width % 2).toBe(0);
			expect(out.height % 2).toBe(0);
		}
	});

	it('4K targets ~3840 on the short edge and stays within the WebCodecs cap', () => {
		const square = motionMp4PixelSize(1080, 1080, '4k');
		expect(square).toEqual({ width: 3840, height: 3840 });

		const portrait = motionMp4PixelSize(1080, 1920, '4k');
		expect(portrait).toEqual({ width: 2304, height: MOTION_MP4_MAX_EDGE });

		const landscape = motionMp4PixelSize(1920, 1080, '4k');
		expect(landscape).toEqual({ width: MOTION_MP4_MAX_EDGE, height: 2304 });
	});

	it('parses quality and ignores unknown values', () => {
		expect(parseMotionMp4Quality('4k')).toBe('4k');
		expect(parseMotionMp4Quality('8k')).toBe('2k');
		expect(motionMp4Scale(1080, 1080, '2k')).toBe(2);
	});
});
