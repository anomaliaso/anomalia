import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listArticlesByTag } from '$lib/server/blog-site';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { brand } = await parent();
  const { tag, articles } = await listArticlesByTag(brand.brandId, params.slug);
  if (!tag) throw error(404, 'Tag non trovato');
  return {
    tag,
    articles: articles.map((a) => ({
      slug: a.slug, title: a.title, excerpt: a.metaDescription, cover: a.coverImage,
      publishedAt: a.publishedAt, category: a.category, tags: a.tags, author: a.author
    }))
  };
};
