import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listArticlesByAuthor } from '$lib/server/blog-site';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { brand } = await parent();
  const { author, articles } = await listArticlesByAuthor(brand.brandId, params.slug);
  if (!author) throw error(404, 'Autore non trovato');
  return {
    author,
    articles: articles.map((a) => ({
      slug: a.slug, title: a.title, excerpt: a.metaDescription, cover: a.coverImage,
      publishedAt: a.publishedAt, category: a.category, tags: a.tags, author: a.author
    }))
  };
};
