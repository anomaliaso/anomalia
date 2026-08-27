import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { resolveSiteBrandByKey, listCategories } from '$lib/server/blog-site';

export const load: LayoutServerLoad = async ({ params, url, setHeaders }) => {
  const brand = await resolveSiteBrandByKey(params.site);
  if (!brand) throw error(404, 'Site not found');
  setHeaders({ 'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' });
  const base = `/blog/${params.site}`;
  const categories = await listCategories(brand.brandId);
  return { brand, base, siteUrl: `${url.origin}${base}`, categories };
};
