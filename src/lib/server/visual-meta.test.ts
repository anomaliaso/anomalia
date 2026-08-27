import { describe, it, expect, vi } from 'vitest';
import { deriveVisualMeta, writeVisualMeta, backfillVisualMeta } from './visual-meta';

describe('deriveVisualMeta', () => {
  it('maps every video format to the cinematic genre', () => {
    expect(deriveVisualMeta({ format: 'reel' }).genre).toBe('cinematic_default');
    expect(deriveVisualMeta({ format: 'video' }).genre).toBe('cinematic_default');
    expect(deriveVisualMeta({ format: 'short video' }).params.isVideo).toBe(true);
    expect(deriveVisualMeta({ format: 'story' }).params.isVideo).toBe(true);
    expect(deriveVisualMeta({ format: 'single_image' }).params.isVideo).toBe(false);
    expect(deriveVisualMeta({ format: 'carousel' }).params.isVideo).toBe(false);
  });

  it('treats uploaded / library media as a real asset', () => {
    const row = deriveVisualMeta({ content_type: 'uploaded_image', media_url: 'https://cdn.example/photo.jpg' });
    expect(row.genre).toBe('real_asset');
    expect(row.asset_source).toBe('real');

    const preview = deriveVisualMeta({ media: 'image', __fromLibrary: 'lib-1', imageUrl: 'https://cdn.example/1.jpg' });
    expect(preview.genre).toBe('real_asset');
    expect(preview.asset_source).toBe('real');

    const libraryPath = deriveVisualMeta({ content_type: 'generated_image', media_url: 'library/path.jpg' });
    expect(libraryPath.genre).toBe('real_asset');
    expect(libraryPath.asset_source).toBe('ai_generated');
  });

  it('maps graphic content to graphic_brand', () => {
    const m = deriveVisualMeta({ content_type: 'generated_graphic', media_url: 'https://cdn.example/g.png' });
    expect(m.genre).toBe('graphic_brand');
    expect(m.subject_type).toBe('graphic');
  });

  it('falls back to brand_studio / scene for a plain generated image', () => {
    const m = deriveVisualMeta({ content_type: 'generated_image', media_url: 'https://cdn.example/x.jpg' });
    expect(m.genre).toBe('brand_studio');
    expect(m.subject_type).toBe('scene');
  });

  it('prefers visual_genre when the column exists', () => {
    const m = deriveVisualMeta({ content_type: 'generated_image', visual_genre: 'talking_head' });
    expect(m.genre).toBe('talking_head');
  });

  it('infers hook_type from the caption head', () => {
    expect(deriveVisualMeta({ caption: 'Vuoi davvero risparmiare?' }).hook_type).toBe('question');
    expect(deriveVisualMeta({ caption: 'Il 72% dei clienti sceglie…' }).hook_type).toBe('stat');
    expect(deriveVisualMeta({ caption: 'How to scegliere il formato giusto' }).hook_type).toBe('howto');
    expect(deriveVisualMeta({ caption: 'Come far crescere un brand' }).hook_type).toBe('howto');
    expect(deriveVisualMeta({ caption: 'Myth: le proteine fanno male' }).hook_type).toBe('myth');
    expect(deriveVisualMeta({ caption: 'Raccontiamo il dietro le quinte del brand' }).hook_type).toBe('claim');
  });

  it('derives subject_type and presence flags', () => {
    const product = deriveVisualMeta({ product_name: 'Cruscotto Pro' });
    expect(product.subject_type).toBe('product');
    expect(product.product_present).toBe(true);

    const person = deriveVisualMeta({ pillar: 'People stories' });
    expect(person.subject_type).toBe('person');
    expect(person.person_present).toBe(true);

    const directPerson = deriveVisualMeta({ person: 'Giulia' });
    expect(directPerson.person_present).toBe(true);

    expect(deriveVisualMeta({ content_type: 'generated_image' }).person_present).toBe(false);
    expect(deriveVisualMeta({ product: 'Preview shape product' }).product_present).toBe(true);
  });

  it('captures carousel params, caption length and schedule passthrough', () => {
    const m = deriveVisualMeta({
      platform: 'Instagram',
      image_prompts: ['a', 'b', 'c'],
      caption: 'Ciao',
      first_comment: '#brand',
      scheduled_for: '2026-08-01T10:00:00Z',
      published_at: '2026-08-01T12:00:00Z'
    });
    expect(m.params.hasCarousel).toBe(true);
    expect(m.params.slideCount).toBe(3);
    expect(m.params.hasFirstComment).toBe(true);
    expect(m.caption_length).toBe(4);
    expect(m.platform).toBe('instagram');
    expect(m.scheduled_at).toBe('2026-08-01T10:00:00Z');
    expect(m.published_at).toBe('2026-08-01T12:00:00Z');

    const single = deriveVisualMeta({ image_prompts: ['only'] });
    expect(single.params.hasCarousel).toBe(false);
  });
});

