import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  contexts: [] as string[],
  render: vi.fn(),
  upload: vi.fn()
}));

vi.mock('$lib/server/ai-log', () => ({
  withBrandContext: <T>(brandId: string, fn: () => T): T => {
    state.contexts.push(brandId);
    return fn();
  }
}));

vi.mock('$lib/server/brand-memory', () => ({
  buildMemoryContext: vi.fn(async () => '')
}));

vi.mock('./images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./images')>()),
  renderBrandImage: (...args: unknown[]) => state.render(...args),
  uploadPostImage: (...args: unknown[]) => state.upload(...args)
}));

const { renderPreviewImages } = await import('./weekly-planner');

beforeEach(() => {
  state.contexts = [];
  state.render.mockReset();
  state.upload.mockReset();
  state.render.mockResolvedValue('data:image/png;base64,AAAA');
  state.upload.mockResolvedValue('https://cdn.example.com/image.png');
});

describe('renderPreviewImages brand context', () => {
  it('reviews a brand render inside its brand context', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { content_prefs: {} }, error: null }) })
        })
      })
    } as never;

    await renderPreviewImages(
      {
        name: 'Severo Ricami',
        ai_context: '',
        visual_style: 'editorial photography',
        brand_colors: [],
        fonts: [],
        logos: [],
        products: []
      },
      [{ platform: 'instagram', media: 'image', image_prompt: 'A plain polo shirt.', format: 'single_image' }] as never,
      { supabase, userId: 'user-1', brandId: 'brand-1', onPost: () => {} }
    );

    expect(state.contexts).toContain('brand-1');
  });

  it('reviews onboarding renders without enabling brand media access', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { content_prefs: {} }, error: null }) })
        })
      })
    } as never;

    await renderPreviewImages(
      {
        name: 'Severo Ricami',
        ai_context: '',
        visual_style: 'editorial photography',
        brand_colors: [],
        fonts: [],
        logos: [],
        products: []
      },
      [{ platform: 'instagram', media: 'image', image_prompt: 'A plain polo shirt.', format: 'single_image' }] as never,
      { supabase, userId: 'user-1', reviewBrandId: 'brand-1', onPost: () => {} } as never
    );

    expect(state.contexts).toContain('brand-1');
  });
});
