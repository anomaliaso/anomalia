import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listArticlesByCategory } from '$lib/server/blog-site';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { brand } = await parent();
  const { category, articles } = await listArticlesByCategory(brand.brandId, params.slug);
  if (!category) throw error(404, 'Categoria non trovata');
  return {
    category,
    articles: articles.map((a) => ({
      slug: a.slug, title: a.title, excerpt: a.metaDescription, cover: a.coverImage,
      publishedAt: a.publishedAt, category: a.category, tags: a.tags, author: a.author
    }))
  };
};
