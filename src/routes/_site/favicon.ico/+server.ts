import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveSiteBrand } from '$lib/server/blog-site';

// Browsers auto-request /favicon.ico at the domain root. On a brand's custom blog domain, redirect
// it to the brand's uploaded icon (or 404 when none — the <link rel="icon"> covers modern browsers).
export const GET: RequestHandler = async ({ url, setHeaders }) => {
  const brand = await resolveSiteBrand(url.hostname.toLowerCase());
  if (!brand?.icon) throw error(404);
  setHeaders({ 'cache-control': 'public, s-maxage=86400' });
  throw redirect(302, brand.icon);
};
