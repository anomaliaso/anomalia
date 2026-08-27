import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { getPublishedSitePage } from '$lib/server/site-pages';
import { renderArticleHtml } from '$lib/server/blog-site';

export const load: PageServerLoad = async ({ params, parent }) => {
  const { brand, siteUrl } = await parent();
  const page = await getPublishedSitePage(createAdminClient(), brand.brandId, params.slug);
  if (!page) throw error(404, 'Page not found');
  const html = renderArticleHtml(page.body_md || '');
  const meta = (page.seo_meta ?? {}) as { meta_title?: string; meta_description?: string; canonical?: string };
  const canonical = meta.canonical || `${siteUrl}/p/${page.slug}`;
  return {
    page: {
      slug: page.slug,
      title: page.title,
      kind: page.kind,
      html,
      metaTitle: meta.meta_title ?? page.title,
      metaDescription: meta.meta_description ?? '',
      canonical
    }
  };
};
