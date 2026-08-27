import type { RequestHandler } from './$types';
import { resolveSiteBrandByKey, listPublishedArticleUrls } from '$lib/server/blog-site';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const lastmod = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const XML_HEADERS = {
  'content-type': 'application/xml; charset=utf-8',
  'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400'
} as const;

export const GET: RequestHandler = async ({ params, url }) => {
  try {
    const brand = await resolveSiteBrandByKey(params.site);
    if (!brand) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    const base = `${url.origin}/blog/${params.site}`;
    const articles = await listPublishedArticleUrls(brand.brandId);
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    const { data: sitePages } = await createAdminClient()
      .from('brand_site_pages')
      .select('slug, published_at')
      .eq('brand_id', brand.brandId)
      .eq('status', 'published');
    const urls = [
      `<url><loc>${esc(`${base}/`)}</loc></url>`,
      ...articles.map((a) => {
        const mod = a.publishedAt ? lastmod(a.publishedAt) : '';
        return `<url><loc>${esc(`${base}/${a.slug}`)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}</url>`;
      }),
      ...(sitePages ?? []).map((p) => {
        const mod = p.published_at ? lastmod(p.published_at) : '';
        return `<url><loc>${esc(`${base}/p/${p.slug}`)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}</url>`;
      })
    ].join('');

    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`,
      { headers: XML_HEADERS }
    );
  } catch (err) {
    console.error('[blog sitemap]', params.site, err);
    return new Response('Sitemap temporarily unavailable', {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'retry-after': '60'
      }
    });
  }
};
