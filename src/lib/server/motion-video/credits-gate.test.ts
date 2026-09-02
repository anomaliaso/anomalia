import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('motion-video credit gate', () => {
	it('blocks the agent turn before any Gemini call', () => {
		const src = readFileSync(new URL('./run-turn.ts', import.meta.url), 'utf8');
		const gate = src.indexOf('await gateCredits(opts.brand.id)');
		const agent = src.indexOf('return runMotionVideoAgent({');
		expect(gate).toBeGreaterThan(-1);
		expect(agent).toBeGreaterThan(-1);
		expect(gate).toBeLessThan(agent);
	});

	it('returns 402 from the Motion chat route when credits are exhausted', () => {
		const src = readFileSync(
			new URL('../../../routes/app/[brand]/motion-video/+server.ts', import.meta.url),
			'utf8'
		);
		expect(src).toContain('CreditsExhaustedError');
		expect(src).toContain("error: 'credits_exhausted'");
		expect(src).toContain('status: 402');
	});

	it('gates brand-chat source read and patch tools', () => {
		const src = readFileSync(
			new URL('../../agent/tools/motion-video-tools.ts', import.meta.url),
			'utf8'
		);
		expect(src.match(/requireMotionCredits/g)?.length).toBeGreaterThanOrEqual(6);
		expect(src).toContain('read_motion_source');
		expect(src).toContain('replace_motion_source');
		expect(src).toContain('grep_motion_source');
		expect(src).toContain('write_motion_source');
		expect(src).toContain('create_motion_video');
	});
});
