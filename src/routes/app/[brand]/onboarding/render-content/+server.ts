import type { RequestHandler } from './$types';
import { renderPreviewImages, attachBrandMoodImages, type PreviewPost } from '$lib/server/content-preview';
import { attachBrandPeople } from '$lib/server/people';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

// POST: render the visuals for the week-1 drafts the user just approved, in the BACKGROUND. The
// browser fires this fire-and-forget (so it carries the user's session) after approving content, and
// doesn't await it — the agent meanwhile guides the social connection. Reuses the same profile +
// renderer the Content "generate" endpoint builds from stored brand data (no website refetch).
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { data: brand } = await supabase.from('brands').select('id, name').eq('slug', params.brand).maybeSingle();
  if (!brand) return new Response('Brand not found', { status: 404 });

  // The approved drafts still missing a rendered image.
  const { data: rows } = await supabase
    .from('posts')
    .select('id, platform, platforms, caption, image_prompt, content_type, format, product_name, pillar')
    .eq('brand_id', brand.id)
    .eq('status', 'pending_user')
    .eq('source', 'plan')
    .is('media_url', null)
    .limit(12);
  if (!rows?.length) return new Response(JSON.stringify({ rendered: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });

  const { data: kit } = await supabase
    .from('brand_kit')
    .select('category, about, target_audience, brand_colors, ai_character, ai_context, visual_style, site_type, logos, fonts, images')
    .eq('brand_id', brand.id)
    .maybeSingle();
  const { data: products } = await supabase.from('products').select('title, description, pricing, images').eq('brand_id', brand.id).limit(12);

  const profile = {
    name: brand.name,
    category: kit?.category ?? '',
    about: kit?.about ?? '',
    target_audience: kit?.target_audience ?? '',
    brand_colors: kit?.brand_colors ?? [],
    ai_character: kit?.ai_character ?? {},
    ai_context: kit?.ai_context ?? '',
    visual_style: kit?.visual_style ?? '',
    site_type: kit?.site_type ?? 'generic',
    logos: kit?.logos ?? [],
    fonts: kit?.fonts ?? [],
    images: kit?.images ?? [],
    products: (products ?? []).map((p) => ({ name: p.title, description: p.description, pricing: p.pricing, images: p.images }))
  };
  await attachBrandPeople(profile, supabase, brand.id);
  await attachBrandMoodImages(profile, supabase, brand.id);

  // Reconstruct the planner posts from the DB rows (carry the row id so onPost can write media back).
  const previews: AnyRec[] = rows.map((r) => ({
    _id: r.id,
    platform: r.platform,
    platforms: r.platforms,
    media: r.content_type === 'text' ? 'text' : r.content_type === 'link' ? 'text' : 'image',
    caption: r.caption,
    image_prompt: r.image_prompt,
    product: r.product_name,
    pillar: r.pillar,
    format: r.format
  }));

  const pending: PromiseLike<unknown>[] = [];
  let rendered = 0;
  await renderPreviewImages(profile, previews as unknown as PreviewPost[], {
    supabase,
    userId: user.id,
    onPost: (post: AnyRec) => {
      if (post.imageUrl) {
        rendered += 1;
        pending.push(supabase.from('posts').update({ media_url: post.imageUrl, content_type: 'generated_image' }).eq('id', post._id));
      }
    }
  });
  await Promise.all(pending);

  return new Response(JSON.stringify({ rendered }), { status: 200, headers: { 'content-type': 'application/json' } });
};
