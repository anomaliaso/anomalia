import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveSiteBrand, listPublishedArticles } from '$lib/server/blog-site';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const host = url.hostname.toLowerCase();
  const brand = await resolveSiteBrand(host);
  if (!brand) throw error(404);
  const origin = `https://${host}`;
  const articles = await listPublishedArticles(brand.brandId);
  const items = articles.map((a) => `<item>
    <title>${esc(a.title)}</title>
    <link>${esc(`${origin}/${a.slug}`)}</link>
    <guid>${esc(`${origin}/${a.slug}`)}</guid>
    ${a.publishedAt ? `<pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>` : ''}
    ${a.metaDescription ? `<description>${esc(a.metaDescription)}</description>` : ''}
  </item>`).join('');
  setHeaders({ 'content-type': 'application/rss+xml', 'cache-control': 'public, s-maxage=600, stale-while-revalidate=1200' });
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
    <title>${esc(brand.name)}</title>
    <link>${origin}/</link>
    ${brand.description ? `<description>${esc(brand.description.slice(0, 300))}</description>` : ''}
    ${items}
  </channel></rss>`);
};
