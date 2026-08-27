import { describe, expect, it } from 'vitest';
import { fontPreviewHref, previewGlyphs } from './font-preview';
import { ALL_SHORTLIST_FONTS } from './typography';

describe('previewGlyphs', () => {
  it('asks for each character once', () => {
    expect(previewGlyphs(['Inter', 'Inter'])).toBe(previewGlyphs(['Inter']));
    expect(previewGlyphs(['ab', 'ba'])).toBe('ab');
  });

  it('covers every character the picker has to draw', () => {
    const glyphs = previewGlyphs(ALL_SHORTLIST_FONTS);
    for (const ch of ALL_SHORTLIST_FONTS.join('')) expect(glyphs).toContain(ch);
  });

  it('stays tiny — this is the point of the subset', () => {
    // Twenty-six family names collapse to a handful of distinct characters.
    expect(previewGlyphs(ALL_SHORTLIST_FONTS).length).toBeLessThan(45);
  });
});

describe('fontPreviewHref', () => {
  it('requests every shortlist family in one stylesheet', () => {
    const href = fontPreviewHref();
    for (const font of ALL_SHORTLIST_FONTS) {
      expect(href).toContain(`family=${font.replace(/ /g, '+')}`);
    }
  });

  it('subsets to the glyphs it will draw, and swaps rather than blocking', () => {
    const href = fontPreviewHref(['Inter']);
    expect(href).toContain('&text=');
    expect(href).toContain('display=swap');
  });

  it('encodes multi-word families with a plus, the way Google Fonts expects', () => {
    expect(fontPreviewHref(['Space Grotesk'])).toContain('family=Space+Grotesk');
  });
});
