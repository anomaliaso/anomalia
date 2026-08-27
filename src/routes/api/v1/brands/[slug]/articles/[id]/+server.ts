import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { renderArticleHtml } from '$lib/server/blog-site';

// GET: one published article with full content — markdown + rendered HTML + Article JSON-LD, so a
// headless site can render it however it likes. Accepts the article id OR its slug as {id}.
export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const q = supabase
    .from('brand_articles')
    .select('id, slug, title, meta_title, meta_description, body_md, cover_image, published_at')
    .eq('brand_id', brand.id).eq('status', 'published');
  // Accept either the UUID or the slug in the {id} position.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id);
  const { data: a } = await (isUuid ? q.eq('id', params.id) : q.eq('slug', params.id)).maybeSingle();
  if (!a) return json({ error: 'Article not found' }, { status: 404 });

  const contentHtml = renderArticleHtml(a.body_md ?? '');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.meta_description ?? undefined,
    image: a.cover_image ?? undefined,
    datePublished: a.published_at ?? undefined
  };

  return json({
    id: a.id,
    slug: a.slug,
    title: a.title,
    metaTitle: a.meta_title ?? null,
    metaDescription: a.meta_description ?? null,
    coverImage: a.cover_image ?? null,
    publishedAt: a.published_at ?? null,
    contentMarkdown: a.body_md ?? '',
    contentHtml,
    jsonLd
  });
};
