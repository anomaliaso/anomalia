import { describe, expect, it } from 'vitest';
import { GraphicStyleSchema, resolveTypography, ALL_SHORTLIST_FONTS, DEFAULT_FONT } from './typography';

describe('graphic typography', () => {
  it('prefers what the brand chose over what was scraped from its site', () => {
    // The bug this guards: brand_kit.fonts is whatever the website loads — often a serif display
    // face — and it was silently deciding how every post was set.
    const r = resolveTypography({
      graphic_style: { display_font: 'Fraunces', body_font: 'Inter', instructions: 'no dark' },
      fonts: [{ name: 'Some Site Serif' }]
    });
    expect(r).toMatchObject({ display: 'Fraunces', body: 'Inter', instructions: 'no dark', source: 'brand' });
  });

  it('falls back to the detected site font, then to Inter', () => {
    expect(resolveTypography({ fonts: [{ name: 'Lora' }] })).toMatchObject({ display: 'Lora', source: 'detected' });
    expect(resolveTypography({ fonts: ['Karla'] })).toMatchObject({ display: 'Karla', source: 'detected' });
    expect(resolveTypography(null)).toMatchObject({ display: DEFAULT_FONT, body: DEFAULT_FONT, source: 'default' });
  });

  it('ignores a malformed graphic_style rather than rendering nothing', () => {
    expect(resolveTypography({ graphic_style: { display_font: '' }, fonts: [] }).source).toBe('default');
    expect(resolveTypography({ graphic_style: 'nonsense' }).source).toBe('default');
  });

  it('defaults the instructions so the composer never gets undefined', () => {
    const parsed = GraphicStyleSchema.parse({ display_font: 'Inter', body_font: 'Inter' });
    expect(parsed.instructions).toBe('');
  });

  it('offers a shortlist with no duplicates for the AI proposal', () => {
    expect(new Set(ALL_SHORTLIST_FONTS).size).toBe(ALL_SHORTLIST_FONTS.length);
    expect(ALL_SHORTLIST_FONTS).toContain(DEFAULT_FONT);
  });
});
