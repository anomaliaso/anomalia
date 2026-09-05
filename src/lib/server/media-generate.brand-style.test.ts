import { describe, it, expect, vi, beforeEach } from 'vitest';

const renderPostImage = vi.fn();
const loadBrandVisualContext = vi.fn();
const insertBrandMedia = vi.fn();
const storeBrandMediaBytes = vi.fn();

const PNG_DATA_URL = 'data:image/png;base64,AAAA';

const VISUAL_STYLE = 'monochrome editorial, hard light';
const BRAND_LOOK = 'BRAND IDENTITY — Colour palette: #0f0f0f';
const PLAYBOOK = 'WHAT WORKS VISUALLY: close crops';
const LOGO = { inlineData: { mimeType: 'image/png', data: 'LOGO' } };

vi.mock('$lib/server/content-preview', () => ({
  renderPostImage: (...args: unknown[]) => renderPostImage(...args),
  buildImageRequest: (_prompt: string, opts: { model?: string }) => ({ model: opts.model ?? null }),
  loadBrandVisualContext: (...args: unknown[]) => loadBrandVisualContext(...args)
}));
vi.mock('$lib/server/brand-media', () => ({
  loadLibraryMediaParts: async () => [],
  insertBrandMedia: (...args: unknown[]) => insertBrandMedia(...args),
  storeBrandMediaBytes: (...args: unknown[]) => storeBrandMediaBytes(...args),
  probeImageDimensions: async () => ({ width: 1080, height: 1080 })
}));
vi.mock('$lib/server/content-credentials', () => ({
  markImage: async (bytes: Buffer) => bytes,
  DIGITAL_SOURCE_TYPE: { synthetic: 'trainedAlgorithmicMedia' }
}));
vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: <T>(_brandId: string, fn: () => T) => fn(),
  billedUsdInScope: () => null
}));

import { generateBrandImages } from './media-generate';

const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: { content_prefs: {} }, error: null }) })
    })
  })
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  renderPostImage.mockResolvedValue(PNG_DATA_URL);
  storeBrandMediaBytes.mockResolvedValue({});
  insertBrandMedia.mockResolvedValue({ row: { id: 'media-new', kind: 'image' } });
  loadBrandVisualContext.mockResolvedValue({
    visualStyle: VISUAL_STYLE,
    brandLook: BRAND_LOOK,
    visualPlaybook: PLAYBOOK,
    logoImage: LOGO
  });
});

describe('lo stile del brand nella richiesta di render', () => {
  it('con un brand, il suo aspetto arriva al renderer', async () => {
    await generateBrandImages(supabase, {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'un gatto'
    });

    expect(loadBrandVisualContext).toHaveBeenCalledWith(expect.anything(), 'brand-1');

    const opts = renderPostImage.mock.calls[0][1];
    expect(opts.visualStyle).toBe(VISUAL_STYLE);
    expect(opts.brandLook).toBe(BRAND_LOOK);
    expect(opts.visualPlaybook).toBe(PLAYBOOK);
    expect(opts.logoImage).toEqual(LOGO);
  });

  it('brandStyle ignore lo tiene fuori, e il brand non viene nemmeno letto', async () => {
    await generateBrandImages(supabase, {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'un gatto',
      brandStyle: 'ignore'
    });

    expect(loadBrandVisualContext).not.toHaveBeenCalled();

    const opts = renderPostImage.mock.calls[0][1];
    expect(opts.visualStyle).toBeUndefined();
    expect(opts.brandLook).toBeUndefined();
    expect(opts.visualPlaybook).toBeUndefined();
    expect(opts.logoImage).toBeUndefined();
  });

  it('un brand senza kit non inventa un aspetto', async () => {
    loadBrandVisualContext.mockResolvedValue({});

    await generateBrandImages(supabase, {
      brandId: 'brand-1',
      userId: 'user-1',
      prompt: 'un gatto'
    });

    const opts = renderPostImage.mock.calls[0][1];
    expect(opts.visualStyle).toBeUndefined();
    expect(opts.brandLook).toBeUndefined();
  });
});