describe('writeVisualMeta', () => {
  it('upserts on post_id with the derived row', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => ({ upsert })) } as never;

    const res = await writeVisualMeta(supabase, 'brand-1', { id: 'p-1', caption: 'Ciao' });
    expect(res.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ post_id: 'p-1', brand_id: 'brand-1' }),
      { onConflict: 'post_id' }
    );
  });

  it('is non-fatal when the write returns an error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'duplicate key' } });
    const supabase = { from: vi.fn(() => ({ upsert })) } as never;

    await expect(writeVisualMeta(supabase, 'brand-1', { id: 'p-1' })).resolves.toEqual({ ok: false });
  });

  it('is non-fatal when the write throws', async () => {
    const upsert = vi.fn().mockRejectedValue(new Error('boom'));
    const supabase = { from: vi.fn(() => ({ upsert })) } as never;

    await expect(writeVisualMeta(supabase, 'brand-1', { id: 'p-1' })).resolves.toEqual({ ok: false });
  });

  it('skips posts without an id', async () => {
    const from = vi.fn();
    await writeVisualMeta({ from } as never, 'brand-1', { caption: 'x' });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('backfillVisualMeta', () => {
  const postRow = (id: string) => ({
    id,
    brand_id: 'brand-1',
    status: 'published',
    published_at: '2026-08-01T12:00:00Z',
    caption: 'Ciao',
    content_type: 'generated_image',
    media_url: 'https://cdn.example/x.jpg'
  });

  const postsBuilder = (posts: unknown[], notSpy: ReturnType<typeof vi.fn>, limitSpy: ReturnType<typeof vi.fn>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    builder.or = () => builder;
    builder.not = (column: string, operator: string, value: string) => {
      notSpy(column, operator, value);
      return builder;
    };
    builder.limit = (n: number) => {
      limitSpy(n);
      return builder;
    };
    builder.select = () => builder;
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: posts });
    return builder;
  };

  const metaClient = (covered: string[], upsert: ReturnType<typeof vi.fn>, notSpy: ReturnType<typeof vi.fn>, limitSpy: ReturnType<typeof vi.fn>) => {
    const builder = postsBuilder([], notSpy, limitSpy);
    return {
      from: vi.fn((table: string) => {
        if (table === 'post_visual_meta') {
          return {
            select: vi.fn().mockResolvedValue({ data: covered.map((post_id) => ({ post_id })) }),
            upsert
          };
        }
        return builder;
      })
    } as never;
  };

  it('excludes covered posts (NOT EXISTS) and upserts the rest', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const notSpy = vi.fn();
    const limitSpy = vi.fn();
    const posts = [postRow('p-1'), postRow('p-2'), postRow('p-3')];
    const builder = postsBuilder(posts, notSpy, limitSpy);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'post_visual_meta') {
          return {
            select: vi.fn().mockResolvedValue({ data: [{ post_id: 'p-2' }] }),
            upsert
          };
        }
        return builder;
      })
    } as never;

    const res = await backfillVisualMeta(supabase, { limit: 10 });
    expect(res.backfilled).toBe(2);
    expect(notSpy).toHaveBeenCalledWith('id', 'in', '(p-2)');
    expect(limitSpy).toHaveBeenCalledWith(10);
    expect(upsert.mock.calls.map((c) => c[0].post_id)).toEqual(['p-1', 'p-3']);
  });

  it('skips the not.in filter when nothing is covered yet', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const notSpy = vi.fn();
    const limitSpy = vi.fn();
    const supabase = metaClient([], upsert, notSpy, limitSpy);

    const res = await backfillVisualMeta(supabase, { limit: 5 });
    expect(res.backfilled).toBe(0);
    expect(notSpy).not.toHaveBeenCalled();
    expect(limitSpy).toHaveBeenCalledWith(5);
  });

  it('defaults to a limit of 200', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const notSpy = vi.fn();
    const limitSpy = vi.fn();
    const builder = postsBuilder([postRow('p-1')], notSpy, limitSpy);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'post_visual_meta') {
          return {
            select: vi.fn().mockResolvedValue({ data: [] }),
            upsert
          };
        }
        return builder;
      })
    } as never;

    const res = await backfillVisualMeta(supabase);
    expect(res.backfilled).toBe(1);
    expect(limitSpy).toHaveBeenCalledWith(200);
  });

  it('filters to a single brand when brandId is passed', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const notSpy = vi.fn();
    const limitSpy = vi.fn();
    const eqSpy = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = postsBuilder([postRow('p-1')], notSpy, limitSpy);
    builder.eq = (column: string, value: string) => {
      eqSpy(column, value);
      return builder;
    };
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'post_visual_meta') {
          return {
            select: vi.fn().mockResolvedValue({ data: [] }),
            upsert
          };
        }
        return builder;
      })
    } as never;

    const res = await backfillVisualMeta(supabase, { limit: 10, brandId: 'brand-1' });
    expect(res.backfilled).toBe(1);
    expect(eqSpy).toHaveBeenCalledWith('brand_id', 'brand-1');
    expect(limitSpy).toHaveBeenCalledWith(10);
  });
});
