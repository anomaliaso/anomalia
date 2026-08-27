import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand } = await parent();

  if (brand.status !== 'active') throw redirect(303, `/app/${brand.slug}/activate`);

  // Stamp launch so the app shell stops treating this brand as pre-launch.
  if (!brand.launched_at) {
    await supabase.from('brands').update({ launched_at: new Date().toISOString() }).eq('id', brand.id);
  }

  return {
    brand: { name: brand.name, slug: brand.slug, plan: brand.plan }
  };
};
