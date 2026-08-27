import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

// Batch-render every still-imageless post for a week (or all pending posts when no week is given).
// Reuses renderPreviewImages, so each image goes through the same QC gate + rate-limit backoff as
// the main pipeline. Replaces calling `post … render` once per post by hand.
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const body = await request.json().catch(() => ({}));
  const weekIndex: number | undefined = body?.week_index;

  // When a week is requested, resolve it to the content_plans draft ids for that editorial week,
  // then filter posts by plan_id (posts have no editorial_week column — they link via plan_id).
  let planIds: string[] | null = null;
  if (weekIndex !== undefined) {
    const { data: plans } = await supabase
      .from('content_plans')
      .select('id')
      .eq('brand_id', brand.id)
      .eq('editorial_week', weekIndex);
    planIds = (plans ?? []).map((p: any) => p.id);
  }

  // Posts to render: pending_user, with an image_prompt, no image yet.
  let query = supabase
    .from('posts')
    .select('id, platform, platforms, caption, image_prompt, image_prompts, content_type, product_name, pillar, format, plan_id')
    .eq('brand_id', brand.id)
    .eq('status', 'pending_user')
    .not('image_prompt', 'is', null)
    .is('media_url', null);
  if (planIds) query = query.in('plan_id', planIds.length ? planIds : ['__none__']);
  const { data: posts } = await query;

  const renderable = (posts ?? []).filter((p: any) => p.image_prompt && p.content_type !== 'text' && p.content_type !== 'link');
  if (!renderable.length) return json({ ok: true, rendered: 0, failed: 0, results: [] });

  // Build the shared profile once (mirrors the single-render route).
  const { data: kit } = await supabase
    .from('brand_kit')
    .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style, site_type, content_pillars, logos, fonts, theme_color')
    .eq('brand_id', brand.id)
    .maybeSingle();
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
      name: p.title, description: p.description, kind: p.kind, pricing: p.pricing, images: p.images
    }))
  };

  try {
    const { renderPreviewImages } = await import('$lib/server/content-preview');

    const { normalizeContentFormat } = await import('$lib/content-formats');
    // Map each preview post back to its DB id by array index. format normalises legacy values;
    // a carousel post carries its persisted slide prompts so the renderer produces the series.
    const previewPosts = renderable.map((post: any) => ({
      platform: post.platform,
      platforms: post.platforms,
      format: normalizeContentFormat(post.format),
      media: 'image' as const,
      day: '', time: '',
      caption: post.caption ?? '',
      image_prompt: post.image_prompt,
      image_prompts: Array.isArray(post.image_prompts) && post.image_prompts.length ? post.image_prompts.map(String) : undefined,
      product: post.product_name ?? '',
      person: '',
      pillar: post.pillar ?? '',
      __postId: post.id
    }));

    const results: { id: string; ok: boolean; url?: string; error?: string; qc?: { score: number; pass: boolean; issues: string[]; retried: boolean }; product?: string }[] = [];
    await renderPreviewImages(profile, previewPosts as any, {
      supabase,
      userId: brand.id,
      onProgress: () => {},
      onPost: async (p: any) => {
        const id = p.__postId;
        if (p.imageUrl) {
          await supabase.from('posts').update({
            media_url: p.imageUrl,
            media_urls: p.imageUrls && p.imageUrls.length > 1 ? p.imageUrls : null,
            // The renderer may have downgraded a failed carousel to a single image — persist that.
            format: p.format ?? null
          }).eq('id', id);
          results.push({ id, ok: true, url: p.imageUrl, qc: p.__qc, product: p.product });
        } else {
          results.push({ id, ok: false, error: p.__renderError ?? 'no image produced', qc: p.__qc, product: p.product });
        }
      }
    });

    const rendered = results.filter((r) => r.ok).length;
    return json({ ok: true, rendered, failed: results.length - rendered, results });
  } catch (e) {
    return json({ error: `Batch render failed: ${String(e)}` }, { status: 500 });
  }
};
