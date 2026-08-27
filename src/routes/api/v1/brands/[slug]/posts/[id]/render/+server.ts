import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  // Load the post
  const { data: post } = await supabase
    .from('posts').select('*')
    .eq('id', params.id).eq('brand_id', brand.id).maybeSingle();

  if (!post) return json({ error: 'Post not found' }, { status: 404 });
  if (!post.image_prompt) return json({ error: 'Post has no image_prompt' }, { status: 400 });
  if (post.media_url) return json({ error: 'Post already has an image', url: post.media_url });

  // Build profile
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style, site_type, content_pillars, logos, fonts, theme_color')
    .eq('brand_id', brand.id)
    .maybeSingle();

  // Load ALL products so resolveOffering can match the featured product even if it's not in the
  // first 60 — otherwise the renderer finds no reference photo and skips the image.
  const { data: products } = await supabase
    .from('products')
    .select('title, description, kind, pricing, images')
    .eq('brand_id', brand.id);

  const profile: any = {
    name: brand.name,
    category: kit?.category ?? '',
    about: kit?.about ?? '',
    target_audience: kit?.target_audience ?? '',
    brand_colors: kit?.brand_colors ?? [],
    ai_character: kit?.ai_character ?? {},
    ai_context: kit?.ai_context ?? '',
    visual_style: kit?.visual_style ?? '',
    site_type: kit?.site_type ?? 'generic',
    content_pillars: kit?.content_pillars ?? [],
    logos: kit?.logos ?? [],
    fonts: kit?.fonts ?? [],
    theme_color: kit?.theme_color ?? null,
    products: (products ?? []).map((p: any) => ({
      name: p.title,
      description: p.description,
      kind: p.kind,
      pricing: p.pricing,
      images: p.images
    }))
  };

  try {
    const { renderPreviewImages } = await import('$lib/server/content-preview');
    const { normalizeContentFormat } = await import('$lib/content-formats');

    const previewPost = {
      platform: post.platform,
      platforms: post.platforms,
      format: normalizeContentFormat(post.format),
      media: post.content_type === 'text' ? 'text' as const : post.content_type === 'link' ? 'text' as const : 'image' as const,
      day: '',
      time: '',
      caption: post.caption ?? '',
      image_prompt: post.image_prompt,
      // Persisted carousel slide prompts → the renderer produces the whole series.
      image_prompts: Array.isArray(post.image_prompts) && post.image_prompts.length ? post.image_prompts.map(String) : undefined,
      product: post.product_name ?? '',
      person: '',
      pillar: post.pillar ?? '',
    };

    let renderError: string | null = null;
    await renderPreviewImages(profile, [previewPost], {
      supabase,
      userId: brand.id,
      onProgress: () => {},
      onPost: async (p) => {
        if (p.imageUrl) {
          const { error: updateErr } = await supabase.from('posts').update({
            media_url: p.imageUrl,
            media_urls: p.imageUrls && p.imageUrls.length > 1 ? p.imageUrls : null,
            // The renderer may have downgraded a failed carousel to a single image.
            format: p.format ?? null
          }).eq('id', post.id);
          if (updateErr) renderError = updateErr.message;
        } else {
          renderError = (p as any).__renderError ?? 'no image produced';
        }
      }
    });

    // Reload to get the image URL
    const { data: updated } = await supabase
      .from('posts').select('media_url')
      .eq('id', post.id).maybeSingle();

    return json({ ok: true, url: updated?.media_url ?? null, error: updated?.media_url ? null : renderError });
  } catch (e) {
    return json({ error: `Render failed: ${String(e)}` }, { status: 500 });
  }
};
