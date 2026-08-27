import { describe, expect, it } from 'vitest';
import { resolveTypography } from '$lib/design/typography';
/**
 * The exact brand kit that produced serif headlines for a brand that had chosen Inter.
 * `fonts` is the list of families found while crawling the site, in discovery order — Halant first,
 * Inter fifth — and `graphic_style` is what the user actually picked in Studio.
 */
const ANOMALIA_KIT = {
	fonts: [
		{ name: 'Halant', source: 'google-fonts' },
		{ name: 'Space Grotesk', source: 'google-fonts' },
		{ name: 'Geist', source: 'google-fonts' },
		{ name: 'Archivo', source: 'google-fonts' },
		{ name: 'Inter', source: 'google-fonts' }
	],
	graphic_style: { display_font: 'Inter', body_font: 'Inter', instructions: 'Stark black-and-white.' }
};

/** The same two lines run-turn uses to build the brief's font list. */
const briefFonts = (kit: unknown) => {
	const typography = resolveTypography(kit as { graphic_style?: unknown; fonts?: unknown });
	return [typography.display, typography.body].filter(Boolean);
};

describe('motion brief typography', () => {
	it('puts the CHOSEN display font first, not the first one found on the site', () => {
		// The bug: fonts[0] was Halant, a serif, so the brief said "headlines = Halant" and the agent
		// obeyed. The user had picked Inter and the picker had saved it — to graphic_style.
		expect(briefFonts(ANOMALIA_KIT)[0]).toBe('Inter');
		expect(resolveTypography(ANOMALIA_KIT).source).toBe('brand');
	});

	it('keeps the slots positional — display then body, duplicates and all', () => {
		// Deduping looks tidy and is a bug: a brand that picked Inter for both collapses to one
		// entry, and formatMotionBrandBrief reads fonts[1] as the body face — which would then fall
		// through to whatever came next. Here, that was Halant.
		expect(briefFonts(ANOMALIA_KIT)).toEqual(['Inter', 'Inter']);
	});

	it('falls back to the detected font when nothing was chosen', () => {
		expect(briefFonts({ fonts: [{ name: 'Lora' }] })[0]).toBe('Lora');
	});

	it('falls back to Inter when the kit is empty', () => {
		expect(briefFonts({})[0]).toBe('Inter');
	});

	it('carries a display/body pair that differs when the brand chose two faces', () => {
		const fonts = briefFonts({
			fonts: [{ name: 'Halant' }],
			graphic_style: { display_font: 'Archivo', body_font: 'Inter', instructions: 'x' }
		});
		expect(fonts).toEqual(['Archivo', 'Inter']);
	});
});
