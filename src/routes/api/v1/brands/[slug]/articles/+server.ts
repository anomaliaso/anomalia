import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';

// GET: list the brand's PUBLISHED blog articles (summaries only — no body). Paginated with
// ?limit (default 50, max 100) & ?offset. Fetch one article's full content via /articles/{id}.
export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

  const { data, count } = await supabase
    .from('brand_articles')
    .select('id, slug, title, meta_title, meta_description, cover_image, published_at', { count: 'exact' })
    .eq('brand_id', brand.id).eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const articles = (data ?? []).map((a: any) => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    metaTitle: a.meta_title ?? null,
    metaDescription: a.meta_description ?? null,
    coverImage: a.cover_image ?? null,
    publishedAt: a.published_at ?? null
  }));

  return json({ articles, total: count ?? articles.length, limit, offset });
};
