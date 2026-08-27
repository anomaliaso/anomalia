import { describe, expect, it } from 'vitest';
import {
	extractVisualPlaybook,
	fontFamiliesInSource,
	formatMotionBrandBrief,
	kitColorHexes,
	kitFontNames,
	kitLogoUrl
} from './brand';

describe('motion-video brand kit', () => {
	it('normalises hex strings and {hex} objects', () => {
		expect(kitColorHexes(['#111', { hex: '#c485fe' }, '', { hex: '  ' }])).toEqual([
			'#111',
			'#c485fe'
		]);
	});

	it('reads font names from strings and objects', () => {
		expect(
			kitFontNames([{ name: 'Satoshi' }, 'Inter', { family: 'General Sans' }, {}])
		).toEqual(['Satoshi', 'Inter', 'General Sans']);
	});

	it('skips og-image logos and falls back to favicon', () => {
		expect(kitLogoUrl([{ url: 'https://x/og.png', type: 'og-image' }])).toBeNull();
		expect(kitLogoUrl([{ url: 'https://x/mark.svg', type: 'html-img-src' }])).toBe(
			'https://x/mark.svg'
		);
		expect(kitLogoUrl([], 'https://x/favicon.ico')).toBe('https://x/favicon.ico');
	});

	it('extracts font families assigned in source', () => {
		expect(
			fontFamiliesInSource(`const displayFont = 'Satoshi';
style={{ fontFamily: bodyFont, fontFamily: 'Inter' }}`)
		).toEqual(['Satoshi', 'Inter']);
	});

	it('formats a brief the agent can follow', () => {
		const brief = formatMotionBrandBrief({
			brandName: 'Acme',
			colors: ['#111', '#c485fe'],
			fonts: ['Satoshi', 'Inter'],
			logoUrl: 'https://cdn.example/logo.svg',
			visualStyle: 'Dark, tight type, one accent.',
			playbook: 'WHAT WORKS VISUALLY\nHigh contrast type.'
		});
		expect(brief).toContain('Acme');
		expect(brief).toContain('#c485fe');
		expect(brief).toContain('Satoshi');
		expect(brief).toContain('https://cdn.example/logo.svg');
		expect(brief).toContain('<Img');
		expect(brief).toContain('Dark, tight type');
		expect(brief).toContain('WHAT WORKS VISUALLY');
		expect(brief).toContain('DEFAULT CRAFT');
		expect(brief).toContain('Nano Banana Pro');
		expect(brief).toContain('programmatic UI');
	});

	it('falls back to a clean sans-serif when the kit has no fonts', () => {
		const brief = formatMotionBrandBrief({
			brandName: 'Acme',
			colors: ['#111'],
			fonts: [],
			logoUrl: null
		});
		expect(brief).toContain('Inter');
		expect(brief).toContain('minimal clean sans-serif');
	});

	it('extracts the visual playbook appendix', () => {
		expect(extractVisualPlaybook('voice\n\nWHAT WORKS VISUALLY\nBig type.\n\nmore')).toBe(
			'WHAT WORKS VISUALLY\nBig type.'
		);
		expect(extractVisualPlaybook('nope')).toBe('');
	});
});
