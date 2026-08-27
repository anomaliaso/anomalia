import { describe, expect, it } from 'vitest';
import { formatMotionLength } from './source';
import {
	extractMotionHeadline,
	formatMotionSessionRoster,
	formatMotionTargetingRules,
	formatMotionUserTargetingPrefix
} from './session-targets';

const portrait = {
	id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
	title: 'Launch ad · 9:16',
	source: "const headline = 'Your marketing team.\\nOn autopilot.';\nexport default function MotionVideo() {}",
	width: 1080,
	height: 1920,
	fps: 30,
	durationInFrames: 180
};

const square = {
	id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
	title: 'Launch ad · 1:1',
	source: "const headline = 'Sale this week';",
	width: 1080,
	height: 1080,
	fps: 30,
	durationInFrames: 2700
};

describe('motion session targeting', () => {
	it('formats stored lengths like the picker', () => {
		expect(formatMotionLength(180, 30)).toBe('6s');
		expect(formatMotionLength(1800, 30)).toBe('1m');
		expect(formatMotionLength(2700, 30)).toBe('1m:30');
	});

	it('reads the seed headline', () => {
		expect(extractMotionHeadline(portrait.source)).toBe('Your marketing team. On autopilot.');
		expect(extractMotionHeadline('export default function MotionVideo() {}')).toBeNull();
	});

	it('lists each selected tile with canvas, length, and id', () => {
		const roster = formatMotionSessionRoster([portrait, square]);
		expect(roster).toContain('--- video 1 of 2');
		expect(roster).toContain('id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
		expect(roster).toContain('canvas: 9:16 (1080×1920)');
		expect(roster).toContain('length: 6s');
		expect(roster).toContain('headline: Your marketing team. On autopilot.');
		expect(roster).toContain('--- video 2 of 2');
		expect(roster).toContain('canvas: 1:1 (1080×1080)');
		expect(roster).toContain('length: 1m:30');
		expect(roster).toContain('headline: Sale this week');
	});

	it('tells CREATE vs single edit vs multi-edit', () => {
		expect(formatMotionTargetingRules({ createMode: true, reflowAspect: false, count: 0 })).toMatch(
			/CREATE/
		);
		expect(formatMotionTargetingRules({ createMode: false, reflowAspect: false, count: 1 })).toMatch(
			/exactly 1 selected/
		);
		expect(formatMotionTargetingRules({ createMode: false, reflowAspect: true, count: 1 })).toMatch(
			/DUPLICATE/
		);
		const multi = formatMotionTargetingRules({ createMode: false, reflowAspect: false, count: 2 });
		expect(multi).toMatch(/EDIT 2 selected/);
		expect(multi).toMatch(/Named subset/);
	});

	it('prefixes the user turn with the selected roster', () => {
		expect(formatMotionUserTargetingPrefix([])).toMatch(/CREATE/);
		expect(formatMotionUserTargetingPrefix([portrait])).toMatch(/EDIT exactly 1 selected video/);
		expect(formatMotionUserTargetingPrefix([portrait])).toContain('9:16');
		const multi = formatMotionUserTargetingPrefix([portrait, square]);
		expect(multi).toMatch(/EDIT 2 selected videos/);
		expect(multi).toContain('#1 "Launch ad · 9:16" · 9:16 · 6s');
		expect(multi).toContain('#2 "Launch ad · 1:1" · 1:1 · 1m:30');
	});
});
