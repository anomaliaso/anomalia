import type { PageServerLoad } from './$types';
import { searchArticles } from '$lib/server/blog-site';

export const load: PageServerLoad = async ({ url, parent }) => {
  const { brand } = await parent();
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return { query: q, articles: [] };
  const articles = await searchArticles(brand.brandId, q);
  return {
    query: q,
    articles: articles.map((a) => ({
      slug: a.slug, title: a.title, excerpt: a.metaDescription, cover: a.coverImage,
      publishedAt: a.publishedAt, category: a.category, tags: a.tags, author: a.author
    }))
  };
};
