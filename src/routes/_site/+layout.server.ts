import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { resolveSiteBrand, listCategories } from '$lib/server/blog-site';

export const load: LayoutServerLoad = async ({ url, setHeaders }) => {
  const host = url.hostname.toLowerCase();
  const brand = await resolveSiteBrand(host);
  if (!brand) throw error(404, 'This site is not configured yet.');
  setHeaders({ 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
  const origin = `https://${host}`;
  const categories = await listCategories(brand.brandId);
  return { brand, host, origin, base: '', siteUrl: origin, categories };
};
