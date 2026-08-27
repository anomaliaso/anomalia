import type { PageServerLoad } from './$types';
import { listPublishedArticles } from '$lib/server/blog-site';

export const load: PageServerLoad = async ({ parent }) => {
  const { brand } = await parent();
  const articles = await listPublishedArticles(brand.brandId);
  return {
    articles: articles.map((a) => ({
      slug: a.slug, title: a.title, excerpt: a.metaDescription, cover: a.coverImage,
      publishedAt: a.publishedAt, category: a.category, tags: a.tags, author: a.author
    }))
  };
};
