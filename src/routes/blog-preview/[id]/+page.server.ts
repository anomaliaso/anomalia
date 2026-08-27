import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { resolveSiteBrandByKey, renderArticleHtml } from '$lib/server/blog-site';

// Owner-only rendered preview of an article in ANY status (draft included), before publishing.
// RLS on brand_articles scopes the read to the owner's brands, so a non-owner just gets a 404.
export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw redirect(303, '/login');

  const { data: a } = await supabase
    .from('brand_articles')
    .select('brand_id, slug, title, meta_title, meta_description, body_md, cover_image, status, published_at')
    .eq('id', params.id).maybeSingle();
  if (!a) throw error(404, 'Article not found');

  const brand = await resolveSiteBrandByKey(a.brand_id);
  if (!brand) throw error(404, 'Brand not found');

  return {
    brand,
    status: a.status,
    article: {
      slug: a.slug, title: a.title, metaTitle: a.meta_title, metaDescription: a.meta_description,
      cover: a.cover_image, html: renderArticleHtml(a.body_md ?? ''), publishedAt: a.published_at
    }
  };
};
