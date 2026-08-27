import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const origin = `https://${url.hostname.toLowerCase()}`;
  setHeaders({ 'content-type': 'text/plain', 'cache-control': 'public, s-maxage=3600' });
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
};
