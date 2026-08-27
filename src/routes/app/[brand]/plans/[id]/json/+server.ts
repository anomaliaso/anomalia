import { json, error } from '@sveltejs/kit';
import { loadBrandPlanDocument } from '$lib/server/brand-plans';
import type { RequestHandler } from './$types';

/** JSON feed for the desktop plan side panel (keeps +page free for HTML). */
export const GET: RequestHandler = async ({ params, locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) throw error(401, 'Unauthorized');

  const { data: brand } = await supabase
    .from('brands')
    .select('id, slug')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) throw error(404, 'Brand not found');

  const plan = await loadBrandPlanDocument(supabase, brand.id, params.id);
  if (!plan) throw error(404, 'Plan not found');

  return json({ plan, brandSlug: brand.slug });
};
