import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getPublishedArticle, renderArticleHtml } from '$lib/server/blog-site';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { brand } = await parent();
  const article = await getPublishedArticle(brand.brandId, params.slug);
  if (!article) throw error(404, 'Article not found');
  return {
    article: {
      slug: article.slug,
      title: article.title,
      metaTitle: article.metaTitle,
      metaDescription: article.metaDescription,
      cover: article.coverImage,
      html: renderArticleHtml(article.bodyMd),
      publishedAt: article.publishedAt,
      category: article.category,
      tags: article.tags,
      author: article.author
    }
  };
};
