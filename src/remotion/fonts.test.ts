import { describe, expect, it, vi } from 'vitest';

const { getAvailableFonts } = vi.hoisted(() => ({ getAvailableFonts: vi.fn() }));
vi.mock('@remotion/google-fonts', () => ({ getAvailableFonts }));

import { firstBrandFontName, resolveFontFamily } from './fonts';

const SYSTEM_PREFIX = 'system-ui';

describe('resolveFontFamily', () => {
  it('returns the loaded google family on success', async () => {
    getAvailableFonts.mockReturnValue([
      {
        fontFamily: 'Inter',
        load: async () => ({
          loadFont: () => ({ fontFamily: 'Inter', waitUntilDone: async () => undefined })
        })
      }
    ]);
    const r = await resolveFontFamily('Inter');
    expect(r.source).toBe('google');
    expect(r.fontFamily).toBe('Inter');
  });

  // The whole point of the try/catch: a CDN hiccup used to propagate into cancelRender() and kill
  // the export. A still in the system stack beats no still.
  it('falls back to the system stack when the font fails to load', async () => {
    getAvailableFonts.mockReturnValue([
      {
        fontFamily: 'Inter',
        load: async () => {
          throw new Error('network down');
        }
      }
    ]);
    const r = await resolveFontFamily('Inter');
    expect(r.source).toBe('system');
    expect(r.fontFamily.startsWith(SYSTEM_PREFIX)).toBe(true);
    expect(r.requested).toBe('Inter');
  });

  it('falls through to the next candidate when only the requested font fails', async () => {
    getAvailableFonts.mockReturnValue([
      {
        fontFamily: 'Brandon Grotesque',
        load: async () => {
          throw new Error('403');
        }
      },
      {
        fontFamily: 'Inter',
        load: async () => ({
          loadFont: () => ({ fontFamily: 'Inter', waitUntilDone: async () => undefined })
        })
      }
    ]);
    const r = await resolveFontFamily('Brandon Grotesque');
    expect(r.source).toBe('google');
    expect(r.fontFamily).toBe('Inter');
  });

  it('uses the system stack when the name is not a google font at all', async () => {
    getAvailableFonts.mockReturnValue([]);
    const r = await resolveFontFamily('Totally Custom Sans');
    expect(r.source).toBe('system');
  });
});

describe('firstBrandFontName', () => {
  it('reads both brand_kit shapes and ignores junk', () => {
    expect(firstBrandFontName([{ name: 'Satoshi', source: 'google-fonts' }])).toBe('Satoshi');
    expect(firstBrandFontName(['Inter'])).toBe('Inter');
    expect(firstBrandFontName([{ family: 'General Sans' }])).toBe('General Sans');
    expect(firstBrandFontName([{}, '  ', { name: 'Real' }])).toBe('Real');
    expect(firstBrandFontName([])).toBeNull();
    expect(firstBrandFontName(null)).toBeNull();
  });
});
