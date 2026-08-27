import type { RequestHandler } from './$types';
import { resolveSiteBrandByKey } from '$lib/server/blog-site';

export const GET: RequestHandler = async ({ params, url }) => {
  const brand = await resolveSiteBrandByKey(params.site);
  if (!brand) return new Response('Not found', { status: 404 });

  const base = `${url.origin}/blog/${params.site}`;

  return new Response(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`, {
    headers: { 'content-type': 'text/plain', 'cache-control': 'public, s-maxage=3600' }
  });
};
