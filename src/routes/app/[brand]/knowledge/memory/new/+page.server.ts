import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { withBrandContext } from '$lib/server/ai-log';
import { writeMemory, type MemoryCategory } from '$lib/server/brand-memory';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withBrand<T>(supabase: any, slug: string, fn: (brand: any) => Promise<T>): Promise<T> {
  const { data: brand } = await supabase
    .from('brands')
    .select('id, plan, slug')
    .eq('slug', slug)
    .maybeSingle();
  if (!brand) return fail(404, { error: 'Brand not found' }) as T;
  return withBrandContext(brand.id, () => fn(brand));
}

export const load: PageServerLoad = async ({ parent }) => {
  await parent();
  return {};
};

export const actions: Actions = {
  default: async ({ request, params, locals: { supabase } }) => {
    return withBrand(supabase, params.brand, async (brand) => {
      const fd = await request.formData();
      const key = String(fd.get('key') ?? '').trim();
      const value = String(fd.get('value') ?? '').trim();
      const category = String(fd.get('category') ?? 'fact') as MemoryCategory;
      if (!key || !value) return fail(400, { error: 'Key and value required' });
      try {
        await writeMemory(supabase, brand.id, {
          key,
          value,
          category,
          source: 'user',
          confidence: 0.9,
          // A procedure the user typed out by hand is not something decay gets to retire.
          pinned: category === 'skill'
        });
      } catch (e) {
        return fail(400, { error: e instanceof Error ? e.message : 'Could not save' });
      }
      throw redirect(303, `/app/${brand.slug}/knowledge`);
    });
  }
};
