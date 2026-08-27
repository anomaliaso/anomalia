import { error } from '@sveltejs/kit';
import { loadBrandPlanDocument } from '$lib/server/brand-plans';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
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

  return {
    plan,
    brandSlug: brand.slug as string
  };
};
